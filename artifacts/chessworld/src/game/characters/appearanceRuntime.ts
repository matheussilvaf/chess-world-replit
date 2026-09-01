/**
 * Appearance Runtime — transforma a RECEITA do personagem (aparência + arma)
 * num personagem Phaser completo, em runtime.
 *
 * Pipeline (tudo client-side, uma vez por receita):
 *   receita → camadas do gerador (manifest) → compositor (tom de pele +
 *   ordem por direção) → UMA CanvasTexture 2208×384 → 92 frames (23 col ×
 *   4 dir) → animações walk/idle/attack/death → WorldCharacterDef sintético
 *   registrado no catálogo (id `pc-<hash>`).
 *
 * Otimizações:
 *   - chave de textura = hash do CONTEÚDO da receita: jogadores idênticos
 *     compartilham textura/def/anims (zero trabalho extra);
 *   - dedupe de composições em voo (N remotes iguais → 1 build);
 *   - PNGs das camadas vêm do cache HTTP do navegador (assets estáticos).
 *
 * Depois do registro, TODO o código existente da cena (idle/walk/attack/
 * death/poses) funciona sem saber que o personagem é sintético.
 */
import {
  ANIM_FRAME_MS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SHEET_COLS,
  SHEET_ROWS,
} from '../../lib/character-generator/constants';
import { composeSheet, loadLayerCanvases, type LayerSpec } from '../../lib/character-generator/compositor';
import { getSkinTone } from '../../lib/character-generator/skinTones';
import { fetchGeneratorManifest } from '../../lib/character-generator/manifest';
import type { GeneratorFamily, GeneratorManifest } from '../../lib/character-generator/types';
import {
  COMPOSED_SHEET,
  WEAPON_REF_RE,
  appearanceHash,
  canonicalAppearanceString,
  parseAppearanceString,
  type CharacterAppearanceV1,
} from '../../shared/characters/PlayerCharacterShapes';
import { directionRowsFor } from '../../shared/combat/CharacterCombatShapes';
import {
  RUNTIME_CHARACTER_PREFIX,
  animKeyFor,
  getWorldCharacter,
  hasCharacterDef,
  listRuntimeCharacterIds,
  registerRuntimeCharacter,
  unregisterRuntimeCharacter,
  type MovementDef,
  type WorldCharacterDef,
} from './characterCatalog';

// ------------------------------------------------------- manifest singleton

let manifestPromise: Promise<GeneratorManifest> | null = null;

/** Manifest do gerador, cacheado; falha reseta para permitir retry. */
export function getGeneratorManifest(): Promise<GeneratorManifest> {
  if (!manifestPromise) {
    manifestPromise = fetchGeneratorManifest().catch((e) => {
      manifestPromise = null;
      throw e;
    });
  }
  return manifestPromise;
}

// ----------------------------------------------------------- ids e chaves

/** Id determinístico do def sintético para (aparência, arma). */
export function composedDefIdFor(appearanceRaw: string, weaponRef: string | null): string | null {
  const appearance = parseAppearanceString(appearanceRaw);
  if (!appearance) return null;
  const canonical = canonicalAppearanceString(appearance);
  return `${RUNTIME_CHARACTER_PREFIX}${appearanceHash(`${canonical}|${weaponRef ?? ''}`)}`;
}

function composedTextureKey(defId: string): string {
  return `pcTex:${defId}`;
}

// ------------------------------------------------------------ layer specs

function findFamily(manifest: GeneratorManifest, category: string, familyId: string): GeneratorFamily | null {
  return (manifest.categories[category] ?? []).find((f) => f.id === familyId) ?? null;
}

function familyVariantUrl(family: GeneratorFamily, variantId: string, problems: string[]): string {
  const variant = family.variants.find((v) => v.id === variantId);
  if (!variant) {
    problems.push(`variante "${variantId}" não existe em ${family.id} — usando a default`);
    return family.default.url;
  }
  return variant.url;
}

