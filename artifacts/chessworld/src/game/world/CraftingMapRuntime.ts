import Phaser from 'phaser';
import {
  CRAFTING_MAP,
  RESOURCES_BASE,
  TREE_TYPES,
  TREE_SHEET,
  treeTextureKey,
  treeSheetUrl,
  treeFallAnimKey,
  MINERALS,
  MINERAL_SHEET,
  mineralTextureKey,
  HAND_STONE,
  BUSH,
  BRANCH,
  craftDepthForY,
  ANIMALS,
  ANIMAL_SHEET,
  ANIMAL_DIRECTIONS,
  ANIMAL_WANDER,
  ANIMAL_RESPAWN_PROTECT_MS,
  animalTextureKey,
  animalWalkTextureKey,
  animalDieTextureKey,
  animalAnimKey,
  ANIMAL_DROP_ITEMS,
  animalDropTextureKey,
  animalDropUrl,
  HERBS,
  herbTextureKey,
  herbUrl,
  RESOURCE_DROP,
  ANIMAL_FLEE,
  SELF_DROP_SCALE,
  mineralBreakAnimKey,
  mineralDropTextureKey,
  mineralDropUrl,
  treeDropTextureKey,
  treeDropUrl,
  type AnimalDef,
  type AnimalDirection,
  type TreeType,
} from '../config/craftingMapConfig';
import { getTextureKeyForTileset } from '../config/worldAssets';
import { loadCollectionWorldConfig } from '../config/collectionConfigLoader';
import {
  ANIMAL_DROP_ITEM_KEYS,
  DEFAULT_ANIMAL_DROP_COUNT,
  DEFAULT_DROP_COUNT,
  DEFAULT_RESPAWN_SECONDS,
  DEFAULT_RESOURCE_HP,
  DEFAULT_FLEE_RADIUS,
  DEFAULT_HAND_POWER,
  HAND_POWER_RANGE,
  RESOURCE_MIN_LEVEL_RANGE,
  defaultGatherToolFor,
  isGatherToolKind,
  lockedHpFloorFor,
  yieldItemKeyFor,
  type CollectionWorldConfig,
  type GatherToolKind,
  type ResourceHurtbox,
} from '../../shared/collection/CollectionShapes';
import { sweepPath } from './moveSweep';
import { queueCollect, queueToolWear } from '../../stores/collectionInventoryStore';
import { gatherAudio } from '../audio/gatherAudio';

/**
 * Runtime do Mundo de Coleta.
 *
 * O pipeline padrão do WorldScene assume tilesets registrados em worldAssets e
 * texturas pré-carregadas. Este módulo cobre o que falta para o CraftingWorld:
 *  - carrega sob demanda as texturas dos tilesets embutidos (plugin crafting-map);
 *  - desenha células e objetos de tilesets image-collection (o createLayer do
 *    Phaser não renderiza tiles de collections);
 *  - anima os tiles de água (animações do Tiled);
 *  - posiciona os recursos: árvores, minérios, pedras de mão e arbustos.
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+)|(-+$)/g, '');

interface CollectionTexEntry {
  key: string;
  url: string;
  width: number;
  height: number;
}

interface AnimCell {
  layer: Phaser.Tilemaps.TilemapLayer;
  x: number;
  y: number;
  frames: number[]; // gids
}

/** Estado do passeio de um animal (IA local: comer parado ↔ andar até um ponto perto de casa). */
interface AnimalAgent {
  sprite: Phaser.GameObjects.Sprite;
  def: AnimalDef;
  homeX: number;
  homeY: number;
  state: 'eat' | 'walk';
  dir: AnimalDirection;
  /** No estado eat: tempo restante em ms até o próximo passeio. */
  timerMs: number;
  targetX: number;
  targetY: number;
  /** Fuga (após golpe): até quando foge e âncora do raio (ponto do 1º golpe). */
  fleeUntilMs?: number;
  fleeAnchorX?: number;
  fleeAnchorY?: number;
  /** Sinal da tangente escolhido ao encostar na borda do raio (evita flip-flop). */
  fleeTangentSign?: 1 | -1;
  /** Animação só pode trocar depois deste timestamp (anti-flicker de frames). */
  animLockUntilMs?: number;
  /** Abatido: update() ignora o bicho enquanto a animação de morte toca. */
  dead?: boolean;
}

/** Nó de recurso golpeável: HP (admin) − poder do item por golpe → quebra/coleta. */
interface ResourceNode {
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  /** Chave de hurtbox do admin: mineral:<id> | tree:<tipo> | herb:<id> | bush | hand_stone | branch | animal:<id>. */
  key: string;
  kind: 'mineral' | 'tree' | 'herb' | 'bush' | 'hand_stone' | 'branch' | 'animal';
  id: string;
  /** HP restante; -1 = ainda não inicializado (lê a config no 1º golpe). */
  hp: number;
  broken: boolean;
  /** Quando renasce (scene.time.now em ms); definido ao quebrar. */
  respawnAtMs?: number;
  /** Animal recém-renascido é intocável até aqui (anti abate duplo). */
  protectedUntilMs?: number;
  /** Barrinha de HP (aparece ao golpear; some ao quebrar ou por inatividade). */
  hpBar?: Phaser.GameObjects.Graphics;
  /** Instante (scene.time.now) em que a barrinha some sem novos golpes. */
  hpBarUntilMs?: number;
  /** Throttle dos avisos flutuantes ("Ferramenta muito fraca!" etc.) — um por vez por nó. */
  weakMsgUntilMs?: number;
}

/** Mini-item dropado por um nó quebrado (pulo → imã → coleta). */
interface DropItem {
  sprite: Phaser.GameObjects.Image;
  /** 'pop' durante o tween inicial/sumiço; 'idle' esperando o imã. */
  state: 'pop' | 'idle';
  /** Chave do item para o inventário (igual à chave do nó). */
  itemKey: string;
}

/**
 * Estado do golpe do jogador consultado a cada frame (injetado pelo
 * WorldScene): hitboxes da ARMA equipada, vindas do perfil autorado no
 * Character Rig Controller (/admin/rigs), já em coordenadas de mundo.
 */
export interface PlayerSwingState {
  /** Identidade do golpe — cada golpe acerta no máximo um nó. */
  swingId: number;
  playerX: number;
  playerY: number;
  /** Hitboxes do frame ATUAL da animação (vazio = frame sem hitbox). */
  rects: Phaser.Geom.Rectangle[];
  /** Poder de coleta do item equipado — HP tirado do nó neste golpe. */
  power: number;
  /** Tipo de ferramenta equipada ('hand' = mão limpa; null = arma comum). */
  toolKind: GatherToolKind | null;
  /** Nível da ferramenta (0..6) — comparado ao nível mínimo do recurso. */
  toolLevel: number;
  /** Ref equipada (gen:crafttools/... consome durabilidade ao acertar; '' = mão). */
  toolRef: string;
}

/** Dados de um golpe/flecha que conectou num nó (subconjunto do swing state). */
export type SwingHit = Pick<PlayerSwingState, 'power' | 'toolKind' | 'toolLevel' | 'toolRef'>;

const GID_FLAGS = 0x0fffffff;
const FLIPPED_H = 0x80000000;
const FLIPPED_V = 0x40000000;

/**
 * Visual do mini-drop de um ITEM de inventário (não do nó): minério/tronco
 * têm sprite de drop próprio; erva/arbusto/galho reusam a textura reduzida.
 * Chaveado pelo item para que nós que rendem outro item (pedra de mão →
 * Pedra comum) soltem exatamente o visual do item creditado.
 */
function dropVisualForItem(itemKey: string): { textureKey: string; scale: number } | null {
  if (itemKey.startsWith('mineral:')) {
    return { textureKey: mineralDropTextureKey(itemKey.slice('mineral:'.length)), scale: 1 };
  }
  if (itemKey.startsWith('tree:')) {
    return { textureKey: treeDropTextureKey(itemKey.slice('tree:'.length) as TreeType), scale: 1 };
  }
  if (itemKey.startsWith('herb:')) {
    return { textureKey: herbTextureKey(itemKey.slice('herb:'.length)), scale: SELF_DROP_SCALE.herb };
  }
  if (itemKey === 'bush') return { textureKey: BUSH.textureKey, scale: SELF_DROP_SCALE.bush };
  if (itemKey === 'branch') return { textureKey: BRANCH.textureKey, scale: SELF_DROP_SCALE.branch };
  return null;
}

export class CraftingMapRuntime {
  private scene: Phaser.Scene;
  /** tiledName → textureKey (tilesets-spritesheet; nomes duplicados compartilham textura via URL). */
  private sheetTextureByName = new Map<string, string>();
  /** `${tiledName}:${localId}` → textura de tile de collection usado no mapa. */
  private collectionTextures = new Map<string, CollectionTexEntry>();
  private sprites: (Phaser.GameObjects.Image | Phaser.GameObjects.Sprite)[] = [];
  private animals: AnimalAgent[] = [];
  /** Config do admin (quantidades de minérios + hurtboxes); null → defaults do código. */
  private worldConfig: CollectionWorldConfig | null = null;
  /** Nós golpeáveis do mapa atual (recursos + animais). */
  private nodes: ResourceNode[] = [];
  /** Drops vivos (pulo → imã → coleta). */
  private drops: DropItem[] = [];
  private animEvent: Phaser.Time.TimerEvent | null = null;
  private animTick = 0;
  private missing: string[] = [];
  private prepared = false;

  /** Ativo enquanto o mapa atual é o CraftingWorld (liga o y-sort do player). */
  active = false;
  mapHeightPx: number = CRAFTING_MAP.tileSize;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  isCraftingPath(mapPath: string): boolean {
    return mapPath === CRAFTING_MAP.path;
  }

