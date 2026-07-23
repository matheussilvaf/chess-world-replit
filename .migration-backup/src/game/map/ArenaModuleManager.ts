import Phaser from 'phaser';
import { ALL_TILESETS, findTilesetForGidInMap, getTextureKeyForTileset } from '../config/worldAssets';

export interface ModuleConfig {
  instanceId: string;
  moduleType: string;
  order: number;
}

export interface TableMapping {
  runtimeTableId: string;
  tableNumber: number;
  moduleInstanceId: string;
  localSlotId: string;
}

interface ModuleInstance {
  instanceId: string;
  offsetX: number;
  offsetY: number;
  tilemap: Phaser.Tilemaps.Tilemap | null;
  layers: Phaser.Tilemaps.TilemapLayer[];
  sprites: Phaser.GameObjects.Sprite[];
  bodies: MatterJS.BodyType[];
  tableAnchors: Map<string, TableAnchorSet>;
  collisionRects: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface TableAnchorSet {
  tableId: string;
  playerTop: { x: number; y: number; direction: string };
  playerBottom: { x: number; y: number; direction: string };
  spectatorLeft01: { x: number; y: number; direction: string };
  spectatorLeft02: { x: number; y: number; direction: string };
  spectatorRight01: { x: number; y: number; direction: string };
  spectatorRight02: { x: number; y: number; direction: string };
  exitTop: { x: number; y: number; direction: string };
  exitBottom: { x: number; y: number; direction: string };
  exitLeft: { x: number; y: number; direction: string };
  exitRight: { x: number; y: number; direction: string };
  overlayArea: { x: number; y: number; width: number; height: number; boardFiles: number; boardRanks: number } | null;
  cameraFocus: { x: number; y: number; width: number; height: number; padding: number } | null;
}

const MODULE_PATHS: Record<string, string> = {
  double: 'tournament_table_module_double',
  single: 'tournament_table_module_single',
  end: 'tournament_table_module_end',
};

const MODULE_CONNECTORS: Record<string, { south: string; north?: string }> = {
  double: { south: 'double_module_south_connector', north: 'double_module_north_connector' },
  single: { south: 'single_module_south_connector', north: 'single_module_north_connector' },
  end: { south: 'end_module_south_connector' },
};

export class ArenaModuleManager {
  private scene: Phaser.Scene;
  private modules: ModuleInstance[] = [];
  private loaded = false;
  private doorBlockerBody: MatterJS.BodyType | null = null;
  private doorBlockerRect: { x: number; y: number; w: number; h: number } | null = null;
  private doorClosedSprite: Phaser.GameObjects.Sprite | null = null;
  private doorOpenSprite: Phaser.GameObjects.Sprite | null = null;
  private totalBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  public initDoorBlocker(tmjData: any) {
    const dynamicCollisions = this.findObjectLayer(tmjData.layers, 'dynamic_collisions');
    if (!dynamicCollisions) return;

    for (const obj of dynamicCollisions) {
      if (obj.name === 'north_extension_door_blocker') {
        const cx = obj.x + obj.width / 2;
        const cy = obj.y + obj.height / 2;
        this.doorBlockerRect = { x: cx, y: cy, w: obj.width, h: obj.height };
        this.doorBlockerBody = this.scene.matter.add.rectangle(cx, cy, obj.width, obj.height, {
          isStatic: true,
          label: 'north_extension_door_blocker',
        });
        break;
      }
    }

    const dynamicVisuals = this.findObjectLayer(tmjData.layers, 'dynamic_visuals');
    if (!dynamicVisuals) return;

    const tmjTilesets = this.normalizeTilesets(tmjData.tilesets || []);
    for (const obj of dynamicVisuals) {
      if (!obj.gid) continue;
      const props = this.getObjProps(obj);
      const tsDef = findTilesetForGidInMap(obj.gid & 0x0FFFFFFF, tmjTilesets);
      if (!tsDef || !tsDef.isSingleImage) continue;

      const sprite = this.scene.add.sprite(obj.x, obj.y, tsDef.textureKey);
      sprite.setOrigin(0, 1);
      sprite.setDisplaySize(obj.width || 32, obj.height || 32);

      if (props.visualState === 'closed') {
        this.doorClosedSprite = sprite;
        sprite.setDepth(3);
        sprite.setVisible(true);
      } else if (props.visualState === 'open') {
        this.doorOpenSprite = sprite;
        sprite.setDepth(3);
        sprite.setVisible(false);
      }
    }
  }