function buildLayerSpecs(
  manifest: GeneratorManifest,
  appearance: CharacterAppearanceV1,
  weaponRef: string | null,
): { specs: LayerSpec[]; problems: string[] } {
  const base = import.meta.env.BASE_URL;
  const specs: LayerSpec[] = [];
  const problems: string[] = [];

  const push = (category: string, familyId: string, variantId: string) => {
    const family = findFamily(manifest, category, familyId);
    if (!family) {
      problems.push(`família "${familyId}" não existe na camada ${category}`);
      return;
    }
    specs.push({ category, url: `${base}${familyVariantUrl(family, variantId, problems)}` });
  };

  // Sombra é implícita (todo personagem tem) — não é uma escolha do jogador.
  const shadow = (manifest.categories.shadow ?? [])[0];
  if (shadow) specs.push({ category: 'shadow', url: `${base}${shadow.default.url}` });

  push('bottom', appearance.layers.bottom.familyId, appearance.layers.bottom.variantId);
  push('top', appearance.layers.top.familyId, appearance.layers.top.variantId);
  push('head', appearance.layers.head.familyId, appearance.layers.head.variantId);
  if (appearance.layers.hair) push('hair', appearance.layers.hair.familyId, appearance.layers.hair.variantId);

  if (weaponRef) {
    const match = WEAPON_REF_RE.exec(weaponRef);
    if (match) {
      push('weapon', match[1], match[2] ?? 'default');
    } else {
      problems.push(`ref de arma inválida: ${weaponRef}`);
    }
  }

  return { specs, problems };
}

// -------------------------------------------------------- def + animações

interface ComposedMovementSpec {
  movement: string;
  /** Colunas da folha usadas pela animação. */
  frames: readonly number[];
  frameRate: number;
  repeat: number;
  /** Coluna da pose congelada (por linha de direção). */
  poseColumn: number;
}

const MOVEMENT_SPECS: readonly ComposedMovementSpec[] = [
  {
    movement: 'walk',
    frames: COMPOSED_SHEET.walkFrames,
    frameRate: 1000 / ANIM_FRAME_MS,
    repeat: -1,
    poseColumn: COMPOSED_SHEET.standFrame,
  },
  {
    movement: 'idle',
    frames: [COMPOSED_SHEET.standFrame],
    frameRate: 1,
    repeat: -1,
    poseColumn: COMPOSED_SHEET.standFrame,
  },
  {
    // 12 fps × 5 colunas — mesmo relógio do cooldown no servidor.
    movement: 'attack',
    frames: COMPOSED_SHEET.attackFrames,
    frameRate: 12,
    repeat: 0,
    poseColumn: COMPOSED_SHEET.standFrame,
  },
  {
    // Disparo de arco (knock-and-bow): 12 fps × 4 colunas; a flecha é criada
    // pelo WorldScene ao FIM da animação.
    movement: 'shoot',
    frames: COMPOSED_SHEET.shootFrames,
    frameRate: 12,
    repeat: 0,
    poseColumn: COMPOSED_SHEET.standFrame,
  },
  {
    movement: 'death',
    frames: [COMPOSED_SHEET.deadFrame],
    frameRate: 1,
    repeat: 0,
    poseColumn: COMPOSED_SHEET.deadFrame,
  },
];

const DIRECTION_ROWS = directionRowsFor(4); // down, left, right, up — ordem das linhas do pack

function buildComposedDef(defId: string): WorldCharacterDef {
  const textureKey = composedTextureKey(defId);
  const movements = new Map<string, MovementDef>();
  for (const spec of MOVEMENT_SPECS) {
    movements.set(spec.movement, {
      movement: spec.movement,
      fileName: 'composed',
      assetKey: `${spec.movement}/composed`,
      url: '',
      textureKey,
      imageWidth: SHEET_COLS * FRAME_WIDTH,
      imageHeight: SHEET_ROWS * FRAME_HEIGHT,
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
      columns: spec.frames.length,
      poseFrames: DIRECTION_ROWS.map((_, row) => row * SHEET_COLS + spec.poseColumn),
    });
  }
  return {
    id: defId,
    displayName: 'Aventureiro',
    folderName: defId,
    directions: 4,
    directionRows: DIRECTION_ROWS,
    movements,
    originX: 0.5,
    originY: 0.5,
    bodyOffsetX: 0,
    bodyOffsetY: 21,
    bodyRadius: 10,
    maxHp: 100,
    combat: null,
    warnings: [],
  };
}

/** Cria as animações do def composto (idempotente — pula chaves existentes). */
function ensureComposedAnims(scene: Phaser.Scene, defId: string): void {
  const textureKey = composedTextureKey(defId);
  for (const spec of MOVEMENT_SPECS) {
    DIRECTION_ROWS.forEach((direction, row) => {
      const key = animKeyFor(defId, spec.movement, direction);
      if (scene.anims.exists(key)) return;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(textureKey, {
          frames: spec.frames.map((col) => row * SHEET_COLS + col),
        }),
        frameRate: spec.frameRate,
        repeat: spec.repeat,
      });
    });
  }
}