  /** Consulta de colisão do mapa (grade do pathfinder); null = sem colisão. */
  private isBlockedAt: ((x: number, y: number) => boolean) | null = null;

  /** Injetada pelo WorldScene ao montar o mapa — animais respeitam as colisões do jogador. */
  setCollisionQuery(fn: (x: number, y: number) => boolean): void {
    this.isBlockedAt = fn;
  }

  /** Consulta do golpe atual (hitboxes do rig/arma); null = fora de golpe. */
  private playerSwingQuery: (() => PlayerSwingState | null) | null = null;
  /** Último golpe que já conectou — um golpe nunca acerta duas vezes. */
  private lastConsumedSwingId = 0;
  /** Último golpe cujo INÍCIO já assustou os bichos — um susto por golpe. */
  private lastScaredSwingId = 0;
  /** Acumulador do check de respawn — varrer ~450 nós a 60fps é desperdício. */
  private respawnAccMs = 0;
  /** Nós com barrinha de HP ativa agora (evita varrer todos os nós por frame). */
  private nodesWithBar = new Set<ResourceNode>();
  /** Contador de frames p/ escalonar a IA dos animais fora da tela. */
  private frameTick = 0;

  /** Injetada pelo WorldScene — o golpe do jogador vem do perfil de hitbox da arma. */
  setPlayerSwingQuery(fn: () => PlayerSwingState | null): void {
    this.playerSwingQuery = fn;
  }

  /**
   * Movimento com colisão: varre o trajeto em substeps de meia célula (nunca
   * atravessa bloqueio fino, mesmo em frame lento); se barrar, desliza num
   * eixo só, também com varredura.
   */
  private tryMove(
    spr: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image,
    nx: number,
    ny: number,
  ): { dx: number; dy: number } | null {
    const blocked = this.isBlockedAt;
    const fromX = spr.x;
    const fromY = spr.y;
    if (!blocked) {
      spr.setPosition(nx, ny);
      return { dx: nx - fromX, dy: ny - fromY };
    }
    let r = sweepPath(fromX, fromY, nx, ny, blocked);
    if (!r.moved && nx !== fromX) r = sweepPath(fromX, fromY, nx, fromY, blocked);
    if (!r.moved && ny !== fromY) r = sweepPath(fromX, fromY, fromX, ny, blocked);
    if (!r.moved) return null; // totalmente barrado
    spr.setPosition(r.x, r.y);
    return { dx: r.x - fromX, dy: r.y - fromY };
  }