  public setDoorOpen(open: boolean) {
    if (this.doorClosedSprite) this.doorClosedSprite.setVisible(!open);
    if (this.doorOpenSprite) this.doorOpenSprite.setVisible(open);

    if (open && this.doorBlockerBody) {
      this.scene.matter.world.remove(this.doorBlockerBody);
      this.doorBlockerBody = null;
    } else if (!open && !this.doorBlockerBody && this.doorBlockerRect) {
      const { x, y, w, h } = this.doorBlockerRect;
      this.doorBlockerBody = this.scene.matter.add.rectangle(x, y, w, h, {
        isStatic: true,
        label: 'north_extension_door_blocker',
      });
    }
  }

  public loadModules(
    modules: ModuleConfig[],
    tables: TableMapping[],
    receptionTmjKey: string,
  ): { minY: number; maxY: number; width: number } {
    if (this.loaded) return this.getBounds();
    if (modules.length === 0) return { minY: 0, maxY: 0, width: 0 };

    const receptionTmj = this.scene.cache.tilemap.get(receptionTmjKey)?.data;
    if (!receptionTmj) return { minY: 0, maxY: 0, width: 0 };

    const receptionConnector = this.findConnector(receptionTmj.layers, 'reception_north_connector');
    if (!receptionConnector) {
      console.warn('[ArenaModuleManager] reception_north_connector not found');
      return { minY: 0, maxY: 0, width: 0 };
    }

    const recWidth = receptionTmj.width * (receptionTmj.tilewidth || 32);
    const recHeight = receptionTmj.height * (receptionTmj.tileheight || 32);
    this.totalBounds = { minX: 0, minY: 0, maxX: recWidth, maxY: recHeight };

    const sorted = [...modules].sort((a, b) => a.order - b.order);
    let previousNorth = { x: receptionConnector.x, y: receptionConnector.y };

    for (const mod of sorted) {
      const mapKey = MODULE_PATHS[mod.moduleType] || mod.moduleType;
      const tmjEntry = this.scene.cache.tilemap.get(mapKey);
      if (!tmjEntry?.data) {
        console.warn(`[ArenaModuleManager] No TMJ data for ${mapKey}`);
        continue;
      }
      const tmjData = tmjEntry.data;

      const connectors = MODULE_CONNECTORS[mod.moduleType];
      if (!connectors) continue;

      const southConn = this.findConnector(tmjData.layers, connectors.south);
      if (!southConn) {
        console.warn(`[ArenaModuleManager] ${connectors.south} not found`);
        continue;
      }

      const offsetX = previousNorth.x - southConn.x;
      const offsetY = previousNorth.y - southConn.y;

      const modInstance = this.renderModule(mod.instanceId, mapKey, tmjData, offsetX, offsetY);

      const moduleTables = tables.filter(t => t.moduleInstanceId === mod.instanceId);
      this.extractTableAnchors(tmjData, offsetX, offsetY, mod.instanceId, moduleTables, modInstance);

      this.modules.push(modInstance);

      const modWidth = tmjData.width * (tmjData.tilewidth || 32);
      this.totalBounds.minY = Math.min(this.totalBounds.minY, offsetY);
      this.totalBounds.maxX = Math.max(this.totalBounds.maxX, offsetX + modWidth);

      if (connectors.north) {
        const northConn = this.findConnector(tmjData.layers, connectors.north);
        if (northConn) {
          previousNorth = { x: northConn.x + offsetX, y: northConn.y + offsetY };
        }
      }
    }

    this.loaded = true;
    console.log(`[ArenaModuleManager] Loaded ${this.modules.length} modules, bounds: minY=${this.totalBounds.minY}`);
    return this.getBounds();
  }

