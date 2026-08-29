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
  type TreeType,
} from '../config/craftingMapConfig';
import { getTextureKeyForTileset } from '../config/worldAssets';

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

const GID_FLAGS = 0x0fffffff;
const FLIPPED_H = 0x80000000;
const FLIPPED_V = 0x40000000;

export class CraftingMapRuntime {
  private scene: Phaser.Scene;
  /** tiledName → textureKey (tilesets-spritesheet; nomes duplicados compartilham textura via URL). */
  private sheetTextureByName = new Map<string, string>();
  /** `${tiledName}:${localId}` → textura de tile de collection usado no mapa. */
  private collectionTextures = new Map<string, CollectionTexEntry>();
  private sprites: Phaser.GameObjects.Image[] = [];
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
      }
    }
    if (scene.textures.exists(HAND_STONE.textureKey)) {
      scene.textures.get(HAND_STONE.textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    if (scene.textures.exists(BUSH.textureKey)) {
      scene.textures.get(BUSH.textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
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
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
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
    const place = (x: number, y: number, texture: string, frame?: number): Phaser.GameObjects.Image | null => {
      if (!scene.textures.exists(texture)) return null;
      const img = frame !== undefined
        ? scene.add.image(x, y, texture, frame)
        : scene.add.image(x, y, texture);
      img.setOrigin(0.5, 1);
      img.setDepth(this.depthForY(y));
      this.sprites.push(img);
      return img;
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
      if (img) img.setData('treeType', type);
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
    let cursor = 0;
    for (const m of MINERALS) {
      for (let n = 0; n < m.defaultCount && cursor < mineralPoints.length; n++, cursor++) {
        const p = mineralPoints[cursor];
        const img = place(p.x, p.y, mineralTextureKey(m.id), 0);
        if (img) img.setData('mineralId', m.id);
      }
    }

    // Pedras coletáveis com a mão (posições fixas do mapa).
    for (const obj of this.findObjects(tmj, 'fallen_simple_stones')) {
      place(obj.x, obj.y, HAND_STONE.textureKey, 0);
    }

    // Arbustos simples.
    for (const obj of this.findObjects(tmj, 'simple_bush')) {
      place(obj.x, obj.y, BUSH.textureKey);
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