  /** Garante TMJ no cache + todas as texturas necessárias carregadas. */
  async prepare(): Promise<void> {
    const scene = this.scene;

    // SFX de coleta: baixa/decodifica em paralelo com o mapa — no 1º golpe o
    // buffer já está pronto e o som sai sem atraso (init é idempotente).
    void gatherAudio.init();

    // Config do admin relida a cada entrada — mudanças valem na próxima visita.
    this.worldConfig = await loadCollectionWorldConfig();

    if (!scene.cache.tilemap.has(CRAFTING_MAP.key)) {
      await this.runLoader(() => {
        scene.load.tilemapTiledJSON(CRAFTING_MAP.key, CRAFTING_MAP.path);
      });
    }
    const tmj = scene.cache.tilemap.get(CRAFTING_MAP.key)?.data;
    if (!tmj) throw new Error('[CraftingMap] TMJ embutido não carregou — veja o console do vite (plugin crafting-map).');
    this.mapHeightPx = (tmj.height || 1) * (tmj.tileheight || CRAFTING_MAP.tileSize);

    if (this.prepared) return;

    const usedByTs = this.collectUsedTileIds(tmj);
    const queued = new Map<string, string>(); // textureKey → url (p/ relatar faltantes com caminho legível)

    await this.runLoader(() => {
      for (const ts of tmj.tilesets || []) {
        if (ts.image) {
          // Tileset-spritesheet. Registry primeiro (ex.: floors2 → textura do mapa principal).
          const registryKey = getTextureKeyForTileset(ts.name);
          if (registryKey) {
            this.sheetTextureByName.set(ts.name, registryKey);
            continue;
          }
          // Chave por URL: tilesets duplicados (mesma imagem) compartilham textura.
          const key = `cw-img-${slug(String(ts.image))}`;
          this.sheetTextureByName.set(ts.name, key);
          if (!scene.textures.exists(key) && !queued.has(key)) {
            scene.load.image(key, encodeURI(String(ts.image)));
            queued.set(key, String(ts.image));
          }
        } else if (Array.isArray(ts.tiles)) {
          // Image collection: só os tiles que o mapa realmente usa.
          const used = usedByTs.get(ts.name);
          if (!used) continue;
          for (const tile of ts.tiles) {
            if (!tile.image || !used.has(tile.id)) continue;
            const key = `cw-img-${slug(String(tile.image))}`;
            this.collectionTextures.set(`${ts.name}:${tile.id}`, {
              key,
              url: String(tile.image),
              width: tile.imagewidth || 32,
              height: tile.imageheight || 32,
            });
            if (!scene.textures.exists(key) && !queued.has(key)) {
              scene.load.image(key, encodeURI(String(tile.image)));
              queued.set(key, String(tile.image));
            }
          }
        }
      }

      // Recursos coletáveis
      for (const t of TREE_TYPES) {
        if (!scene.textures.exists(treeTextureKey(t))) {
          scene.load.spritesheet(treeTextureKey(t), encodeURI(treeSheetUrl(t)), {
            frameWidth: TREE_SHEET.frameWidth,
            frameHeight: TREE_SHEET.frameHeight,
          });
        }
      }
      for (const m of MINERALS) {
        if (!scene.textures.exists(mineralTextureKey(m.id))) {
          scene.load.spritesheet(mineralTextureKey(m.id), encodeURI(`${RESOURCES_BASE}minerals/${m.file}`), {
            frameWidth: MINERAL_SHEET.frameWidth,
            frameHeight: MINERAL_SHEET.frameHeight,
          });
        }
      }
      if (!scene.textures.exists(HAND_STONE.textureKey)) {
        scene.load.spritesheet(HAND_STONE.textureKey, encodeURI(HAND_STONE.url), {
          frameWidth: HAND_STONE.frameWidth,
          frameHeight: HAND_STONE.frameHeight,
        });
      }
      if (!scene.textures.exists(BUSH.textureKey)) {
        scene.load.image(BUSH.textureKey, encodeURI(BUSH.url));
      }
      if (!scene.textures.exists(BRANCH.textureKey)) {
        scene.load.image(BRANCH.textureKey, encodeURI(BRANCH.url));
      }
      for (const h of HERBS) {
        if (!scene.textures.exists(herbTextureKey(h.id))) {
          scene.load.image(herbTextureKey(h.id), encodeURI(herbUrl(h.file)));
        }
      }
      for (const a of ANIMALS) {
        const size = { frameWidth: a.frameSize, frameHeight: a.frameSize };
        if (!scene.textures.exists(animalTextureKey(a.id))) {
          scene.load.spritesheet(animalTextureKey(a.id), encodeURI(`${RESOURCES_BASE}animais/${a.file}`), size);
        }
        if (!scene.textures.exists(animalWalkTextureKey(a.id))) {
          scene.load.spritesheet(animalWalkTextureKey(a.id), encodeURI(`${RESOURCES_BASE}animais/${a.walkFile}`), size);
        }
        if (!scene.textures.exists(animalDieTextureKey(a.id))) {
          scene.load.spritesheet(animalDieTextureKey(a.id), encodeURI(`${RESOURCES_BASE}animais/${a.dieFile}`), size);
        }
      }

      // Drops (mini-itens que pulam do nó quebrado): minérios 32×32, troncos 64×64.
      for (const m of MINERALS) {
        if (!scene.textures.exists(mineralDropTextureKey(m.id))) {
          scene.load.image(mineralDropTextureKey(m.id), encodeURI(mineralDropUrl(m.file)));
        }
      }
      for (const t of TREE_TYPES) {
        if (!scene.textures.exists(treeDropTextureKey(t))) {
          scene.load.image(treeDropTextureKey(t), encodeURI(treeDropUrl(t)));
        }
      }
      // Itens de abate (drops dos animais): imagens únicas 40×40.
      for (const d of ANIMAL_DROP_ITEMS) {
        if (!scene.textures.exists(animalDropTextureKey(d.key))) {
          scene.load.image(animalDropTextureKey(d.key), encodeURI(animalDropUrl(d.file)));
        }
      }
    });

    // Pixel art: NEAREST em tudo que acabou de entrar. Arquivo ausente no dev
    // server vira HTML (200) → falha no DECODE, não no load: conferir se a
    // textura realmente existe é o único jeito confiável de listar faltantes.
    for (const [key, url] of queued) {
      if (scene.textures.exists(key)) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      else if (!this.missing.includes(url)) this.missing.push(url);
    }
    for (const t of TREE_TYPES) {
      if (scene.textures.exists(treeTextureKey(t))) {
        scene.textures.get(treeTextureKey(t)).setFilter(Phaser.Textures.FilterMode.NEAREST);
        if (!scene.anims.exists(treeFallAnimKey(t))) {
          scene.anims.create({
            key: treeFallAnimKey(t),
            frames: scene.anims.generateFrameNumbers(treeTextureKey(t), { start: 0, end: TREE_SHEET.frames - 1 }),
            frameRate: 12,
            repeat: 0,
          });
        }
      }
    }
    for (const m of MINERALS) {
      if (scene.textures.exists(mineralTextureKey(m.id))) {
        scene.textures.get(mineralTextureKey(m.id)).setFilter(Phaser.Textures.FilterMode.NEAREST);
        if (!scene.anims.exists(mineralBreakAnimKey(m.id))) {
          scene.anims.create({
            key: mineralBreakAnimKey(m.id),
            frames: scene.anims.generateFrameNumbers(mineralTextureKey(m.id), { start: 0, end: MINERAL_SHEET.frames - 1 }),
            frameRate: 14,
            repeat: 0,
          });
        }
      }
      if (scene.textures.exists(mineralDropTextureKey(m.id))) {
        scene.textures.get(mineralDropTextureKey(m.id)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    for (const t of TREE_TYPES) {
      if (scene.textures.exists(treeDropTextureKey(t))) {
        scene.textures.get(treeDropTextureKey(t)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    if (scene.textures.exists(HAND_STONE.textureKey)) {
      scene.textures.get(HAND_STONE.textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    if (scene.textures.exists(BUSH.textureKey)) {
      scene.textures.get(BUSH.textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    if (scene.textures.exists(BRANCH.textureKey)) {
      scene.textures.get(BRANCH.textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    for (const d of ANIMAL_DROP_ITEMS) {
      if (scene.textures.exists(animalDropTextureKey(d.key))) {
        scene.textures.get(animalDropTextureKey(d.key)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    for (const h of HERBS) {
      if (scene.textures.exists(herbTextureKey(h.id))) {
        scene.textures.get(herbTextureKey(h.id)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    // Animais: cada sheet tem 4 linhas de 7 frames — uma animação por direção.
    // eat/walk repetem em loop; die toca UMA vez (abate) e congela no fim.
    for (const a of ANIMALS) {
      const sheets: Array<['eat' | 'walk' | 'die', string, number]> = [
        ['eat', animalTextureKey(a.id), ANIMAL_SHEET.eatFrameRate],
        ['walk', animalWalkTextureKey(a.id), ANIMAL_SHEET.walkFrameRate],
        ['die', animalDieTextureKey(a.id), ANIMAL_SHEET.dieFrameRate],
      ];
      for (const [action, key, frameRate] of sheets) {
        if (!scene.textures.exists(key)) continue;
        scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
        ANIMAL_DIRECTIONS.forEach((dir, row) => {
          const animKey = animalAnimKey(a.id, action, dir);
          if (!scene.anims.exists(animKey)) {
            scene.anims.create({
              key: animKey,
              frames: scene.anims.generateFrameNumbers(key, {
                start: row * ANIMAL_SHEET.columns,
                end: row * ANIMAL_SHEET.columns + ANIMAL_SHEET.frames - 1,
              }),
              frameRate,
              repeat: action === 'die' ? 0 : -1,
            });
          }
        });
      }
    }

    if (this.missing.length) {
      console.warn('[CraftingMap] imagens que faltaram no projeto (células/sprites ficam vazios até serem adicionadas):', this.missing);
    }
    this.prepared = true;
  }

  /** Fallback de resolução de textura por nome de tileset (usado pelo switchMap). */
  textureKeyForTileset(tiledName: string): string | null {
    return this.sheetTextureByName.get(tiledName) ?? null;
  }

  /** Chamado pelo switchMap depois das camadas padrão serem criadas. */
  postBuild(map: Phaser.Tilemaps.Tilemap, tmjData: any) {
    // Golpe iniciado ANTES de (re)entrar no mapa não vale contra nós recém-
    // criados: consome qualquer golpe em andamento na abertura da sessão.
    const inFlight = this.playerSwingQuery?.();
    if (inFlight) {
      this.lastConsumedSwingId = inFlight.swingId;
      this.lastScaredSwingId = inFlight.swingId;
    }
    this.active = true;
    this.placeCollectionContent(tmjData);
    this.startTileAnimations(map);
    this.placeResources(tmjData);
  }

  teardown() {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    this.animals = [];
    for (const n of this.nodes) n.hpBar?.destroy(); // barrinhas são Graphics à parte
    this.nodes = [];
    this.nodesWithBar.clear();
    for (const d of this.drops) d.sprite.destroy();
    this.drops = [];
    if (this.animEvent) {
      this.animEvent.remove();
      this.animEvent = null;
    }
    this.animTick = 0;
    this.active = false;
  }

  depthForY(y: number): number {
    return craftDepthForY(y, this.mapHeightPx);
  }

  /** Passeio/fuga dos animais + drops + respawns — chamado pelo WorldScene.update(). */
  update(deltaMs: number, playerX?: number, playerY?: number) {
    if (!this.active) return;
    this.pollPlayerSwing();
    this.updateDrops(deltaMs, playerX, playerY);
    // Respawn tem precisão de segundos — checar 4x/s já sobra (era 60x/s).
    this.respawnAccMs += deltaMs;
    if (this.respawnAccMs >= 250) {
      this.respawnAccMs = 0;
      this.updateRespawns();
    }
    this.updateNodeHpBars();
    const now = this.scene.time.now;
    this.frameTick = (this.frameTick + 1) & 0xffff;
    // Culling leve de IA: bicho fora da tela (folga de 160px) "pensa" a cada
    // 4 frames com delta 4x — mesmo ritmo de passeio, ~1/4 do custo. Fugindo
    // nunca é pulado (reage ao jogador em tempo real).
    const view = this.scene.cameras.main.worldView;
    const viewL = view.x - 160;
    const viewR = view.right + 160;
    const viewT = view.y - 160;
    const viewB = view.bottom + 160;
    let slot = 0;
    for (const ag of this.animals) {
      const mySlot = slot++;
      if (!ag.sprite.active) continue;
      if (ag.dead) continue; // abatido: parado até a animação de morte acabar
      let effDelta = deltaMs;
      if (ag.fleeUntilMs === undefined) {
        const sx = ag.sprite.x;
        const sy = ag.sprite.y;
        if (sx < viewL || sx > viewR || sy < viewT || sy > viewB) {
          if (((this.frameTick + mySlot) & 3) !== 0) continue;
          effDelta = deltaMs * 4; // compensa os 3 frames pulados
        }
      }
      if (ag.fleeUntilMs !== undefined) {
        if (now < ag.fleeUntilMs) {
          this.updateFlee(ag, deltaMs, playerX, playerY);
          continue;
        }
        // Fim da fuga: volta ao ciclo comer/andar.
        ag.fleeUntilMs = undefined;
        ag.state = 'eat';
        ag.timerMs = ANIMAL_WANDER.eatMinMs + Math.random() * (ANIMAL_WANDER.eatMaxMs - ANIMAL_WANDER.eatMinMs);
        ag.sprite.play(animalAnimKey(ag.def.id, 'eat', ag.dir));
        continue;
      }
      if (ag.state === 'eat') {
        ag.timerMs -= effDelta;
        if (ag.timerMs > 0) continue;
        // Destino perto de "casa" que não caia numa colisão do mapa.
        let found = false;
        for (let attempt = 0; attempt < 8 && !found; attempt++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = ANIMAL_WANDER.radius * (0.35 + 0.65 * Math.random());
          const tx = ag.homeX + Math.cos(ang) * rad;
          const ty = ag.homeY + Math.sin(ang) * rad;
          if (this.isBlockedAt?.(tx, ty)) continue;
          ag.targetX = tx;
          ag.targetY = ty;
          found = true;
        }
        if (!found) {
          ag.timerMs = 900; // tudo bloqueado por perto — tenta de novo já já
          continue;
        }
        const dx = ag.targetX - ag.sprite.x;
        const dy = ag.targetY - ag.sprite.y;
        ag.dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north');
        ag.state = 'walk';
        ag.sprite.play(animalAnimKey(ag.def.id, 'walk', ag.dir));
      } else {
        const dx = ag.targetX - ag.sprite.x;
        const dy = ag.targetY - ag.sprite.y;
        const dist = Math.hypot(dx, dy);
        const step = (ag.def.speed * effDelta) / 1000;
        const arrived = dist <= step || dist === 0;
        const moved = arrived
          ? this.tryMove(ag.sprite, ag.targetX, ag.targetY)
          : this.tryMove(ag.sprite, ag.sprite.x + (dx / dist) * step, ag.sprite.y + (dy / dist) * step);
        if (arrived || !moved) {
          // Chegou — ou uma colisão barrou o caminho: para onde está e come.
          ag.state = 'eat';
          ag.timerMs = ANIMAL_WANDER.eatMinMs + Math.random() * (ANIMAL_WANDER.eatMaxMs - ANIMAL_WANDER.eatMinMs);
          ag.sprite.play({
            key: animalAnimKey(ag.def.id, 'eat', ag.dir),
            startFrame: Math.floor(Math.random() * ANIMAL_SHEET.frames),
          });
        }
        ag.sprite.setDepth(this.depthForY(ag.sprite.y));
      }
    }
  }

  /** Fuga: afasta do jogador, presa ao raio da âncora e às colisões do mapa. */
  private updateFlee(ag: AnimalAgent, deltaMs: number, playerX?: number, playerY?: number): void {
    const spr = ag.sprite;
    const ax = ag.fleeAnchorX ?? spr.x;
    const ay = ag.fleeAnchorY ?? spr.y;
    const srcX = playerX ?? ax;
    const srcY = playerY ?? ay;
    let vx = spr.x - srcX;
    let vy = spr.y - srcY;
    let len = Math.hypot(vx, vy);
    if (len < 0.001) {
      const a = Math.random() * Math.PI * 2;
      vx = Math.cos(a);
      vy = Math.sin(a);
      len = 1;
    }
    vx /= len;
    vy /= len;
    const radius = this.fleeRadiusFor(`animal:${ag.def.id}`);
    // Frame lento (aba em 2º plano/stall) não vira teleporte: delta limitado a
    // 100ms e passo a 45% do raio — assim o 1º passo saindo da âncora nunca
    // estoura a borda com vetor radial zero (que travava o bicho parado).
    const dt = Math.min(deltaMs, 100);
    const step = Math.min((this.fleeSpeedFor(ag) * dt) / 1000, radius * 0.45);
    let nx = spr.x + vx * step;
    let ny = spr.y + vy * step;
    const nextDist = Math.hypot(nx - ax, ny - ay);
    if (nextDist > radius) {
      // Borda do raio: desliza pela tangente, com leve puxão para dentro.
      // O sinal da tangente é escolhido UMA vez por encosto — o flip-flop a
      // cada frame era uma das causas do flicker de frames.
      const rx = spr.x - ax;
      const ry = spr.y - ay;
      const rlen = Math.hypot(rx, ry);
      if (rlen > 0.001) {
        if (ag.fleeTangentSign === undefined) {
          ag.fleeTangentSign = (-ry / rlen) * vx + (rx / rlen) * vy >= 0 ? 1 : -1;
        }
        const s = ag.fleeTangentSign;
        const dx = (s * -ry) / rlen - (rx / rlen) * 0.35;
        const dy = (s * rx) / rlen - (ry / rlen) * 0.35;
        const dlen = Math.hypot(dx, dy) || 1;
        vx = dx / dlen;
        vy = dy / dlen;
        nx = spr.x + vx * step;
        ny = spr.y + vy * step;
      }
      // rlen≈0 (em cima da âncora): passo já limitado a 0.45×raio, segue reto.
    } else if (nextDist < radius * 0.85) {
      ag.fleeTangentSign = undefined; // longe da borda — libera o próximo encosto
    }
    const moved = this.tryMove(spr, nx, ny);
    if (moved) {
      spr.setDepth(this.depthForY(spr.y));
      const mlen = Math.hypot(moved.dx, moved.dy);
      if (mlen > 0.0001) {
        vx = moved.dx / mlen; // direção real (pós-deslize em paredes)
        vy = moved.dy / mlen;
      }
    }
    // Troca de animação com histerese (>=160ms) — sem frames alternando loucamente.
    const now = this.scene.time.now;
    if (now < (ag.animLockUntilMs ?? 0)) return;
    const dir: AnimalDirection =
      Math.abs(vx) >= Math.abs(vy) ? (vx >= 0 ? 'east' : 'west') : (vy >= 0 ? 'south' : 'north');
    const animKey = animalAnimKey(ag.def.id, 'walk', dir);
    if (ag.state !== 'walk' || ag.dir !== dir || spr.anims.currentAnim?.key !== animKey) {
      ag.state = 'walk';
      ag.dir = dir;
      spr.play(animKey);
      ag.animLockUntilMs = now + 160;
    }
  }

  /** Devolve nós quebrados cujo cooldown terminou. */
  private updateRespawns(): void {
    if (!this.nodes.length) return;
    const now = this.scene.time.now;
    for (const node of this.nodes) {
      if (!node.broken || node.respawnAtMs === undefined || now < node.respawnAtMs) continue;
      this.respawnNode(node);
    }
  }

  /** Restaura um nó quebrado (árvore: toco → frame 0; demais: reaparecem com pop). */
  private respawnNode(node: ResourceNode): void {
    const spr = node.sprite;
    if (!spr.active) return; // destruído no teardown — não ocorre com o mapa ativo
    node.hp = -1; // volta "cheio": relê a config do admin no próximo golpe
    node.broken = false;
    node.respawnAtMs = undefined;
    this.hideNodeHpBar(node);
    if ((node.kind === 'mineral' || node.kind === 'tree') && spr instanceof Phaser.GameObjects.Sprite) {
      spr.setFrame(0); // sai do último frame da quebra/toco
    }
    if (node.kind === 'tree') return; // árvore nunca sumiu (toco) — só volta inteira
    spr.setVisible(true);
    spr.setAlpha(1);
    spr.setScale(0.7); // pop de nascimento
    this.scene.tweens.add({ targets: spr, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
  }

  // ------------------------------------------------------------------
  // golpes em recursos (HP do admin − poder do item; HP ≤ 0 → quebra + drops)
  // ------------------------------------------------------------------

  /** Retângulos de trabalho — o teste de golpe visita ~450 nós por frame
   *  durante um golpe; alocar um Rectangle novo por nó era lixo para o GC. */
  private readonly hitScratchRect = new Phaser.Geom.Rectangle();
  private readonly barScratchRect = new Phaser.Geom.Rectangle();

  /** Hurtbox do admin (px do frame fonte, ancorada no pé do sprite) → retângulo no mundo.
   *  Com `out`, reutiliza o retângulo dado (o valor só vale até a próxima chamada). */
  private nodeHurtboxRect(node: ResourceNode, out?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    const spr = node.sprite;
    const hb: ResourceHurtbox | undefined = this.worldConfig?.hurtboxes?.[node.key];
    const frameW = spr.frame?.realWidth ?? spr.width;
    const frameH = spr.frame?.realHeight ?? spr.height;
    const sx = spr.scaleX || 1;
    const sy = spr.scaleY || 1;
    const w = (hb?.width ?? frameW) * sx;
    const h = (hb?.height ?? frameH) * sy;
    const cx = spr.x + (hb?.offsetX ?? 0) * sx;
    const bottom = spr.y - (hb?.offsetY ?? 0) * sy;
    const rect = out ?? new Phaser.Geom.Rectangle();
    rect.setTo(cx - w / 2, bottom - h, w, h);
    return rect;
  }

  /**
   * Nó que as hitboxes atuais acertariam: entre os nós cuja hurtbox toca
   * alguma hitbox do frame, vence o mais próximo do jogador. (Fase de teste:
   * QUALQUER arma/ferramenta acerta QUALQUER elemento; o pareamento
   * ferramenta→elemento, ex. minério exige picareta, vem depois.)
   */
  private swingTargetFor(state: PlayerSwingState): ResourceNode | null {
    return this.nearestNodeHitBy(state.rects, state.playerX, state.playerY);
  }

  /** Nó não quebrado cuja hurtbox toca algum retângulo, mais próximo de (x,y). */
  private nearestNodeHitBy(rects: Phaser.Geom.Rectangle[], x: number, y: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestDist = Infinity;
    const now = this.scene.time.now;
    for (const node of this.nodes) {
      if (node.broken || !node.sprite.active) continue;
      if ((node.protectedUntilMs ?? 0) > now) continue; // recém-renascido: golpe atravessa
      const hurt = this.nodeHurtboxRect(node, this.hitScratchRect);
      if (!rects.some((r) => Phaser.Geom.Rectangle.Overlaps(r, hurt))) continue;
      const d = Phaser.Math.Distance.Between(x, y, node.sprite.x, node.sprite.y);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  /**
   * Acerto de PROJÉTIL (flecha do arco): testa a hitbox de mundo da flecha
   * contra as hurtboxes dos nós — o dano da flecha (levels no admin) vira HP
   * tirado do nó. O chamador garante 1 acerto por flecha ("morre" ao conectar).
   */
  tryProjectileHit(rects: Phaser.Geom.Rectangle[], x: number, y: number, damage = 1): boolean {
    if (!this.nodes.length || rects.length === 0) return false;
    const best = this.nearestNodeHitBy(rects, x, y);
    if (!best) return false;
    // Flecha nunca é ferramenta: com o pareamento ferramenta→recurso ela só
    // dá o feedback de "item errado" (e segue espantando os animais).
    this.applyHit(best, { power: damage, toolKind: null, toolLevel: 0, toolRef: '' });
    return true;
  }

  /**
   * Golpe frame a frame: enquanto a animação de ataque mostra hitboxes (perfil
   * da arma no Character Rig Controller), testa contra as hurtboxes dos nós.
   * O golpe conecta no PRIMEIRO frame em que uma hitbox toca um nó — e cada
   * golpe (swingId) acerta no máximo uma vez.
   */
  private pollPlayerSwing(): void {
    if (!this.nodes.length) return;
    const state = this.playerSwingQuery?.();
    if (!state) return;
    // COMEÇAR um golpe já assusta vaca/ovelha por perto (uma vez por golpe) —
    // inclusive nos frames de "windup" sem hitbox autorada: o bicho reage ao
    // ataque em si, não só ao golpe que conecta.
    if (state.swingId !== this.lastScaredSwingId) {
      this.lastScaredSwingId = state.swingId;
      this.scareNearbyAnimals(state.playerX, state.playerY);
    }
    if (state.rects.length === 0) return;
    if (state.swingId === this.lastConsumedSwingId) return;
    const best = this.swingTargetFor(state);
    if (!best) return;
    this.lastConsumedSwingId = state.swingId;
    this.applyHit(best, state);
  }

  /** Fuga disparada pelo INÍCIO do golpe: vaca/ovelha num raio do jogador correm. */
  private scareNearbyAnimals(px: number, py: number): void {
    for (const ag of this.animals) {
      if (!ag.sprite.active || ag.dead) continue;
      if (Phaser.Math.Distance.Between(px, py, ag.sprite.x, ag.sprite.y) > ANIMAL_FLEE.triggerRadius) continue;
      this.scareAnimal(ag);
    }
  }

  /** Assusta vaca/ovelha (galinha nunca foge): âncora no 1º susto, renova o timer. */
  private scareAnimal(ag: AnimalAgent): void {
    if (ag.dead || ag.def.id === 'chicken') return;
    const now = this.scene.time.now;
    if ((ag.fleeUntilMs ?? 0) <= now) {
      // 1º susto desta fuga: âncora do raio = onde o animal estava.
      ag.fleeAnchorX = ag.sprite.x;
      ag.fleeAnchorY = ag.sprite.y;
      ag.fleeTangentSign = undefined;
      ag.animLockUntilMs = 0; // reage virando na hora
    }
    ag.fleeUntilMs = now + ANIMAL_FLEE.durationMs; // cada susto renova a fuga
  }

  /** Itens por quebra/abate (config do admin; padrão 3 — drops de animal: 1). */
  private dropCountFor(key: string): number {
    const fallback = ANIMAL_DROP_ITEM_KEYS.includes(key) ? DEFAULT_ANIMAL_DROP_COUNT : DEFAULT_DROP_COUNT;
    return this.worldConfig?.dropCounts?.[key] ?? fallback;
  }

  /** Segundos até renascer (config do admin ou padrão 60). */
  private respawnSecondsFor(key: string): number {
    return this.worldConfig?.respawnSeconds?.[key] ?? DEFAULT_RESPAWN_SECONDS;
  }

  /** HP máximo de um nó (config do admin em /admin/mundo-coleta ou padrão). */
  private maxHpFor(key: string): number {
    return this.worldConfig?.resourceHp?.[key] ?? DEFAULT_RESOURCE_HP;
  }

  /**
   * Barrinha de HP sobre o nó golpeado: fundo escuro + preenchimento
   * verde/amarelo/vermelho conforme o HP restante. Redesenhada a cada golpe;
   * some sozinha após ~3 s sem golpes (update) ou quando o nó quebra.
   */
  private showNodeHpBar(node: ResourceNode): void {
    const ratio = Phaser.Math.Clamp(node.hp / Math.max(1, this.maxHpFor(node.key)), 0, 1);
    const w = 30;
    const h = 4;
    const hurt = this.nodeHurtboxRect(node);
    const gfx = node.hpBar ?? this.scene.add.graphics();
    node.hpBar = gfx;
    this.nodesWithBar.add(node);
    gfx.clear();
    gfx.setPosition(node.sprite.x - w / 2, hurt.y - 8);
    gfx.fillStyle(0x000000, 0.55);
    gfx.fillRect(0, 0, w, h);
    const color = ratio > 0.5 ? 0x22c55e : ratio > 0.25 ? 0xfacc15 : 0xef4444;
    gfx.fillStyle(color, 1);
    gfx.fillRect(1, 1, Math.max(1, Math.round((w - 2) * ratio)), h - 2);
    gfx.setDepth(this.depthForY(node.sprite.y) + 2);
    node.hpBarUntilMs = this.scene.time.now + 3000; // some após ~3 s sem golpes
  }

  /** Destrói a barrinha de HP do nó (quebra, respawn ou timeout). */
  private hideNodeHpBar(node: ResourceNode): void {
    node.hpBar?.destroy();
    node.hpBar = undefined;
    node.hpBarUntilMs = undefined;
    this.nodesWithBar.delete(node);
  }

  /** Esconde barrinhas paradas há mais de ~3 s e segue animais em movimento. */
  private updateNodeHpBars(): void {
    // Só os nós com barrinha ativa (quase sempre 0–2) — não os ~450 do mapa.
    if (this.nodesWithBar.size === 0) return;
    const now = this.scene.time.now;
    for (const node of this.nodesWithBar) {
      if (!node.hpBar) {
        this.nodesWithBar.delete(node); // segurança: barra sumiu por outra via
        continue;
      }
      if (node.hpBarUntilMs !== undefined && now >= node.hpBarUntilMs) {
        this.hideNodeHpBar(node);
        continue;
      }
      // Animal ferido continua andando/fugindo — a barrinha acompanha o bicho.
      if (node.kind === 'animal' && !node.broken && node.sprite.active) {
        const hurt = this.nodeHurtboxRect(node, this.barScratchRect);
        node.hpBar.setPosition(node.sprite.x - 15, hurt.y - 8); // 15 = metade da barra (w 30)
        node.hpBar.setDepth(this.depthForY(node.sprite.y) + 2);
      }
    }
  }

  /** Raio de fuga em px (config do admin ou padrão). */
  private fleeRadiusFor(key: string): number {
    return this.worldConfig?.fleeRadius?.[key] ?? DEFAULT_FLEE_RADIUS;
  }

  /** Velocidade de fuga em px/s (config do admin ou 2.2× o passeio). */
  private fleeSpeedFor(ag: AnimalAgent): number {
    return this.worldConfig?.fleeSpeed?.[`animal:${ag.def.id}`] ?? ag.def.speed * ANIMAL_FLEE.speedMultiplier;
  }

  /**
   * Debug Visuals (/admin): hurtbox de cada recurso/animal (lima), amarelo =
   * nó que o golpe acertaria NESTE frame (mesma regra do gameplay: hitbox da
   * arma × hurtbox + mais próximo) e círculo ciano = raio de fuga. As caixas
   * do PERSONAGEM (hurtbox do rig + hitbox da arma) são desenhadas pelo
   * WorldScene.drawCombatDebug — aqui só o lado dos recursos.
   */
  drawDebug(gfx: Phaser.GameObjects.Graphics): void {
    if (!this.active) return;

    // Mesmo critério do golpe: hitboxes do frame atual (se houver golpe em
    // andamento que ainda não conectou) contra as hurtboxes dos nós.
    const state = this.playerSwingQuery?.();
    const wouldHit =
      state && state.swingId !== this.lastConsumedSwingId && state.rects.length > 0
        ? this.swingTargetFor(state)
        : null;

    for (const node of this.nodes) {
      if (node.broken || !node.sprite.active) continue;
      const r = this.nodeHurtboxRect(node);
      if (node === wouldHit) {
        gfx.fillStyle(0xffe100, 0.14);
        gfx.fillRect(r.x, r.y, r.width, r.height);
        gfx.lineStyle(2, 0xffe100, 1); // amarelo: este seria acertado agora
      } else {
        gfx.lineStyle(1, 0x00ff66, 0.9); // lima: hurtbox (mesma cor do combate)
      }
      gfx.strokeRect(r.x, r.y, r.width, r.height);
    }

    // Fuga em andamento: âncora + raio.
    const now = this.scene.time.now;
    for (const ag of this.animals) {
      if (ag.fleeUntilMs === undefined || now >= ag.fleeUntilMs) continue;
      const ax = ag.fleeAnchorX ?? ag.sprite.x;
      const ay = ag.fleeAnchorY ?? ag.sprite.y;
      gfx.lineStyle(1, 0x00e5ff, 0.6);
      gfx.strokeCircle(ax, ay, this.fleeRadiusFor(`animal:${ag.def.id}`));
      gfx.fillStyle(0x00e5ff, 0.9);
      gfx.fillCircle(ax, ay, 2.5);
    }
  }

  /** Ferramenta que EXTRAI este recurso (admin em /admin/mundo-coleta ou padrão por tipo). */
  private requiredToolFor(key: string): GatherToolKind {
    const configured = this.worldConfig?.resourceTool?.[key];
    return isGatherToolKind(configured) ? configured : defaultGatherToolFor(key);
  }

  /** Nível mínimo da ferramenta para EXTRAIR este recurso (admin; padrão 0). */
  private minLevelFor(key: string): number {
    const raw = this.worldConfig?.resourceMinLevel?.[key] ?? RESOURCE_MIN_LEVEL_RANGE.min;
    return Phaser.Math.Clamp(Math.round(raw), RESOURCE_MIN_LEVEL_RANGE.min, RESOURCE_MIN_LEVEL_RANGE.max);
  }

  /** Poder de coleta da MÃO (admin em /admin/mundo-coleta; padrão 1). Nível da mão é sempre 0. */
  private handPower(): number {
    const raw = this.worldConfig?.handPower ?? DEFAULT_HAND_POWER;
    return Phaser.Math.Clamp(Math.round(raw), HAND_POWER_RANGE.min, HAND_POWER_RANGE.max);
  }

  /**
   * Ferramenta aceita pelo recurso: a configurada no admin — e, para recursos
   * "de MÃO", também a ferramenta da FAMÍLIA do tipo (pedra de mão→picareta,
   * galho→machado, arbusto→facão): quem já está com a ferramenta certa na mão
   * não precisa guardá-la para coletar a versão menor do recurso.
   */
  private toolAllowedFor(node: ResourceNode, used: GatherToolKind | null): boolean {
    const required = this.requiredToolFor(node.key);
    if (used === required) return true;
    if (required === 'hand' && used !== null) {
      const family: Partial<Record<ResourceNode['kind'], GatherToolKind>> = {
        hand_stone: 'pickaxe',
        branch: 'axe',
        bush: 'machete',
      };
      return used === family[node.kind];
    }
    return false;
  }

  /** Flash de tinta curto no nó (branco = golpe válido; vermelho = item errado). */
  private flashNode(spr: ResourceNode['sprite'], color: number): void {
    // Phaser 4: fill-tint é setTint + setTintMode (setTintFill não recebe cor).
    spr.setTint(color);
    spr.setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(90, () => {
      if (spr.active) {
        spr.clearTint();
        spr.setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
  }

  /** Aviso flutuante sobre o nó ("Ferramenta muito fraca!", "Utilize a sua arma principal!"…). */
  private showNodeMessage(node: ResourceNode, message: string): void {
    const now = this.scene.time.now;
    if ((node.weakMsgUntilMs ?? 0) > now) return; // throttle: um aviso por vez por nó
    node.weakMsgUntilMs = now + 1200;
    const hurt = this.nodeHurtboxRect(node);
    // Contra-escala 1/zoom: o aviso mantém o MESMO tamanho na tela em qualquer
    // zoom (como os name tags DOM) — sem isso, a 0.5x o texto de 10px virava
    // ~5px ilegíveis.
    const camZoom = this.scene.cameras.main.zoom || 1;
    const txt = this.scene.add
      .text(node.sprite.x, hurt.y - 12, message, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#fecaca',
        stroke: '#7f1d1d',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(this.depthForY(node.sprite.y) + 3)
      .setResolution(Math.max(2, Math.ceil(window.devicePixelRatio || 1)))
      .setScale(1 / camZoom);
    this.scene.tweens.add({
      targets: txt,
      y: txt.y - 14 / camZoom,
      alpha: 0,
      duration: 1100,
      ease: 'Quad.easeOut',
      onComplete: () => txt.destroy(),
    });
  }

  /**
   * Regras de um golpe/flecha que CONECTOU num nó:
   *  1. Qualquer acerto consome durabilidade da FERRAMENTA usada (item errado
   *     e nível baixo também — golpe no vento não passa por aqui). Exceção:
   *     animal protegido pós-respawn — o golpe atravessa sem efeito algum.
   *  2. Animais: SÓ a arma do personagem (toolKind null — espada/arco etc.) ou
   *     a MÃO (poder do admin: handPower) tiram HP; sem exigência de nível.
   *     Ferramenta de coleta NÃO abate: flash vermelho + "Utilize a sua arma
   *     principal!" (a durabilidade desce mesmo assim). Golpe não-letal assusta
   *     (vaca/ovelha fogem — o INÍCIO do golpe já assusta, via
   *     scareNearbyAnimals); HP ≤ 0 → abate: animação de morte, drops
   *     (carne/couro/lã/pena) e respawn imediato no spawn com janela de
   *     proteção (anti abate duplo).
   *  3. Item errado: flash VERMELHO e nada mais — sem dano, sem barrinha, sem
   *     som. Recurso de MÃO também aceita a ferramenta da família
   *     (toolAllowedFor): pedra de mão→picareta, galho→machado, arbusto→facão.
   *  4. Ferramenta certa com nível < mínimo: o HP desce normalmente mas TRAVA
   *     num piso (lockedHpFloorFor) — o nó nunca quebra; ao travar, aviso.
   *  5. Ferramenta certa com nível suficiente: fluxo normal (quebra em ≤ 0).
   */
  private applyHit(node: ResourceNode, hit: SwingHit): void {
    const spr = node.sprite;
    // Animal recém-renascido: intocável (nem durabilidade consome).
    if (node.kind === 'animal' && (node.protectedUntilMs ?? 0) > this.scene.time.now) return;
    // Durabilidade: todo golpe de FERRAMENTA que conecta gasta 1 — inclusive
    // no alvo errado ou com nível baixo (a batida aconteceu). Mão, flecha
    // (toolRef '') e arma da classe (gen:weapon/) não gastam. O servidor é
    // quem quebra a ferramenta; aqui só a barra desce na hora.
    if (hit.toolRef) queueToolWear(hit.toolRef);
    if (node.kind === 'animal') {
      const ag = this.animals.find((a) => a.sprite === node.sprite);
      if (!ag || ag.dead) return;
      // (2) Ferramenta de coleta não abate: aviso desde o 1º golpe (o bicho
      // ainda se assusta — apanhar de picareta também espanta).
      if (hit.toolKind !== null && hit.toolKind !== 'hand') {
        this.flashNode(spr, 0xff4444);
        this.showNodeMessage(node, 'Utilize a sua arma principal!');
        this.scareAnimal(ag);
        return;
      }
      this.flashNode(spr, 0xffffff);
      // HP do admin (resourceHp['animal:<id>']); a mão bate com handPower.
      if (node.hp < 0) node.hp = this.maxHpFor(node.key);
      const power = hit.toolKind === 'hand' ? this.handPower() : hit.power;
      node.hp -= Math.max(1, Math.round(power));
      if (node.hp <= 0) {
        this.killAnimal(node, ag);
        return;
      }
      this.showNodeHpBar(node);
      this.scareAnimal(ag); // golpe não-letal assusta: vaca/ovelha fogem
      return;
    }
    // (3) Item errado: só o flash vermelho — recurso intacto, sem som/barrinha.
    // (Recurso de MÃO aceita também a ferramenta da família — toolAllowedFor.)
    if (!this.toolAllowedFor(node, hit.toolKind)) {
      this.flashNode(spr, 0xff4444);
      return;
    }
    this.flashNode(spr, 0xffffff);
    // SFX do golpe — WebAudio cumulativo: cada hit dispara uma fonte nova na
    // hora, sem cortar o som do hit anterior (inclusive no golpe que quebra).
    if (node.kind === 'tree') gatherAudio.play('chopWood');
    else if (node.kind === 'mineral' || node.kind === 'hand_stone') gatherAudio.play('pickaxe');
    // HP: lazy-init na 1ª pancada (worldConfig já foi carregada em prepare()).
    if (node.hp < 0) node.hp = this.maxHpFor(node.key);
    // Mão: poder configurável no admin (handPower); ferramenta: poder do item.
    const damage = Math.max(1, Math.round(hit.toolKind === 'hand' ? this.handPower() : hit.power));
    if (hit.toolLevel < this.minLevelFor(node.key)) {
      // (4) Ferramenta fraca: trava no piso (nunca sobe HP se já estava abaixo).
      const floorHp = Math.min(lockedHpFloorFor(this.maxHpFor(node.key)), node.hp);
      node.hp = Math.max(floorHp, node.hp - damage);
      this.showNodeHpBar(node);
      this.scene.tweens.add({ targets: spr, x: spr.x + 2, duration: 45, yoyo: true, repeat: 1 });
      if (node.hp <= floorHp) this.showNodeMessage(node, 'Ferramenta muito fraca!');
      return;
    }
    // (5) Fluxo normal.
    node.hp -= damage;
    if (node.hp <= 0) {
      node.broken = true;
      this.hideNodeHpBar(node);
      this.breakNode(node);
    } else {
      this.showNodeHpBar(node);
      // Tremidinha de dano.
      this.scene.tweens.add({ targets: spr, x: spr.x + 2, duration: 45, yoyo: true, repeat: 1 });
    }
  }

  private breakNode(node: ResourceNode): void {
    const scene = this.scene;
    const spr = node.sprite;
    const dropX = spr.x;
    const dropY = spr.y;
    // Agenda o renascimento (cooldown do admin ou padrão).
    node.respawnAtMs = scene.time.now + this.respawnSecondsFor(node.key) * 1000;
    if (node.kind === 'mineral' && spr instanceof Phaser.GameObjects.Sprite && scene.anims.exists(mineralBreakAnimKey(node.id))) {
      spr.play(mineralBreakAnimKey(node.id));
      gatherAudio.play('rockBreaking'); // som junto com o início da animação de quebra
      spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.spawnDrops(node, dropX, dropY);
        spr.setVisible(false); // some até o respawn
      });
      return;
    }
    if (node.kind === 'tree' && spr instanceof Phaser.GameObjects.Sprite && scene.anims.exists(treeFallAnimKey(node.id as TreeType))) {
      spr.play(treeFallAnimKey(node.id as TreeType));
      spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        // Impacto no chão: som da queda quando a animação de cair finaliza.
        gatherAudio.play('treeFall');
        // Toco (último frame) permanece durante o cooldown; drops na base.
        this.spawnDrops(node, dropX, dropY);
      });
      return;
    }
    // Ervas, arbusto e pedra de mão: mini-versões da própria imagem pulam do nó.
    this.spawnDrops(node, dropX, dropY);
    scene.tweens.add({
      targets: spr,
      alpha: 0,
      scaleX: spr.scaleX * 0.6,
      scaleY: spr.scaleY * 0.6,
      duration: 280,
      ease: 'Quad.easeIn',
      onComplete: () => spr.setVisible(false), // alpha/escala voltam no respawn
    });
  }

  /**
   * Mini-itens pulam do nó quebrado em setores angulares iguais (+ leve ruído),
   * para nunca nascerem uns por cima dos outros; o imã do updateDrops() coleta.
   * O item creditado é o RENDIDO pelo nó (pedra de mão → Pedra comum), e o
   * visual do drop segue esse item — o jogador vê exatamente o que entra.
   * A quantidade continua configurada pelo nó (dropCounts[node.key]).
   */
  private spawnDrops(node: ResourceNode, x: number, y: number): void {
    if (node.kind === 'animal') return; // abate usa spawnAnimalDrops()
    const itemKey = yieldItemKeyFor(node.key);
    const visual = dropVisualForItem(itemKey);
    if (!visual) {
      console.warn(`[CraftingMap] item sem visual de drop: ${itemKey} (nó ${node.key})`);
      return;
    }
    this.spawnDropItems(itemKey, visual.textureKey, x, y, this.dropCountFor(node.key), visual.scale);
  }

  /** Loop comum dos drops: pop em leque + registro no imã do updateDrops(). */
  private spawnDropItems(
    itemKey: string,
    textureKey: string,
    x: number,
    y: number,
    count: number,
    scale: number,
  ): void {
    const scene = this.scene;
    if (!scene.textures.exists(textureKey)) {
      console.warn(`[CraftingMap] textura de drop ausente: ${textureKey}`);
      return;
    }
    if (count <= 0) return;
    const baseAng = Math.random() * Math.PI * 2;
    const sector = (Math.PI * 2) / count;
    // Mais itens → anel um pouco maior, para os setores não ficarem apertados.
    const baseRadius = RESOURCE_DROP.scatterRadius * Math.max(1, Math.sqrt(count / 3));
    for (let i = 0; i < count; i++) {
      const ang = baseAng + i * sector + (Math.random() - 0.5) * sector * 0.5;
      const rad = baseRadius * (0.8 + 0.2 * Math.random());
      const spr = scene.add.image(x, y - 8, textureKey);
      spr.setOrigin(0.5, 0.5);
      spr.setDepth(this.depthForY(y) + 1);
      spr.setScale(0);
      const item: DropItem = { sprite: spr, state: 'pop', itemKey };
      this.drops.push(item);
      scene.tweens.add({
        targets: spr,
        x: x + Math.cos(ang) * rad,
        y: y - 8 + Math.sin(ang) * rad * 0.6,
        scaleX: scale,
        scaleY: scale,
        duration: RESOURCE_DROP.popMs,
        ease: 'Back.easeOut',
        onComplete: () => {
          item.state = 'idle';
        },
      });
    }
  }

  /**
   * Abate: trava o bicho, toca a animação de morte na direção atual e, ao
   * terminar, solta os drops (vaca: carne+couro; ovelha: lã; galinha: pena)
   * no lugar da morte e renasce o animal NA HORA no ponto de spawn original.
   */
  private killAnimal(node: ResourceNode, ag: AnimalAgent): void {
    if (ag.dead) return; // já abatido — jamais duplicar a morte/drops
    node.broken = true; // sai da mira dos golpes; sem respawnAtMs (respawn imediato)
    ag.dead = true;
    ag.fleeUntilMs = undefined;
    this.hideNodeHpBar(node);
    const spr = ag.sprite;
    const dropX = spr.x;
    const dropY = spr.y;
    const finish = () => {
      if (!spr.active) return; // teardown no meio da animação
      this.spawnAnimalDrops(ag.def, dropX, dropY);
      this.respawnAnimal(node, ag);
    };
    const dieKey = animalAnimKey(ag.def.id, 'die', ag.dir);
    if (this.scene.anims.exists(dieKey)) {
      spr.play(dieKey);
      spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
    } else {
      finish(); // dying.png ausente — pula direto para drops + respawn
    }
  }

  /** Drops do abate no chão da morte (quantidade por item vem do admin; padrão 1). */
  private spawnAnimalDrops(def: AnimalDef, x: number, y: number): void {
    for (const itemKey of def.drops) {
      const item = ANIMAL_DROP_ITEMS.find((d) => d.key === itemKey);
      if (!item) continue;
      this.spawnDropItems(itemKey, animalDropTextureKey(item.key), x, y, this.dropCountFor(itemKey), 1);
    }
  }

  /** Renasce no ponto de spawn original (homeX/Y nunca mudam), cheio e comendo. */
  private respawnAnimal(node: ResourceNode, ag: AnimalAgent): void {
    const spr = ag.sprite;
    spr.setPosition(ag.homeX, ag.homeY);
    spr.setDepth(this.depthForY(ag.homeY));
    const dir = ANIMAL_DIRECTIONS[Math.floor(Math.random() * ANIMAL_DIRECTIONS.length)];
    ag.dead = false;
    ag.state = 'eat';
    ag.dir = dir;
    ag.timerMs = ANIMAL_WANDER.eatMinMs + Math.random() * (ANIMAL_WANDER.eatMaxMs - ANIMAL_WANDER.eatMinMs);
    ag.targetX = ag.homeX;
    ag.targetY = ag.homeY;
    ag.fleeUntilMs = undefined;
    ag.fleeAnchorX = undefined;
    ag.fleeAnchorY = undefined;
    ag.fleeTangentSign = undefined;
    ag.animLockUntilMs = 0;
    node.hp = -1; // relê o HP do admin no próximo golpe
    node.broken = false;
    node.respawnAtMs = undefined;
    // Janela intocável (anti abate duplo): o respawn é imediato e pertinho de
    // onde o bicho morreu — sem isso, uma arma forte re-abatia no embalo.
    node.protectedUntilMs = this.scene.time.now + ANIMAL_RESPAWN_PROTECT_MS;
    spr.play({ key: animalAnimKey(ag.def.id, 'eat', dir), startFrame: Math.floor(Math.random() * ANIMAL_SHEET.frames) });
    spr.setScale(0.7); // pop de nascimento, igual aos outros respawns
    spr.setAlpha(0.45); // meio transparente enquanto está protegido
    this.scene.tweens.add({ targets: spr, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: spr, alpha: 1, duration: ANIMAL_RESPAWN_PROTECT_MS, ease: 'Linear' });
  }

  private updateDrops(deltaMs: number, playerX?: number, playerY?: number): void {
    if (!this.drops.length || playerX === undefined || playerY === undefined) return;
    const py = playerY - 12; // alvo: canela do jogador, não o pé exato
    for (const d of this.drops) {
      if (d.state !== 'idle' || !d.sprite.active) continue;
      const dx = playerX - d.sprite.x;
      const dy = py - d.sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist > RESOURCE_DROP.magnetRadius) continue;
      if (dist <= RESOURCE_DROP.collectRadius) {
        d.state = 'pop'; // trava o imã enquanto some
        queueCollect(d.itemKey, 1); // inventário: otimista + lote pro servidor
        this.scene.tweens.add({
          targets: d.sprite,
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          duration: 110,
          onComplete: () => d.sprite.destroy(),
        });
        continue;
      }
      // Imã: acelera conforme chega mais perto.
      const speed = RESOURCE_DROP.magnetSpeed * (1.25 - Math.min(1, dist / RESOURCE_DROP.magnetRadius) * 0.5);
      const step = (speed * deltaMs) / 1000;
      d.sprite.setPosition(d.sprite.x + (dx / dist) * step, d.sprite.y + (dy / dist) * step);
    }
    // Poda ocasional dos destruídos (barata: só quando a lista cresce).
    if (this.drops.length > 32) this.drops = this.drops.filter((d) => d.sprite.active);
  }

  // ------------------------------------------------------------------
  // internos
  // ------------------------------------------------------------------

  private async runLoader(queue: () => void): Promise<void> {
    const scene = this.scene;
    queue();
    if (scene.load.list.size === 0 && scene.load.inflight.size === 0) return;
    await new Promise<void>((resolve) => {
      const onError = (file: Phaser.Loader.File) => {
        this.missing.push(file.src || file.key);
      };
      scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        resolve();
      });
      scene.load.start();
    });
  }

  /** Map<tiledName, Set<localTileId>> de tiles usados em camadas e objetos. */
  private collectUsedTileIds(tmj: any): Map<string, Set<number>> {
    const sets = ([...(tmj.tilesets || [])] as any[]).sort((a, b) => a.firstgid - b.firstgid);
    const owner = (gid: number) => {
      const g = gid & GID_FLAGS;
      let r: any = null;
      for (const s of sets) {
        if (g >= s.firstgid) r = s;
        else break;
      }
      return r;
    };
    const used = new Map<string, Set<number>>();
    const mark = (gid: number) => {
      if (!gid) return;
      const ts = owner(gid);
      if (!ts) return;
      let set = used.get(ts.name);
      if (!set) {
        set = new Set();
        used.set(ts.name, set);
      }
      set.add((gid & GID_FLAGS) - ts.firstgid);
    };
    const walk = (layers: any[]) => {
      for (const l of layers) {
        if (l.layers) walk(l.layers);
        if (l.type === 'tilelayer' && Array.isArray(l.data)) for (const gid of l.data) mark(gid);
        if (l.type === 'objectgroup') for (const o of l.objects || []) if (o.gid) mark(o.gid);
      }
    };
    walk(tmj.layers || []);
    return used;
  }

  /**
   * Desenha células de tile layers e objetos cujo tileset é image collection —
   * o pipeline padrão do Phaser/WorldScene pula esses casos.
   * Regra de profundidade: buckets do engine (0 chão / 200 acima do player);
   * camadas depois de um grupo "above player" de topo também vão para 200
   * (ex.: "Portal Top" — o jogador passa entre as duas metades do portal).
   */
  private placeCollectionContent(tmj: any) {
    const scene = this.scene;
    const sets = ([...(tmj.tilesets || [])] as any[]).sort((a, b) => a.firstgid - b.firstgid);
    const owner = (gid: number) => {
      const g = gid & GID_FLAGS;
      let r: any = null;
      for (const s of sets) {
        if (g >= s.firstgid) r = s;
        else break;
      }
      return r;
    };
    const tileW = tmj.tilewidth || 32;
    const tileH = tmj.tileheight || 32;
    const isAboveGroupName = (n: string) => {
      const ln = (n || '').toLowerCase();
      return ln === 'visual_above' || ln === 'above player';
    };

    let seenTopLevelAboveGroup = false;
    const walk = (layers: any[], parentAbove: boolean, topLevel: boolean) => {
      for (const l of layers) {
        const cls = (l.class || '').toLowerCase();
        const selfAbove =
          parentAbove || cls === 'above_player' || (l.name || '').toLowerCase().includes('(above)') ||
          (topLevel && seenTopLevelAboveGroup);

        if (l.type === 'group') {
          const groupAbove = selfAbove || isAboveGroupName(l.name);
          if (topLevel && isAboveGroupName(l.name)) seenTopLevelAboveGroup = true;
          walk(l.layers || [], groupAbove, false);
          continue;
        }

        if (l.type === 'tilelayer' && Array.isArray(l.data) && l.width) {
          for (let i = 0; i < l.data.length; i++) {
            const rawGid = l.data[i];
            if (!rawGid) continue;
            const ts = owner(rawGid);
            if (!ts || ts.image || !Array.isArray(ts.tiles)) continue; // só collections
            const localId = (rawGid & GID_FLAGS) - ts.firstgid;
            const entry = this.collectionTextures.get(`${ts.name}:${localId}`);
            if (!entry || !scene.textures.exists(entry.key)) continue;
            const cx = i % l.width;
            const cy = Math.floor(i / l.width);
            // Tiled ancora tiles de collection no canto inferior-esquerdo da célula.
            const img = scene.add.image(cx * tileW, (cy + 1) * tileH, entry.key).setOrigin(0, 1);
            if (rawGid & FLIPPED_H) img.setFlipX(true);
            if (rawGid & FLIPPED_V) img.setFlipY(true);
            img.setDepth(selfAbove ? 200 : 0);
            this.sprites.push(img);
          }
        }

        if (l.type === 'objectgroup') {
          for (const obj of l.objects || []) {
            if (!obj.gid || obj.visible === false) continue;
            const ts = owner(obj.gid);
            if (!ts || ts.image || !Array.isArray(ts.tiles)) continue;
            const localId = (obj.gid & GID_FLAGS) - ts.firstgid;
            const entry = this.collectionTextures.get(`${ts.name}:${localId}`);
            if (!entry || !scene.textures.exists(entry.key)) continue;
            const img = scene.add.image(obj.x, obj.y, entry.key).setOrigin(0, 1);
            img.setDisplaySize(obj.width || entry.width, obj.height || entry.height);
            if (obj.gid & FLIPPED_H) img.setFlipX(true);
            if (obj.gid & FLIPPED_V) img.setFlipY(true);
            img.setDepth(selfAbove ? 200 : 0);
            this.sprites.push(img);
          }
        }
      }
    };
    walk(tmj.layers || [], false, true);
  }

  /** Animações de tile do Tiled (água do lago): troca de index por timer. */
  private startTileAnimations(map: Phaser.Tilemaps.Tilemap) {
    const animByGid = new Map<number, number[]>();
    let frameMs = 100;
    for (const ts of map.tilesets) {
      const td: any = ts.tileData;
      if (!td) continue;
      for (const idStr of Object.keys(td)) {
        const anim = td[idStr]?.animation;
        if (!Array.isArray(anim) || !anim.length) continue;
        animByGid.set(ts.firstgid + Number(idStr), anim.map((f: any) => ts.firstgid + f.tileid));
        frameMs = anim[0].duration || 100;
      }
    }
    if (!animByGid.size) return;

    const cells: AnimCell[] = [];
    for (const layerData of map.layers) {
      const tl = layerData.tilemapLayer;
      if (!tl) continue;
      for (let y = 0; y < layerData.height; y++) {
        for (let x = 0; x < layerData.width; x++) {
          const tile = layerData.data[y]?.[x];
          if (!tile || tile.index < 0) continue;
          const frames = animByGid.get(tile.index);
          if (frames) cells.push({ layer: tl, x, y, frames });
        }
      }
    }
    if (!cells.length) return;

    this.animEvent = this.scene.time.addEvent({
      delay: frameMs,
      loop: true,
      callback: () => {
        this.animTick++;
        for (const c of cells) {
          c.layer.putTileAt(c.frames[this.animTick % c.frames.length], c.x, c.y, false);
        }
      },
    });
  }

  // ------------------------------------------------------------------
  // recursos: árvores, minérios, pedras de mão, arbustos
  // ------------------------------------------------------------------

  private findObjects(tmj: any, layerName: string): any[] {
    const walk = (layers: any[]): any[] | null => {
      for (const l of layers) {
        if (l.type === 'group') {
          const r = walk(l.layers || []);
          if (r) return r;
        } else if (l.type === 'objectgroup' && l.name === layerName) {
          return l.objects || [];
        }
      }
      return null;
    };
    return walk(tmj.layers || []) ?? [];
  }

  private prop(obj: any, name: string): any {
    return (obj.properties || []).find((p: any) => p.name === name)?.value;
  }

  private placeResources(tmj: any) {
    const scene = this.scene;
    // Sprites (não Images) para todos: permite animação de quebra/queda no corte.
    const place = (x: number, y: number, texture: string, frame?: number): Phaser.GameObjects.Sprite | null => {
      if (!scene.textures.exists(texture)) return null;
      const spr = frame !== undefined
        ? scene.add.sprite(x, y, texture, frame)
        : scene.add.sprite(x, y, texture);
      spr.setOrigin(0.5, 1);
      spr.setDepth(this.depthForY(y));
      this.sprites.push(spr);
      return spr;
    };

    // Árvores: frame 0 = em pé; a animação de queda já fica registrada p/ o corte.
    let unknownTreeTypes = 0;
    for (const obj of this.findObjects(tmj, 'trees_spawns')) {
      const type = String(this.prop(obj, 'treeType') || '');
      if (!(TREE_TYPES as readonly string[]).includes(type)) {
        unknownTreeTypes++;
        continue;
      }
      const img = place(obj.x, obj.y, treeTextureKey(type as TreeType), 0);
      if (img) {
        img.setData('treeType', type);
        this.nodes.push({ sprite: img, key: `tree:${type}`, kind: 'tree', id: type, hp: -1, broken: false });
      }
    }
    if (unknownTreeTypes) console.warn(`[CraftingMap] ${unknownTreeTypes} pontos de árvore com treeType desconhecido`);

    // Minérios: sorteio com semente diária — todos os jogadores veem o mesmo
    // layout no mesmo dia (placement autoritativo no servidor vem junto com a coleta).
    const mineralPoints = this.findObjects(tmj, 'minerals_spawns').slice();
    const daySeed = Math.floor(Date.now() / 86400000);
    const rng = mulberry32(daySeed);
    for (let i = mineralPoints.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [mineralPoints[i], mineralPoints[j]] = [mineralPoints[j], mineralPoints[i]];
    }
    const counts = this.worldConfig?.mineralCounts;
    let cursor = 0;
    for (const m of MINERALS) {
      const want = counts?.[m.id] ?? m.defaultCount;
      for (let n = 0; n < want && cursor < mineralPoints.length; n++, cursor++) {
        const p = mineralPoints[cursor];
        const img = place(p.x, p.y, mineralTextureKey(m.id), 0);
        if (img) {
          img.setData('mineralId', m.id);
          this.nodes.push({ sprite: img, key: `mineral:${m.id}`, kind: 'mineral', id: m.id, hp: -1, broken: false });
        }
      }
    }

    // Pedras coletáveis com a mão (posições fixas do mapa).
    for (const obj of this.findObjects(tmj, 'fallen_simple_stones')) {
      const img = place(obj.x, obj.y, HAND_STONE.textureKey, 0);
      if (img) this.nodes.push({ sprite: img, key: 'hand_stone', kind: 'hand_stone', id: 'hand_stone', hp: -1, broken: false });
    }

    // Arbustos simples.
    for (const obj of this.findObjects(tmj, 'simple_bush')) {
      const img = place(obj.x, obj.y, BUSH.textureKey);
      if (img) this.nodes.push({ sprite: img, key: 'bush', kind: 'bush', id: 'bush', hp: -1, broken: false });
    }

    // Galhos caídos (branches_spawns). Enquanto branch.png não existir no
    // projeto, place() devolve null e os pontos ficam vazios (aviso no console).
    for (const obj of this.findObjects(tmj, BRANCH.layer)) {
      const img = place(obj.x, obj.y, BRANCH.textureKey);
      if (img) this.nodes.push({ sprite: img, key: 'branch', kind: 'branch', id: 'branch', hp: -1, broken: false });
    }

    // Ervas e plantas (erva-da-cura, erva vermelha, erva azul, espinho da dama, raiz do cavalo).
    for (const h of HERBS) {
      for (const obj of this.findObjects(tmj, h.layer)) {
        const img = place(obj.x, obj.y, herbTextureKey(h.id));
        if (img) this.nodes.push({ sprite: img, key: `herb:${h.id}`, kind: 'herb', id: h.id, hp: -1, broken: false });
      }
    }

    // Animais: começam comendo numa direção aleatória; o passeio roda no update().
    // startFrame aleatório dessincroniza os bichos.
    for (const a of ANIMALS) {
      const key = animalTextureKey(a.id);
      if (!scene.textures.exists(key)) continue;
      for (const obj of this.findObjects(tmj, a.layer)) {
        const spr = scene.add.sprite(obj.x, obj.y, key, 0);
        spr.setOrigin(0.5, 1);
        spr.setDepth(this.depthForY(obj.y));
        const dir = ANIMAL_DIRECTIONS[Math.floor(Math.random() * ANIMAL_DIRECTIONS.length)];
        spr.play({ key: animalAnimKey(a.id, 'eat', dir), startFrame: Math.floor(Math.random() * ANIMAL_SHEET.frames) });
        this.sprites.push(spr);
        this.animals.push({
          sprite: spr,
          def: a,
          homeX: obj.x,
          homeY: obj.y,
          state: 'eat',
          dir,
          timerMs: ANIMAL_WANDER.eatMinMs + Math.random() * (ANIMAL_WANDER.eatMaxMs - ANIMAL_WANDER.eatMinMs),
          targetX: obj.x,
          targetY: obj.y,
        });
        // Animais também são nós: golpes tiram HP (admin) e o abate dropa itens.
        this.nodes.push({ sprite: spr, key: `animal:${a.id}`, kind: 'animal', id: a.id, hp: -1, broken: false });
      }
    }
  }
}

/** PRNG determinístico pequeno (semente diária dos minérios). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