  private renderModule(instanceId: string, mapKey: string, tmjData: any, offsetX: number, offsetY: number): ModuleInstance {
    const modInstance: ModuleInstance = {
      instanceId,
      offsetX,
      offsetY,
      tilemap: null,
      layers: [],
      sprites: [],
      bodies: [],
      tableAnchors: new Map(),
      collisionRects: [],
    };

    // Create a Phaser tilemap from the cached TMJ data
    // First, we need to patch the tilesets to have inline names (Phaser doesn't support external .tsx)
    this.patchTmjTilesets(tmjData);

    const tilemap = this.scene.make.tilemap({ key: mapKey });
    modInstance.tilemap = tilemap;

    // Add tilesets to the tilemap
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    const normalizedTs = this.normalizeTilesets(tmjData.tilesets || []);
    for (const ts of tmjData.tilesets || []) {
      const name = ts.name || (ts.source ? ts.source.replace(/\.(tsx|tsj|json)$/, '') : '');
      if (!name) continue;
      const textureKey = getTextureKeyForTileset(name);
      if (!textureKey) continue;
      const entry = ALL_TILESETS.find(e => e.textureKey === textureKey);
      if (entry?.isSingleImage) continue; // single-image tilesets are rendered as sprites
      const added = tilemap.addTilesetImage(name, textureKey);
      if (added) tilesets.push(added);
    }

    // Create tile layers and position them at offset
    const logicalLayers = new Set([
      'collisions', 'module_connectors', 'character_anchors', 'spawns',
      'ui anchors', 'camera_anchors', 'chess_tables_interactions',
    ]);

    for (let i = 0; i < tilemap.layers.length; i++) {
      const layerData = tilemap.layers[i];
      const lname = layerData.name.toLowerCase();
      if (logicalLayers.has(lname)) continue;
      if (layerData.tilemapLayer) continue;

      const layer = tilemap.createLayer(i, tilesets);
      if (layer) {
        layer.setPosition(offsetX, offsetY);
        layer.setDepth(lname.includes('above') ? 200 : 0);
        (layer as any).setCullPadding?.(2, 2);
        modInstance.layers.push(layer);
      }
    }

    // Set NEAREST filter on all module tilesets
    for (const ts of normalizedTs) {
      const textureKey = getTextureKeyForTileset(ts.name);
      if (textureKey && this.scene.textures.exists(textureKey)) {
        this.scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }

    // Render GID objects (chess tables etc.) as sprites
    this.renderGidObjects(tmjData.layers, normalizedTs, offsetX, offsetY, modInstance);

    // Add collision bodies
    this.addCollisions(tmjData.layers, offsetX, offsetY, modInstance);

    return modInstance;
  }

  private patchTmjTilesets(tmjData: any) {
    if (!tmjData.tilesets) return;
    for (const ts of tmjData.tilesets) {
      if (ts.source && !ts.name) {
        const name = ts.source.replace(/\.(tsx|tsj|json)$/, '');
        ts.name = name;
        // Phaser needs these for spritesheet tilesets
        const textureKey = getTextureKeyForTileset(name);
        if (textureKey && this.scene.textures.exists(textureKey)) {
          const texSource = this.scene.textures.get(textureKey).source[0];
          const entry = ALL_TILESETS.find(e => e.textureKey === textureKey);
          if (entry && !entry.isSingleImage) {
            ts.tilewidth = tmjData.tilewidth || 32;
            ts.tileheight = tmjData.tileheight || 32;
            ts.imagewidth = texSource?.width || 256;
            ts.imageheight = texSource?.height || 256;
            ts.image = entry.image;
            ts.margin = ts.margin || 0;
            ts.spacing = ts.spacing || 0;
            ts.columns = Math.floor((ts.imagewidth) / ts.tilewidth);
            ts.tilecount = ts.columns * Math.floor((ts.imageheight) / ts.tileheight);
            delete ts.source;
          } else if (entry?.isSingleImage) {
            // Keep as image collection - single tile
            ts.tilewidth = texSource?.width || 256;
            ts.tileheight = texSource?.height || 256;
            ts.tilecount = 1;
            ts.columns = 0;
            ts.tiles = [{ id: 0, image: entry.image, imagewidth: texSource?.width || 256, imageheight: texSource?.height || 256 }];
            delete ts.source;
            delete ts.image;
          }
        }
      }
    }
  }

  private renderGidObjects(
    layers: any[],
    tilesets: { firstgid: number; name: string }[],
    offsetX: number,
    offsetY: number,
    modInstance: ModuleInstance,
  ) {
    for (const l of layers) {
      if (l.type === 'group') {
        this.renderGidObjects(l.layers || [], tilesets, offsetX, offsetY, modInstance);
      } else if (l.type === 'objectgroup') {
        const name = (l.name || '').toLowerCase();
        if (name === 'collisions' || name === 'module_connectors' || name.includes('character_anchors') ||
            name === 'spawns' || name === 'ui anchors' || name === 'camera_anchors' ||
            name === 'chess_tables_interactions' || name === 'dynamic_visuals' || name === 'dynamic_collisions') continue;

        for (const obj of l.objects || []) {
          if (!obj.gid || obj.visible === false) continue;

          const rawGid = obj.gid;
          const gid = rawGid & 0x0FFFFFFF;
          const tsInfo = findTilesetForGidInMap(gid, tilesets);
          if (!tsInfo) continue;
          if (!this.scene.textures.exists(tsInfo.textureKey)) continue;

          const sprite = this.scene.add.sprite(obj.x + offsetX, obj.y + offsetY, tsInfo.textureKey);
          sprite.setOrigin(0, 1);
          sprite.setDisplaySize(obj.width || 32, obj.height || 32);
          sprite.setDepth(10);

          const FLIPPED_H = 0x80000000;
          const FLIPPED_V = 0x40000000;
          if (rawGid & FLIPPED_H) sprite.setFlipX(true);
          if (rawGid & FLIPPED_V) sprite.setFlipY(true);

          modInstance.sprites.push(sprite);
        }
      }
    }
  }

  private addCollisions(layers: any[], offsetX: number, offsetY: number, modInstance: ModuleInstance) {
    const collisionLayer = this.findObjectLayer(layers, 'collisions');
    if (!collisionLayer) return;

    for (const obj of collisionLayer) {
      if (obj.polygon) {
        const verts = obj.polygon.map((p: { x: number; y: number }) => ({
          x: obj.x + p.x + offsetX,
          y: obj.y + p.y + offsetY,
        }));
        const xs = verts.map((v: any) => v.x);
        const ys = verts.map((v: any) => v.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const centered = verts.map((v: any) => ({ x: v.x - cx, y: v.y - cy }));
        try {
          const body = this.scene.matter.add.fromVertices(cx, cy, [centered], { isStatic: true });
          if (body) modInstance.bodies.push(body);
        } catch { /* skip invalid polygon */ }
      } else if (obj.width && obj.height) {
        const cx = obj.x + obj.width / 2 + offsetX;
        const cy = obj.y + obj.height / 2 + offsetY;
        const body = this.scene.matter.add.rectangle(cx, cy, obj.width, obj.height, { isStatic: true });
        if (body) modInstance.bodies.push(body);
        modInstance.collisionRects.push({
          x: obj.x + offsetX,
          y: obj.y + offsetY,
          width: obj.width,
          height: obj.height,
        });
      }
    }
  }

  private extractTableAnchors(
    tmjData: any,
    offsetX: number,
    offsetY: number,
    moduleInstanceId: string,
    tableMappings: TableMapping[],
    modInstance: ModuleInstance,
  ) {
    const anchorsLayer = this.findObjectLayer(tmjData.layers, 'character_anchors');
    if (!anchorsLayer) return;

    const uiAnchorsLayer = this.findObjectLayer(tmjData.layers, 'ui anchors');
    const overlayBySlot = new Map<string, { x: number; y: number; width: number; height: number; boardFiles: number; boardRanks: number }>();
    if (uiAnchorsLayer) {
      for (const obj of uiAnchorsLayer) {
        const props = this.getObjProps(obj);
        const tableId = props.tableId as string;
        if (!tableId || props.anchorType !== 'chess_board_overlay') continue;
        overlayBySlot.set(tableId, {
          x: obj.x + offsetX,
          y: obj.y + offsetY,
          width: obj.width || 128,
          height: obj.height || 128,
          boardFiles: (props.boardFiles as number) || 8,
          boardRanks: (props.boardRanks as number) || 8,
        });
      }
    }

    const cameraAnchorsLayer = this.findObjectLayer(tmjData.layers, 'camera_anchors');
    const cameraBySlot = new Map<string, { x: number; y: number; width: number; height: number; padding: number }>();
    if (cameraAnchorsLayer) {
      for (const obj of cameraAnchorsLayer) {
        const props = this.getObjProps(obj);
        const tableId = props.tableId as string;
        if (!tableId || props.anchorType !== 'camera_focus') continue;
        cameraBySlot.set(tableId, {
          x: obj.x + offsetX,
          y: obj.y + offsetY,
          width: obj.width || 150,
          height: obj.height || 150,
          padding: parseInt(props.padding as string) || 32,
        });
      }
    }

    const byTable = new Map<string, any[]>();
    for (const obj of anchorsLayer) {
      const props = this.getObjProps(obj);
      const tableId = props.tableId as string;
      if (!tableId) continue;
      if (!byTable.has(tableId)) byTable.set(tableId, []);
      byTable.get(tableId)!.push({ ...obj, _props: props, x: obj.x + offsetX, y: obj.y + offsetY });
    }

    for (const [slotId, anchors] of byTable) {
      const mapping = tableMappings.find(t => t.localSlotId === slotId);
      const runtimeId = mapping ? mapping.runtimeTableId : `${moduleInstanceId}_${slotId}`;

      const find = (anchorType: string, role: string, position?: string, side?: string, seatIndex?: string) => {
        const match = anchors.find((a: any) => {
          const p = a._props;
          return p.anchorType === anchorType &&
            p.role === role &&
            (position === undefined || p.position === position) &&
            (side === undefined || p.side === side) &&
            (seatIndex === undefined || p.seatIndex === seatIndex);
        });
        return match ? { x: match.x, y: match.y, direction: (match._props.direction as string) || 'down' } : { x: 0, y: 0, direction: 'down' };
      };

      modInstance.tableAnchors.set(runtimeId, {
        tableId: runtimeId,
        playerTop: find('chess_seat', 'player', 'top'),
        playerBottom: find('chess_seat', 'player', 'bottom'),
        spectatorLeft01: find('chess_seat', 'spectator', undefined, 'left', '1'),
        spectatorLeft02: find('chess_seat', 'spectator', undefined, 'left', '2'),
        spectatorRight01: find('chess_seat', 'spectator', undefined, 'right', '1'),
        spectatorRight02: find('chess_seat', 'spectator', undefined, 'right', '2'),
        exitTop: find('chess_seat_exit', 'player', undefined, 'top'),
        exitBottom: find('chess_seat_exit', 'player', undefined, 'bottom'),
        exitLeft: find('chess_seat_exit', 'spectator', undefined, 'left'),
        exitRight: find('chess_seat_exit', 'spectator', undefined, 'right'),
        overlayArea: overlayBySlot.get(slotId) || null,
        cameraFocus: cameraBySlot.get(slotId) || null,
      });
    }
  }

  public getTableAnchors(): Map<string, TableAnchorSet> {
    const all = new Map<string, TableAnchorSet>();
    for (const mod of this.modules) {
      for (const [id, anchors] of mod.tableAnchors) {
        all.set(id, anchors);
      }
    }
    return all;
  }

  public getCollisionRects(): Array<{ x: number; y: number; width: number; height: number }> {
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const mod of this.modules) {
      rects.push(...mod.collisionRects);
    }
    return rects;
  }

  public removeAll() {
    for (const mod of this.modules) {
      for (const layer of mod.layers) layer.destroy();
      for (const sprite of mod.sprites) sprite.destroy();
      for (const body of mod.bodies) this.scene.matter.world.remove(body);
      if (mod.tilemap) mod.tilemap.destroy();
    }
    this.modules = [];
    this.loaded = false;
  }

  public getBounds(): { minY: number; maxY: number; width: number } {
    return {
      minY: this.totalBounds.minY,
      maxY: this.totalBounds.maxY,
      width: this.totalBounds.maxX,
    };
  }

  // --- Helpers ---

  private normalizeTilesets(tilesets: any[]): { firstgid: number; name: string }[] {
    return tilesets.map((ts: any) => ({
      firstgid: ts.firstgid,
      name: ts.name || (ts.source ? ts.source.replace(/\.(tsx|tsj|json)$/, '') : ''),
    }));
  }

  private findConnector(layers: any[], name: string): { x: number; y: number } | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findConnector(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup') {
        for (const obj of l.objects || []) {
          if (obj.name === name) return { x: obj.x, y: obj.y };
        }
      }
    }
    return null;
  }

  private findObjectLayer(layers: any[], name: string): any[] | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findObjectLayer(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup' && l.name?.toLowerCase() === name.toLowerCase()) {
        return l.objects || [];
      }
    }
    return null;
  }

  private getObjProps(obj: any): Record<string, any> {
    const result: Record<string, any> = {};
    for (const p of obj.properties || []) {
      result[p.name] = p.value;
    }
    return result;
  }
}