// ------------------------------------------------------------- composição

const inFlight = new Map<string, Promise<WorldCharacterDef | null>>();

/**
 * Garante textura + frames + animações + def registrado para a receita.
 * Reentrante e deduplicado: chamadas concorrentes para a mesma receita
 * compartilham o mesmo build. Falha → null (nunca lança).
 */
export function ensureAppearanceDef(
  scene: Phaser.Scene,
  appearanceRaw: string,
  weaponRef: string | null,
): Promise<WorldCharacterDef | null> {
  const appearance = parseAppearanceString(appearanceRaw);
  if (!appearance) {
    console.warn('[appearance] receita inválida no estado — ignorando');
    return Promise.resolve(null);
  }
  const canonical = canonicalAppearanceString(appearance);
  const defId = `${RUNTIME_CHARACTER_PREFIX}${appearanceHash(`${canonical}|${weaponRef ?? ''}`)}`;

  // Caminho rápido: tudo já existe (mesma receita usada por outro jogador).
  if (hasCharacterDef(defId) && scene.textures.exists(composedTextureKey(defId))) {
    ensureComposedAnims(scene, defId); // barato; cobre re-criação do Game
    return Promise.resolve(getWorldCharacter(defId));
  }

  const pending = inFlight.get(defId);
  if (pending) return pending;

  return startComposition(scene, defId, appearance, weaponRef);
}

function startComposition(
  scene: Phaser.Scene,
  defId: string,
  appearance: CharacterAppearanceV1,
  weaponRef: string | null,
): Promise<WorldCharacterDef | null> {
  const job = (async (): Promise<WorldCharacterDef | null> => {
    try {
      const manifest = await getGeneratorManifest();
      const { specs, problems } = buildLayerSpecs(manifest, appearance, weaponRef);
      if (problems.length > 0) console.warn('[appearance] problemas na receita:', problems);
      if (specs.length === 0) return null;

      const tone = getSkinTone(appearance.skinTone);
      const { layers, failed } = await loadLayerCanvases(specs, tone);
      if (failed.length > 0) console.warn('[appearance] camadas que falharam:', failed);
      if (layers.length === 0) return null;

      // A cena pode ter morrido durante os awaits (unmount do jogo).
      if (!scene.sys || !scene.sys.game || !scene.textures) return null;

      const textureKey = composedTextureKey(defId);
      if (!scene.textures.exists(textureKey)) {
        const sheet = composeSheet(layers);
        const texture = scene.textures.addCanvas(textureKey, sheet);
        if (!texture) return null;
        // 92 frames nomeados pelo índice global (linha*23 + coluna) — o
        // mesmo esquema de índices dos spritesheets legados.
        for (let row = 0; row < SHEET_ROWS; row++) {
          for (let col = 0; col < SHEET_COLS; col++) {
            texture.add(
              row * SHEET_COLS + col,
              0,
              col * FRAME_WIDTH,
              row * FRAME_HEIGHT,
              FRAME_WIDTH,
              FRAME_HEIGHT,
            );
          }
        }
      }

      const def = buildComposedDef(defId);
      registerRuntimeCharacter(def);
      ensureComposedAnims(scene, defId);
      return def;
    } catch (e) {
      console.warn('[appearance] composição falhou:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      inFlight.delete(defId);
    }
  })();

  inFlight.set(defId, job);
  return job;
}

// --------------------------------------------------------------- coleta

/**
 * Destrói texturas/animações/defs compostos que ninguém usa mais (cada
 * receita única retém uma canvas 2208×384 ≈ 3 MB — sem coleta, sessões
 * longas com muitos jogadores acumulam memória sem limite).
 *
 * `inUse` deve conter os defs do jogador local (atual E alvo em transição),
 * dos remotes e das composições pendentes. Builds em voo nunca são
 * coletados (inFlight cobre a janela entre começar e registrar).
 */
export function pruneComposedAppearances(scene: Phaser.Scene, inUse: ReadonlySet<string>): void {
  if (!scene.sys || !scene.textures || !scene.anims) return;
  for (const defId of listRuntimeCharacterIds()) {
    if (inUse.has(defId) || inFlight.has(defId)) continue;
    for (const spec of MOVEMENT_SPECS) {
      for (const direction of DIRECTION_ROWS) {
        const key = animKeyFor(defId, spec.movement, direction);
        if (scene.anims.exists(key)) scene.anims.remove(key);
      }
    }
    const texKey = composedTextureKey(defId);
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey);
    unregisterRuntimeCharacter(defId);
  }
}
