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
  craftDepthForY,
  ANIMALS,
  ANIMAL_SHEET,
  ANIMAL_DIRECTIONS,
  ANIMAL_WANDER,
  animalTextureKey,
  animalWalkTextureKey,
  animalAnimKey,
  HERBS,
  herbTextureKey,
  herbUrl,
  RESOURCE_HITS_TO_BREAK,
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
  DEFAULT_DROP_COUNT,
  DEFAULT_RESPAWN_SECONDS,
  type CollectionWorldConfig,
  type ResourceHurtbox,
} from '../../shared/collection/CollectionShapes';
import { queueCollect } from '../../stores/collectionInventoryStore';

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
}

/** Nó de recurso golpeável (fase de teste: N golpes → quebra/coleta). */
interface ResourceNode {
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  /** Chave de hurtbox do admin: mineral:<id> | tree:<tipo> | herb:<id> | bush | hand_stone | animal:<id>. */
  key: string;
  kind: 'mineral' | 'tree' | 'herb' | 'bush' | 'hand_stone' | 'animal';
  id: string;
  hits: number;
  broken: boolean;
  /** Quando renasce (scene.time.now em ms); definido ao quebrar. */
  respawnAtMs?: number;
}

/** Mini-item dropado por um nó quebrado (pulo → imã → coleta). */
interface DropItem {
  sprite: Phaser.GameObjects.Image;
  /** 'pop' durante o tween inicial/sumiço; 'idle' esperando o imã. */
  state: 'pop' | 'idle';
  /** Chave do item para o inventário (igual à chave do nó). */
  itemKey: string;
}

const GID_FLAGS = 0x0fffffff;
const FLIPPED_H = 0x80000000;
const FLIPPED_V = 0x40000000;

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

  /** Garante TMJ no cache + todas as texturas necessárias carregadas. */
  async prepare(): Promise<void> {
    const scene = this.scene;

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
    for (const h of HERBS) {
      if (scene.textures.exists(herbTextureKey(h.id))) {
        scene.textures.get(herbTextureKey(h.id)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    // Animais: cada sheet tem 4 linhas de 7 frames — uma animação por direção.
    for (const a of ANIMALS) {
      const sheets: Array<['eat' | 'walk', string, number]> = [
        ['eat', animalTextureKey(a.id), ANIMAL_SHEET.eatFrameRate],
        ['walk', animalWalkTextureKey(a.id), ANIMAL_SHEET.walkFrameRate],
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
              repeat: -1,
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
    this.active = true;
    this.placeCollectionContent(tmjData);
    this.startTileAnimations(map);
    this.placeResources(tmjData);
  }

  teardown() {
    this.mapGeneration++;
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    this.animals = [];
    this.nodes = [];
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

  /** Muda a cada saída do mapa — invalida callbacks atrasados de sessões antigas. */
  private mapGeneration = 0;

  /** Geração atual (capturada por callbacks atrasados do WorldScene). */
  get generation(): number {
    return this.mapGeneration;
  }

  /** Passeio/fuga dos animais + drops + respawns — chamado pelo WorldScene.update(). */
  update(deltaMs: number, playerX?: number, playerY?: number) {
    if (!this.active) return;
    this.updateDrops(deltaMs, playerX, playerY);
    this.updateRespawns();
    const now = this.scene.time.now;
    for (const ag of this.animals) {
      if (!ag.sprite.active) continue;
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
        ag.timerMs -= deltaMs;
        if (ag.timerMs > 0) continue;
        // Escolhe um destino perto de "casa" (evita o bicho migrar pelo mapa).
        const ang = Math.random() * Math.PI * 2;
        const rad = ANIMAL_WANDER.radius * (0.35 + 0.65 * Math.random());
        ag.targetX = ag.homeX + Math.cos(ang) * rad;
        ag.targetY = ag.homeY + Math.sin(ang) * rad;
        const dx = ag.targetX - ag.sprite.x;
        const dy = ag.targetY - ag.sprite.y;
        ag.dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north');
        ag.state = 'walk';
        ag.sprite.play(animalAnimKey(ag.def.id, 'walk', ag.dir));
      } else {
        const dx = ag.targetX - ag.sprite.x;
        const dy = ag.targetY - ag.sprite.y;
        const dist = Math.hypot(dx, dy);
        const step = (ag.def.speed * deltaMs) / 1000;
        if (dist <= step || dist === 0) {
          ag.sprite.setPosition(ag.targetX, ag.targetY);
          ag.state = 'eat';
          ag.timerMs = ANIMAL_WANDER.eatMinMs + Math.random() * (ANIMAL_WANDER.eatMaxMs - ANIMAL_WANDER.eatMinMs);
          ag.sprite.play({
            key: animalAnimKey(ag.def.id, 'eat', ag.dir),
            startFrame: Math.floor(Math.random() * ANIMAL_SHEET.frames),
          });
        } else {
          ag.sprite.setPosition(ag.sprite.x + (dx / dist) * step, ag.sprite.y + (dy / dist) * step);
        }
        ag.sprite.setDepth(this.depthForY(ag.sprite.y));
      }
    }
  }

  /** Fuga: afasta do jogador em velocidade moderada, presa ao raio da âncora. */
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
    const step = (ag.def.speed * ANIMAL_FLEE.speedMultiplier * deltaMs) / 1000;
    let nx = spr.x + vx * step;
    let ny = spr.y + vy * step;
    if (Math.hypot(nx - ax, ny - ay) > ANIMAL_FLEE.radius) {
      // Borda do raio: desliza pela tangente que mais se afasta do jogador,
      // com leve puxão para dentro (não fica raspando na borda).
      const rx = spr.x - ax;
      const ry = spr.y - ay;
      const rlen = Math.hypot(rx, ry) || 1;
      const t1x = -ry / rlen;
      const t1y = rx / rlen;
      const useT1 = t1x * vx + t1y * vy >= 0;
      const dx = (useT1 ? t1x : -t1x) - (rx / rlen) * 0.35;
      const dy = (useT1 ? t1y : -t1y) - (ry / rlen) * 0.35;
      const dlen = Math.hypot(dx, dy) || 1;
      vx = dx / dlen;
      vy = dy / dlen;
      nx = spr.x + vx * step;
      ny = spr.y + vy * step;
    }
    spr.setPosition(nx, ny);
    spr.setDepth(this.depthForY(ny));
    const dir: AnimalDirection =
      Math.abs(vx) >= Math.abs(vy) ? (vx >= 0 ? 'east' : 'west') : (vy >= 0 ? 'south' : 'north');
    const animKey = animalAnimKey(ag.def.id, 'walk', dir);
    if (ag.state !== 'walk' || ag.dir !== dir || spr.anims.currentAnim?.key !== animKey) {
      ag.state = 'walk';
      ag.dir = dir;
      spr.play(animKey);
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
    node.hits = 0;
    node.broken = false;
    node.respawnAtMs = undefined;
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
  // golpes em recursos (fase de teste: 3 golpes → quebra + drops)
  // ------------------------------------------------------------------

  /** Hurtbox do admin (px do frame fonte, ancorada no pé do sprite) → retângulo no mundo. */
  private nodeHurtboxRect(node: ResourceNode): Phaser.Geom.Rectangle {
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
    return new Phaser.Geom.Rectangle(cx - w / 2, bottom - h, w, h);
  }

  /**
   * Um golpe do jogador no mundo de coleta: caixa na frente do jogador na
   * direção olhada; acerta só o nó mais próximo. Retorna true se acertou algo.
   */
  tryHitResource(playerX: number, playerY: number, direction: string): boolean {
    if (!this.active || !this.nodes.length) return false;
    const reach = 46;
    const dir = String(direction || 'down').toLowerCase();
    let dx = 0;
    let dy = 0;
    if (dir.includes('left')) dx -= 1;
    if (dir.includes('right')) dx += 1;
    if (dir.includes('up')) dy -= 1;
    if (dir.includes('down')) dy += 1;
    if (!dx && !dy) dy = 1;
    const norm = Math.hypot(dx, dy);
    const cx = playerX + (dx / norm) * reach;
    const cy = playerY - 20 + (dy / norm) * reach; // -20: altura do corpo, não o pé
    const swing = new Phaser.Geom.Rectangle(cx - 30, cy - 26, 60, 52);

    let best: ResourceNode | null = null;
    let bestDist = Infinity;
    for (const node of this.nodes) {
      if (node.broken || !node.sprite.active) continue;
      if (!Phaser.Geom.Rectangle.Overlaps(swing, this.nodeHurtboxRect(node))) continue;
      const d = Phaser.Math.Distance.Between(playerX, playerY, node.sprite.x, node.sprite.y);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    if (!best) return false;
    this.applyHit(best);
    return true;
  }

  /** Itens por quebra (config do admin ou padrão 3). */
  private dropCountFor(key: string): number {
    return this.worldConfig?.dropCounts?.[key] ?? DEFAULT_DROP_COUNT;
  }

  /** Segundos até renascer (config do admin ou padrão 60). */
  private respawnSecondsFor(key: string): number {
    return this.worldConfig?.respawnSeconds?.[key] ?? DEFAULT_RESPAWN_SECONDS;
  }

  private applyHit(node: ResourceNode): void {
    const spr = node.sprite;
    // Flash branco curto — feedback visual do golpe.
    // Phaser 4: fill-tint é setTint + setTintMode (setTintFill não recebe cor).
    spr.setTint(0xffffff);
    spr.setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(90, () => {
      if (spr.active) {
        spr.clearTint();
        spr.setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
    if (node.kind === 'animal') {
      // Animais ainda não morrem (a morte será especificada depois).
      // Vaca/ovelha fogem em raio limitado; galinha só toma o flash.
      const ag = this.animals.find((a) => a.sprite === node.sprite);
      if (ag && ag.def.id !== 'chicken') {
        const now = this.scene.time.now;
        if ((ag.fleeUntilMs ?? 0) <= now) {
          // 1º golpe desta fuga: âncora do raio = onde o animal estava.
          ag.fleeAnchorX = ag.sprite.x;
          ag.fleeAnchorY = ag.sprite.y;
        }
        ag.fleeUntilMs = now + ANIMAL_FLEE.durationMs; // cada golpe renova a fuga
      }
      return;
    }
    node.hits++;
    if (node.hits >= RESOURCE_HITS_TO_BREAK) {
      node.broken = true;
      this.breakNode(node);
    } else {
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
      spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.spawnDrops(node, dropX, dropY);
        spr.setVisible(false); // some até o respawn
      });
      return;
    }
    if (node.kind === 'tree' && spr instanceof Phaser.GameObjects.Sprite && scene.anims.exists(treeFallAnimKey(node.id as TreeType))) {
      spr.play(treeFallAnimKey(node.id as TreeType));
      spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
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
   */
  private spawnDrops(node: ResourceNode, x: number, y: number): void {
    const scene = this.scene;
    let textureKey: string;
    let frame: number | undefined;
    let scale = 1;
    switch (node.kind) {
      case 'mineral':
        textureKey = mineralDropTextureKey(node.id);
        break;
      case 'tree':
        textureKey = treeDropTextureKey(node.id as TreeType);
        break;
      case 'herb':
        textureKey = herbTextureKey(node.id);
        scale = SELF_DROP_SCALE.herb;
        break;
      case 'bush':
        textureKey = BUSH.textureKey;
        scale = SELF_DROP_SCALE.bush;
        break;
      case 'hand_stone':
        textureKey = HAND_STONE.textureKey;
        frame = 0; // sheet de 10 frames — o drop usa só o primeiro
        scale = SELF_DROP_SCALE.hand_stone;
        break;
      default:
        return; // animais não dropam (ainda)
    }
    if (!scene.textures.exists(textureKey)) {
      console.warn(`[CraftingMap] textura de drop ausente: ${textureKey}`);
      return;
    }
    const count = this.dropCountFor(node.key);
    if (count <= 0) return;
    const baseAng = Math.random() * Math.PI * 2;
    const sector = (Math.PI * 2) / count;
    // Mais itens → anel um pouco maior, para os setores não ficarem apertados.
    const baseRadius = RESOURCE_DROP.scatterRadius * Math.max(1, Math.sqrt(count / 3));
    for (let i = 0; i < count; i++) {
      const ang = baseAng + i * sector + (Math.random() - 0.5) * sector * 0.5;
      const rad = baseRadius * (0.8 + 0.2 * Math.random());
      const spr =
        frame !== undefined ? scene.add.image(x, y - 8, textureKey, frame) : scene.add.image(x, y - 8, textureKey);
      spr.setOrigin(0.5, 0.5);
      spr.setDepth(this.depthForY(y) + 1);
      spr.setScale(0);
      const item: DropItem = { sprite: spr, state: 'pop', itemKey: node.key };
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
        this.nodes.push({ sprite: img, key: `tree:${type}`, kind: 'tree', id: type, hits: 0, broken: false });
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
          this.nodes.push({ sprite: img, key: `mineral:${m.id}`, kind: 'mineral', id: m.id, hits: 0, broken: false });
        }
      }
    }

    // Pedras coletáveis com a mão (posições fixas do mapa).
    for (const obj of this.findObjects(tmj, 'fallen_simple_stones')) {
      const img = place(obj.x, obj.y, HAND_STONE.textureKey, 0);
      if (img) this.nodes.push({ sprite: img, key: 'hand_stone', kind: 'hand_stone', id: 'hand_stone', hits: 0, broken: false });
    }

    // Arbustos simples.
    for (const obj of this.findObjects(tmj, 'simple_bush')) {
      const img = place(obj.x, obj.y, BUSH.textureKey);
      if (img) this.nodes.push({ sprite: img, key: 'bush', kind: 'bush', id: 'bush', hits: 0, broken: false });
    }

    // Ervas e plantas (erva-da-cura, erva vermelha, erva azul, espinho da dama, raiz do cavalo).
    for (const h of HERBS) {
      for (const obj of this.findObjects(tmj, h.layer)) {
        const img = place(obj.x, obj.y, herbTextureKey(h.id));
        if (img) this.nodes.push({ sprite: img, key: `herb:${h.id}`, kind: 'herb', id: h.id, hits: 0, broken: false });
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
        // Animais também recebem golpes (só reagem — morte será especificada depois).
        this.nodes.push({ sprite: spr, key: `animal:${a.id}`, kind: 'animal', id: a.id, hits: 0, broken: false });
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
