import Phaser from 'phaser';
import decomp from 'poly-decomp';
import { MAP_CONFIG } from '../config/mapConfig';
import { WORLD_TILESETS, ALL_TILESETS, EXTRA_TILESETS, findTilesetForGid, findTilesetForGidInMap, getTextureKeyForTileset } from '../config/worldAssets';
import { ArenaModuleManager } from '../map/ArenaModuleManager';
import {
  getCharacter,
  getIdleFrame,
  getAnimKey,
  Direction8,
  getBodyConfig,
} from '../characters/characterCatalog';
import { RemotePlayerInterpolator } from '../network/interpolation';
import AStarGrid from '../pathfinding/AStarGrid';
import { InteractionSystem } from '../interactions/InteractionSystem';
import type { InteractionEvent, InteractionObject, ZoneChangeEvent } from '../interactions/InteractionSystem';
import { loadTableRegistry, getSeatAnchor, getExitAnchor } from '../config/tableAnchors';
import type { TableAnchors, TableRegistry } from '../config/tableAnchors';
import { ChessOverlayManager } from '../overlay/ChessOverlayManager';

interface ChessArenaZone {
  id: string;
  name: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zone: Phaser.GameObjects.Zone;
  statusIndicator?: Phaser.GameObjects.Container;
}

interface RemotePlayer {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  interpolator: RemotePlayerInterpolator;
  direction: Direction8;
  isMoving: boolean;
  sessionId: string;
  playerId: string;
  seated: boolean;
  seatedBoardId: string;
  seatedSeat: 'bottom' | 'top' | '';
}

type MovementSender = (data: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  isMoving: boolean;
}) => void;

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private playerBody!: MatterJS.BodyType;
  private target: { x: number; y: number } | null = null;
  private pathWaypoints: { x: number; y: number }[] = [];
  private currentWaypointIndex = 0;
  private arenas: ChessArenaZone[] = [];
  private otherPlayers: Map<string, RemotePlayer> = new Map();

  // Debug graphics
  private debugGfx!: Phaser.GameObjects.Graphics;
  private clickMarker: { x: number; y: number } | null = null;
  private localPlayerId: string = '';

  private lastSentTime = 0;
  private readonly SEND_INTERVAL = 50;
  private movementLocked = false;
  private defaultZoom = MAP_CONFIG.zoom.default;
  private boardZoom = MAP_CONFIG.zoom.board;
  private movementSender: MovementSender | null = null;
  private currentDirection: Direction8 = 'down';
  private playerSpeed = MAP_CONFIG.playerSpeed;
  private showDebugVisuals = false;
  private playerFeetOffset = 0;
  private playerFeetOffsetX = 0;
  private pathfinder!: AStarGrid;
  private collisionRects: { x: number; y: number; width: number; height: number }[] = [];
  private collisionPolys: { x: number; y: number }[][] = [];

  // Movement / pathfinding state
  private stuckFrames = 0;
  private lastStuckPos: { x: number; y: number } | null = null;
  private readonly STUCK_THRESHOLD = 10;
  private rerouteAttempts = 0;
  private readonly MAX_REROUTE_ATTEMPTS = 3;
  private finalDestination: { x: number; y: number } | null = null;

  // Zoom state
  private targetZoom = MAP_CONFIG.zoom.default;
  private pinchStartDistance = 0;
  private pinchStartZoom = 0;
  private isPinching = false;
  private targetRotation = 0;
  private currentCameraRotation = 0;
  private inMatch = false;

  // Pixel-perfect camera state (manual follow, PPU-snapped)
  private cameraTargetX = 0;
  private cameraTargetY = 0;
  private cameraBounds = { x: 0, y: 0, w: 0, h: 0 };
  private cameraFollowing = true;

  // Map switching state
  private currentMapKey: string = MAP_CONFIG.key;
  private mapTileLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private mapTileObjectSprites: Phaser.GameObjects.Sprite[] = [];
  private mapCollisionBodies: MatterJS.BodyType[] = [];
  private currentTilemap: Phaser.Tilemaps.Tilemap | null = null;
  public onMapSwitch?: (mapKey: string) => void;

  public onBoardClick?: (arenaId: string, arenaTitle: string) => void;
  public onHouseClick?: (houseId: string) => void;
  public onPositionUpdate?: (x: number, y: number) => void;
  public onPlayerClick?: (userId: string) => void;
  public onInteractionClick?: (event: InteractionEvent) => void;
  public onProximityEnter?: (event: InteractionEvent) => void;
  public onProximityExit?: (obj: InteractionObject) => void;
  public onZoneChange?: (event: ZoneChangeEvent) => void;

  private interactionSystem!: InteractionSystem;
  public tableRegistry: TableRegistry | null = null;
  private tournamentPanelAnchors: { registry: { x: number; y: number; width: number; height: number } | null; standings: { x: number; y: number; width: number; height: number } | null } = { registry: null, standings: null };
  private currentSeatInfo: { tableId: string; role: 'player' | 'spectator'; seat: string } | null = null;
  private seatTween: Phaser.Tweens.Tween | null = null;
  private savedCollisionFilter: any = null;
  private chessOverlay!: ChessOverlayManager;

  constructor() {
    super({ key: 'WorldScene' });
  }

  preload() {
    (window as any).decomp = decomp;

    this.load.tilemapTiledJSON(MAP_CONFIG.key, MAP_CONFIG.path);

    const charDef = getCharacter();
    this.load.spritesheet(charDef.id, charDef.sheet, {
      frameWidth: charDef.frameWidth,
      frameHeight: charDef.frameHeight,
    });

    this.load.image('sitting-north', '/assets/characters/action/sitting/north.png');
    this.load.image('sitting-south', '/assets/characters/action/sitting/south.png');

    for (const ts of ALL_TILESETS) {
      this.load.image(ts.textureKey, MAP_CONFIG.basePath + ts.image);
    }

    // Preload tournament arena module maps
    this.load.tilemapTiledJSON('tournament_table_module_double', '/assets/world-v2/tournament_table_module_double.tmj');
    this.load.tilemapTiledJSON('tournament_table_module_single', '/assets/world-v2/tournament_table_module_single.tmj');
    this.load.tilemapTiledJSON('tournament_table_module_end', '/assets/world-v2/tournament_table_module_end.tmj');
  }

  create() {
    (window as any).__worldScene = this;
    const map = this.make.tilemap({ key: MAP_CONFIG.key });
    this.currentTilemap = map;

    // Add regular tilesets (spritesheet-based, with top-level image in TMJ)
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of WORLD_TILESETS) {
      if (ts.isSingleImage) continue;
      const added = map.addTilesetImage(ts.tiledName, ts.textureKey);
      if (added) tilesets.push(added);
    }

    // Enforce NEAREST filtering on all tileset textures to prevent tile bleeding
    for (const ts of WORLD_TILESETS) {
      const texture = this.textures.get(ts.textureKey);
      if (texture && texture.source.length > 0) {
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }

    const logicalSet = new Set(MAP_CONFIG.logicalLayers.map(l => l.toLowerCase()));

    // Build visibility map from raw TMJ data to skip hidden layers/groups
    const hiddenLayerIndices = this.getHiddenTileLayerIndices();

    // Build set of above_player layer names from raw TMJ (by class or path)
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    const abovePlayerNames = new Set<string>();
    if (tmjData) {
      this.collectAbovePlayerLayers(tmjData.layers, false, abovePlayerNames);
    }

    // Create ALL tile layers by index to handle duplicate names
    for (let i = 0; i < map.layers.length; i++) {
      const layerData = map.layers[i];
      const lowerName = layerData.name.toLowerCase();

      // Skip logical layers (check both full name and last segment)
      const shortName = lowerName.split('/').pop() || lowerName;
      if (logicalSet.has(lowerName) || logicalSet.has(shortName)) continue;

      // Skip hidden layers (marked visible:false in Tiled or inside hidden groups)
      if (hiddenLayerIndices.has(i)) continue;

      // Skip if already created
      if (layerData.tilemapLayer) continue;

      const layer = map.createLayer(i, tilesets);
      if (layer) {
        const isAbove = abovePlayerNames.has(lowerName);
        layer.setDepth(isAbove ? 200 : 0);
        (layer as any).setCullPadding?.(2, 2);
        this.mapTileLayers.push(layer);
      }
    }

    // Render GID-based tile objects (from ImageCollections) as sprites
    this.renderTileObjects(map, logicalSet);

    // Set up Matter world bounds
    this.matter.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Load collisions from raw TMJ (handles nested groups correctly)
    this.setupCollisionsFromTMJ();

    // Setup chess table interactives
    this.setupInteractives(map);
    this.loadTableAnchorsFromTMJ();

    // Create player at spawn point
    const spawnPoint = this.findSpawnPoint(map);
    this.createPlayer(spawnPoint.x, spawnPoint.y);
    this.createAnimations();

    // Debug graphics overlay
    this.debugGfx = this.add.graphics();
    this.debugGfx.setDepth(999);

    // Camera — manual pixel-perfect follow
    // No startFollow: Phaser's preRender would overwrite our snapped scroll with fractional values
    this.cameras.main.setZoom(this.defaultZoom);
    this.cameras.main.setRoundPixels(true);
    this.cameraBounds = { x: 0, y: 0, w: map.widthInPixels, h: map.heightInPixels };
    this.cameraTargetX = this.player.x;
    this.cameraTargetY = this.player.y;
    this.snapCameraToTarget();

    // Register late-update: runs AFTER physics, tweens, and all game object updates.
    // This is Phaser's equivalent of Unity's LateUpdate — guarantees camera reads
    // final post-physics positions, preventing 1-frame-lag jitter.
    this.events.on('postupdate', this.lateUpdate, this);

    // Build pathfinding grid
    this.buildPathfindingGrid(map.widthInPixels, map.heightInPixels);

    // Click-to-move: only on pointer RELEASE (not hold), with drag threshold
    const DRAG_THRESHOLD = 8; // px — if pointer moved more than this, it was a drag, not a tap
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.movementLocked) return;
      if (this.isPinching) return;
      const dist = Phaser.Math.Distance.Between(
        pointer.downX, pointer.downY, pointer.upX, pointer.upY
      );
      if (dist > DRAG_THRESHOLD) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      // Don't walk if pointer is over an interactive object (handled by InteractionSystem)
      if (this.interactionSystem?.hitTestPointer(worldPoint.x, worldPoint.y)) return;
      if (this.inMatch) return;
      this.navigateTo(worldPoint.x, worldPoint.y);
    });

    // "E" key for confirming proximity interactions
    this.input.keyboard?.on('keydown-E', () => {
      this.confirmProximityInteraction();
    });

    this.events.once('shutdown', () => {
      this.interactionSystem?.destroy();
    });

    // Setup zoom controls
    this.setupZoom();
  }

  /**
   * Pixel-perfect camera positioning using PPU (Pixels Per Unit) snapping.
   *
   * PPU = camera zoom = number of screen pixels per world pixel.
   * The texel grid spacing in world units = 1/PPU.
   *
   * Phaser's rendering formula:
   *   screenX = (worldX - midPoint) * zoom + viewportWidth/2
   * where midPoint = scrollX + viewportWidth/2
   *
   * For screenX to be integer when worldX is integer:
   *   midPoint * PPU must be integer.
   * We achieve this by flooring: midPoint = floor(target * PPU) / PPU
   */
  private snapCameraToTarget() {
    const cam = this.cameras.main;
    const ppu = cam.zoom; // Pixels Per Unit = zoom
    const halfW = cam.width * 0.5;
    const halfH = cam.height * 0.5;

    // Floor to nearest texel boundary (1/PPU world units)
    // Floor is preferred over round: prevents oscillation when target hovers near a boundary
    let midX = Math.floor(this.cameraTargetX * ppu) / ppu;
    let midY = Math.floor(this.cameraTargetY * ppu) / ppu;

    // Clamp so the visible rect stays within map bounds (supports negative origin)
    const { x: bx, y: by, w, h } = this.cameraBounds;
    const halfViewW = halfW / ppu;
    const halfViewH = halfH / ppu;
    if (w <= halfViewW * 2) {
      midX = bx + w / 2;
    } else {
      midX = Phaser.Math.Clamp(midX, bx + halfViewW, bx + w - halfViewW);
    }
    if (h <= halfViewH * 2) {
      midY = by + h / 2;
    } else {
      midY = Phaser.Math.Clamp(midY, by + halfViewH, by + h - halfViewH);
    }

    // Re-snap after clamping to maintain texel alignment
    midX = Math.floor(midX * ppu) / ppu;
    midY = Math.floor(midY * ppu) / ppu;

    // Set scroll (Phaser convention: midPoint = scrollX + halfViewport)
    cam.scrollX = midX - halfW;
    cam.scrollY = midY - halfH;
  }

  /**
   * Late-update: runs after physics, tweens, and scene.update().
   * Reads final post-physics body positions and snaps the camera.
   * This prevents 1-frame lag between physics step and camera positioning.
   */
  private lateUpdate() {
    if (!this.player || !this.playerBody) return;

    // Read final physics position -> snap to integer world pixels
    // Sprite origin = body position minus the offsets
    this.player.x = Math.floor(this.playerBody.position.x - this.playerFeetOffsetX);
    this.player.y = Math.floor(this.playerBody.position.y - this.playerFeetOffset);

    // Debug visualization
    this.drawDebug();

    // Check interaction proximity (runs every 10 frames for performance)
    if (this.interactionSystem && this.game.loop.frame % 10 === 0) {
      this.interactionSystem.checkProximity();
    }

    // Update camera target from final player position with smooth lerp.
    // Higher lerp while moving for responsive tracking; lower when stopped for smooth coast.
    if (this.cameraFollowing) {
      const isMoving = this.target !== null;
      const lerpSpeed = isMoving ? 0.12 : 0.06;
      this.cameraTargetX += (this.player.x - this.cameraTargetX) * lerpSpeed;
      this.cameraTargetY += (this.player.y - this.cameraTargetY) * lerpSpeed;
    }

    // Final pixel-perfect camera snap (last thing before render)
    this.snapCameraToTarget();

    // Publish active table screen rect for HTML overlay
    this.publishOverlayRect();
    this.publishTableScreenRects();
    this.publishTournamentPanelRects();

    // Snap remote players to integer positions too
    this.otherPlayers.forEach((remote) => {
      if (remote.seated) return;
      const pos = remote.interpolator.getPosition();
      remote.container.x = Math.floor(pos.x);
      remote.container.y = Math.floor(pos.y);
    });
  }

  private drawDebug() {
    this.debugGfx.clear();
    if (!this.showDebugVisuals) return;
    const bx = this.playerBody.position.x;
    const by = this.playerBody.position.y;
    const bodyConfig = getBodyConfig();
    const radius = bodyConfig.radius;

    // WHITE rectangle = full character frame canvas
    const charDef = getCharacter();
    const fw = charDef.frameWidth * charDef.scale;
    const fh = charDef.frameHeight * charDef.scale;
    const frameX = this.player.x - charDef.originX * fw;
    const frameY = this.player.y - charDef.originY * fh;
    this.debugGfx.lineStyle(1, 0xffffff, 0.6);
    this.debugGfx.strokeRect(frameX, frameY, fw, fh);

    // CYAN crosshair = sprite origin point (player.x, player.y)
    this.debugGfx.lineStyle(1, 0x00ffff, 0.9);
    this.debugGfx.beginPath();
    this.debugGfx.moveTo(this.player.x - 6, this.player.y);
    this.debugGfx.lineTo(this.player.x + 6, this.player.y);
    this.debugGfx.moveTo(this.player.x, this.player.y - 6);
    this.debugGfx.lineTo(this.player.x, this.player.y + 6);
    this.debugGfx.strokePath();

    // RED circle = physics body (collision circle, radius 10)
    this.debugGfx.lineStyle(1.5, 0xff0000, 0.9);
    this.debugGfx.strokeCircle(bx, by, radius);

    // GREEN dot = foot bottom (body center + radius)
    this.debugGfx.fillStyle(0x00ff00, 1);
    this.debugGfx.fillCircle(bx, by + radius, 3);

    // BLUE cross = click position (where user clicked)
    if (this.clickMarker) {
      this.debugGfx.lineStyle(2, 0x0088ff, 1);
      const cx = this.clickMarker.x;
      const cy = this.clickMarker.y;
      this.debugGfx.strokeCircle(cx, cy, 5);
      this.debugGfx.beginPath();
      this.debugGfx.moveTo(cx - 7, cy);
      this.debugGfx.lineTo(cx + 7, cy);
      this.debugGfx.moveTo(cx, cy - 7);
      this.debugGfx.lineTo(cx, cy + 7);
      this.debugGfx.strokePath();
    }

    // MAGENTA path = remaining waypoints
    if (this.pathWaypoints.length > 0 && this.currentWaypointIndex < this.pathWaypoints.length) {
      this.debugGfx.lineStyle(1, 0xff00ff, 0.7);
      this.debugGfx.beginPath();
      this.debugGfx.moveTo(bx, by);
      for (let i = this.currentWaypointIndex; i < this.pathWaypoints.length; i++) {
        this.debugGfx.lineTo(this.pathWaypoints[i].x, this.pathWaypoints[i].y);
      }
      this.debugGfx.strokePath();
    }
  }

  private setupZoom() {
    const { min, max, step } = MAP_CONFIG.zoom;

    // Desktop: mouse wheel / trackpad scroll zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any[], _deltaX: number, deltaY: number) => {
      if (this.movementLocked && !this.inMatch) return;
      const direction = deltaY > 0 ? -1 : 1;
      this.targetZoom = Phaser.Math.Clamp(
        this.targetZoom + direction * step,
        min,
        max
      );
    });

    // Mobile: pinch-to-zoom
    this.input.addPointer(1); // enable 2nd pointer for multi-touch

    this.input.on('pointerdown', () => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        this.isPinching = true;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        this.pinchStartDistance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.pinchStartZoom = this.targetZoom;
      }
    });

    this.input.on('pointermove', () => {
      if (!this.isPinching) return;
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) {
        this.isPinching = false;
        return;
      }
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      const currentDistance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      const scale = currentDistance / this.pinchStartDistance;
      this.targetZoom = Phaser.Math.Clamp(
        this.pinchStartZoom * scale,
        min,
        max
      );
    });

    this.input.on('pointerup', () => {
      if (this.isPinching) {
        if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) {
          this.isPinching = false;
          // Quantize to nearest step to maintain clean zoom values
          this.targetZoom = Math.round(this.targetZoom / step) * step;
          this.targetZoom = Phaser.Math.Clamp(this.targetZoom, min, max);
        }
      }
    });
  }

  private renderTileObjects(_map: Phaser.Tilemaps.Tilemap, logicalSet: Set<string>, mapKey?: string) {
    const key = mapKey || MAP_CONFIG.key;
    const tmjData = this.cache.tilemap.get(key)?.data;
    if (!tmjData) return;

    const tmjTilesets = tmjData.tilesets || [];

    const processLayers = (layers: any[], isAbove: boolean) => {
      for (const layerData of layers) {
        const lowerName = layerData.name.toLowerCase();
        const cls = (layerData.class || '').toLowerCase();
        const layerAbove = isAbove || cls === 'above_player' || lowerName.includes('(above)');

        if (layerData.type === 'group') {
          const nowAbove = layerAbove || lowerName === 'visual_above';
          processLayers(layerData.layers || [], nowAbove);
          continue;
        }

        if (layerData.type !== 'objectgroup') continue;
        if (logicalSet.has(lowerName)) continue;

        for (const obj of (layerData.objects || [])) {
          if (!obj.gid || obj.visible === false) continue;

          const rawGid = obj.gid;
          const tsDef = mapKey
            ? findTilesetForGidInMap(rawGid, tmjTilesets)
            : findTilesetForGid(rawGid);
          if (!tsDef || !tsDef.isSingleImage) continue;

          const sprite = this.add.sprite(obj.x, obj.y, tsDef.textureKey);
          sprite.setOrigin(0, 1);
          sprite.setDisplaySize(obj.width || 32, obj.height || 32);
          sprite.setDepth(layerAbove ? 200 : 0);

          const FLIPPED_H = 0x80000000;
          const FLIPPED_V = 0x40000000;
          if (rawGid & FLIPPED_H) sprite.setFlipX(true);
          if (rawGid & FLIPPED_V) sprite.setFlipY(true);

          if (obj.name) {
            (sprite as any).__objName = obj.name;
          }

          this.mapTileObjectSprites.push(sprite);
        }
      }
    };

    processLayers(tmjData.layers || [], false);
  }

  private findSpawnPoint(_map: Phaser.Tilemaps.Tilemap): { x: number; y: number } {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (tmjData) {
      const spawnObjects = this.findTMJObjectLayer(tmjData.layers, 'spawns');
      if (spawnObjects) {
        const spawnObj = spawnObjects.find((o: any) => {
          const props: any[] = o.properties || [];
          const spawnId = props.find((p: any) => p.name === 'spawnId')?.value;
          return spawnId === 'main_player_spawn' || o.name === 'main_player_spawn';
        });
        if (spawnObj && spawnObj.x !== undefined && spawnObj.y !== undefined) {
          return { x: spawnObj.x, y: spawnObj.y };
        }
      }
    }
    return { x: 1273, y: 926 };
  }

  private getHiddenTileLayerIndices(): Set<number> {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (!tmjData) return new Set();
    return this.getHiddenTileLayerIndicesForMap(tmjData);
  }

  private getHiddenTileLayerIndicesForMap(tmjData: any): Set<number> {
    if (!tmjData) return new Set();

    const hidden = new Set<number>();
    let idx = 0;

    const walk = (layers: any[], parentVisible: boolean) => {
      for (const l of layers) {
        const selfVisible = l.visible !== false;
        const effectivelyVisible = parentVisible && selfVisible;

        if (l.type === 'group') {
          walk(l.layers || [], effectivelyVisible);
        } else if (l.type === 'tilelayer') {
          if (!effectivelyVisible) hidden.add(idx);
          idx++;
        }
      }
    };

    walk(tmjData.layers || [], true);
    return hidden;
  }

  /**
   * Recursively collects layer names (lowercased, with group path prefix) that should
   * render above the player. Detection criteria:
   * 1. Layer has class="above_player" in the TMJ
   * 2. Layer is inside a group named "visual_above" (or similar)
   * 3. Layer name contains "(above)"
   */
  private collectAbovePlayerLayers(layers: any[], parentAbove: boolean, result: Set<string>, prefix = '') {
    for (const l of layers) {
      const name = l.name || '';
      const fullName = prefix ? `${prefix}/${name}` : name;
      const lowerFull = fullName.toLowerCase();
      const cls = (l.class || '').toLowerCase();
      const isAbove = parentAbove || cls === 'above_player' || lowerFull.includes('(above)');

      if (l.type === 'group') {
        const groupAbove = isAbove || name.toLowerCase() === 'visual_above';
        this.collectAbovePlayerLayers(l.layers || [], groupAbove, result, fullName);
      } else if (l.type === 'tilelayer') {
        if (isAbove) {
          result.add(lowerFull);
        }
      }
    }
  }

  private findTMJObjectLayer(layers: any[], name: string): any[] | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findTMJObjectLayer(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup' && l.name === name) {
        return l.objects || [];
      }
    }
    return null;
  }

  private setupCollisionsFromTMJ(mapKey?: string) {
    const key = mapKey || MAP_CONFIG.key;
    const tmjData = this.cache.tilemap.get(key)?.data;
    if (!tmjData) return;

    const collisionObjects = this.findObjectLayerInTMJ(tmjData.layers, 'collisions');
    if (!collisionObjects) return;

    for (const obj of collisionObjects) {
      const props: any[] = obj.properties || [];
      const labelData: Record<string, string> = {};
      for (const p of props) {
        labelData[p.name] = String(p.value);
      }
      const label = obj.name || `collision_${obj.id}`;

      if (obj.polygon) {
        // Tiled polygon vertices are relative to (obj.x, obj.y)
        const absoluteVerts = obj.polygon.map((p: { x: number; y: number }) => ({
          x: obj.x + p.x,
          y: obj.y + p.y,
        }));
        this.collisionPolys.push(absoluteVerts);
        this.createPolygonCollision(absoluteVerts, label);
      } else if (obj.width && obj.height) {
        this.collisionRects.push({ x: obj.x, y: obj.y, width: obj.width, height: obj.height });
        const cx = obj.x + obj.width / 2;
        const cy = obj.y + obj.height / 2;
        const body = this.matter.add.rectangle(cx, cy, obj.width, obj.height, {
          isStatic: true,
          label,
        });
        if (body) this.mapCollisionBodies.push(body);
      }
    }
  }

  private findObjectLayerInTMJ(layers: any[], name: string): any[] | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findObjectLayerInTMJ(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup' && l.name.toLowerCase() === name.toLowerCase()) {
        return l.objects || [];
      }
    }
    return null;
  }

  private createPolygonCollision(absoluteVerts: { x: number; y: number }[], label: string) {
    if (absoluteVerts.length < 3) return;

    // Compute the bounding box center to pass as the initial position
    const xs = absoluteVerts.map(v => v.x);
    const ys = absoluteVerts.map(v => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bboxCx = (minX + maxX) / 2;
    const bboxCy = (minY + maxY) / 2;

    // Convert to poly-decomp format and decompose into convex parts
    const poly = absoluteVerts.map(v => [v.x, v.y] as [number, number]);

    try {
      decomp.makeCCW(poly);
      decomp.removeCollinearPoints(poly, 0.01);
      if (poly.length < 3) {
        this.createSingleConvexBody(absoluteVerts, bboxCx, bboxCy, label);
        return;
      }

      const convexParts = decomp.quickDecomp(poly);
      if (!convexParts || convexParts.length === 0) {
        this.createSingleConvexBody(absoluteVerts, bboxCx, bboxCy, label);
        return;
      }

      for (let i = 0; i < convexParts.length; i++) {
        const part = convexParts[i];
        if (part.length < 3) continue;
        const partVerts = part.map((p: number[]) => ({ x: p[0], y: p[1] }));
        const partXs = partVerts.map((v: {x: number; y: number}) => v.x);
        const partYs = partVerts.map((v: {x: number; y: number}) => v.y);
        const partCx = (Math.min(...partXs) + Math.max(...partXs)) / 2;
        const partCy = (Math.min(...partYs) + Math.max(...partYs)) / 2;
        this.createSingleConvexBody(partVerts, partCx, partCy, `${label}_p${i}`);
      }
    } catch {
      this.createSingleConvexBody(absoluteVerts, bboxCx, bboxCy, label);
    }
  }

  /**
   * Creates a single convex static body from absolute-world vertices.
   * 
   * Matter.fromVertices internally recenters the shape around its center of mass,
   * which shifts the body away from where we want it. We correct by measuring
   * the offset between where Matter placed the body's bounds and where the
   * original vertices' bounds should be.
   */
  private createSingleConvexBody(
    verts: { x: number; y: number }[],
    desiredCx: number,
    desiredCy: number,
    label: string
  ) {
    if (verts.length < 3) return;

    // Make vertices relative to the desired center (Matter expects this)
    const relVerts = verts.map(v => ({ x: v.x - desiredCx, y: v.y - desiredCy }));

    const body = this.matter.add.fromVertices(desiredCx, desiredCy, [relVerts], {
      isStatic: true,
      label,
    });

    if (body) {
      this.mapCollisionBodies.push(body);
      // Matter.fromVertices shifts the body to its computed center of mass.
      // Correct: compare the body's actual bounding box to the intended one.
      const bodyBounds = body.bounds;
      const actualCx = (bodyBounds.min.x + bodyBounds.max.x) / 2;
      const actualCy = (bodyBounds.min.y + bodyBounds.max.y) / 2;

      // Our intended bounding box center
      const intendedMinX = Math.min(...verts.map(v => v.x));
      const intendedMaxX = Math.max(...verts.map(v => v.x));
      const intendedMinY = Math.min(...verts.map(v => v.y));
      const intendedMaxY = Math.max(...verts.map(v => v.y));
      const intendedCx = (intendedMinX + intendedMaxX) / 2;
      const intendedCy = (intendedMinY + intendedMaxY) / 2;

      const dx = intendedCx - actualCx;
      const dy = intendedCy - actualCy;

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        this.matter.body.setPosition(body, {
          x: body.position.x + dx,
          y: body.position.y + dy,
        });
      }
    } else {
      // fromVertices failed (degenerate shape) — fallback to AABB rectangle
      const bboxW = Math.max(...verts.map(v => v.x)) - Math.min(...verts.map(v => v.x));
      const bboxH = Math.max(...verts.map(v => v.y)) - Math.min(...verts.map(v => v.y));
      if (bboxW > 1 && bboxH > 1) {
        this.matter.add.rectangle(desiredCx, desiredCy, bboxW, bboxH, {
          isStatic: true,
          label: label + '_bbox',
        });
      }
    }
  }

  private buildPathfindingGrid(mapWidth: number, mapHeight: number) {
    this.pathfinder = new AStarGrid(16);
    // Inflate obstacles by player body radius (10px) + margin
    this.pathfinder.buildGrid(mapWidth, mapHeight, this.collisionRects, this.collisionPolys, 12);
  }

  private navigateTo(worldX: number, worldY: number) {
    // Store click position for debug visualization (raw click)
    this.clickMarker = { x: worldX, y: worldY };

    // The sprite origin should land at the click point.
    // Since sprite.x = body.x - playerFeetOffsetX and sprite.y = body.y - playerFeetOffset,
    // the body must reach (worldX + offsetX, worldY + offsetY) for origin to be at (worldX, worldY).
    const targetBodyX = worldX + this.playerFeetOffsetX;
    const targetBodyY = worldY + this.playerFeetOffset;

    const startX = this.playerBody.position.x;
    const startY = this.playerBody.position.y;

    // Cancel any previous movement
    this.stuckFrames = 0;
    this.lastStuckPos = null;
    this.rerouteAttempts = 0;
    this.finalDestination = { x: targetBodyX, y: targetBodyY };

    const waypoints = this.pathfinder.findPath(startX, startY, targetBodyX, targetBodyY);
    if (waypoints.length >= 2) {
      this.pathWaypoints = waypoints;
      this.currentWaypointIndex = 1;
      this.target = this.pathWaypoints[this.currentWaypointIndex];
    } else {
      this.stopMovement();
    }
  }

  private reroute() {
    if (!this.finalDestination) return;

    this.rerouteAttempts++;
    if (this.rerouteAttempts > this.MAX_REROUTE_ATTEMPTS) {
      this.stopMovement();
      return;
    }

    const startX = this.playerBody.position.x;
    const startY = this.playerBody.position.y;
    const endX = this.finalDestination.x;
    const endY = this.finalDestination.y;

    const waypoints = this.pathfinder.findPath(startX, startY, endX, endY);
    if (waypoints.length >= 2) {
      this.pathWaypoints = waypoints;
      this.currentWaypointIndex = 1;
      this.target = this.pathWaypoints[this.currentWaypointIndex];
      this.stuckFrames = 0;
      this.lastStuckPos = null;
    } else {
      this.stopMovement();
    }
  }

  private stopMovement() {
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    this.stuckFrames = 0;
    this.lastStuckPos = null;
    this.rerouteAttempts = 0;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    this.player.anims.stop();
    this.player.setFrame(getIdleFrame(this.currentDirection));
    this.emitMovement(false);
  }

  private setupInteractives(_map: Phaser.Tilemaps.Tilemap, mapKey?: string) {
    const key = mapKey || MAP_CONFIG.key;
    const tmjData = this.cache.tilemap.get(key)?.data;
    if (!tmjData) return;

    this.interactionSystem = new InteractionSystem(
      this,
      () => ({ x: this.player.x, y: this.player.y }),
      (x: number, y: number) => this.navigateTo(x, y),
    );

    this.interactionSystem.onInteractionClick = (event) => {
      if (this.inMatch) return;
      this.onInteractionClick?.(event);
    };
    this.interactionSystem.onProximityEnter = (event) => {
      if (this.inMatch) return;
      this.onProximityEnter?.(event);
    };
    this.interactionSystem.onProximityExit = (obj) => {
      this.onProximityExit?.(obj);
    };
    this.interactionSystem.onZoneChange = (event) => {
      this.onZoneChange?.(event);
    };

    this.interactionSystem.loadFromTMJ(tmjData);

    // Build arenas array from raw TMJ data (not Phaser's map.objects which may not flatten groups)
    const ctObjects = this.findTMJObjectLayer(tmjData.layers, 'chess_tables_interactions');
    if (ctObjects) {
      let arenaCount = 0;
      for (const obj of ctObjects) {
        const objName = obj.name || '';
        if (!objName.includes('_board')) continue;
        const props: any[] = obj.properties || [];
        const tableId = props.find((p: any) => p.name === 'tableId')?.value || '';
        const id = tableId || `arena_${arenaCount + 1}`;
        const title = objName;
        const w = obj.width || 80;
        const h = obj.height || 80;
        const x = obj.x || 0;
        const y = obj.y || 0;
        this.arenas.push({ id, name: objName, title, x, y, width: w, height: h, zone: null as any });
        arenaCount++;
      }
      console.log('[WorldScene] Arenas loaded from TMJ:', this.arenas.length);
    } else {
      console.warn('[WorldScene] chess_tables_interactions layer NOT found in TMJ!');
    }
  }

  private createPlayer(x: number, y: number) {
    const charDef = getCharacter();

    this.player = this.add.sprite(x, y, charDef.id, 0);
    this.player.setScale(charDef.scale);
    this.player.setOrigin(charDef.originX, charDef.originY);
    this.player.setDepth(100);

    // Collision body at the character's feet using a circle for smooth sliding.
    // Body config comes from admin-defined values (or fallback defaults).
    const bodyConfig = getBodyConfig(charDef.id);
    const bodyRadius = bodyConfig.radius;
    const feetOffsetX = Math.round(bodyConfig.offsetX);
    const feetOffsetY = Math.round(bodyConfig.offsetY);

    this.playerBody = this.matter.add.circle(
      x + feetOffsetX, y + feetOffsetY,
      bodyRadius,
      {
        label: 'player',
        friction: 0,
        frictionAir: 0,
        frictionStatic: 0,
        restitution: 0,
      }
    );
    this.matter.body.setInertia(this.playerBody, Infinity);
    this.playerFeetOffset = feetOffsetY;
    this.playerFeetOffsetX = feetOffsetX;
  }

  private createAnimations() {
    const charDef = getCharacter();
    for (let i = 0; i < charDef.directions.length; i++) {
      const dir = charDef.directions[i];
      const start = i * charDef.framesPerDirection;
      const end = start + charDef.framesPerDirection - 1;
      this.anims.create({
        key: getAnimKey(dir),
        frames: this.anims.generateFrameNumbers(charDef.id, { start, end }),
        frameRate: 12,
        repeat: -1,
      });
    }
  }

  update() {
    if (!this.player || !this.playerBody) return;

    // Smooth zoom interpolation — snap to target once close enough
    const currentZoom = this.cameras.main.zoom;
    if (Math.abs(currentZoom - this.targetZoom) > 0.005) {
      const newZoom = Phaser.Math.Linear(currentZoom, this.targetZoom, MAP_CONFIG.zoom.smoothSpeed * 2);
      this.cameras.main.setZoom(newZoom);
    } else if (currentZoom !== this.targetZoom) {
      this.cameras.main.setZoom(this.targetZoom);
    }

    // Smooth rotation interpolation (for black player 180° flip)
    const currentRot = this.currentCameraRotation;
    if (Math.abs(currentRot - this.targetRotation) > 0.005) {
      this.currentCameraRotation = Phaser.Math.Linear(currentRot, this.targetRotation, 0.04);
      this.cameras.main.setRotation(this.currentCameraRotation);
    } else if (currentRot !== this.targetRotation) {
      this.currentCameraRotation = this.targetRotation;
      this.cameras.main.setRotation(this.currentCameraRotation);
    }

    // Player visual position and camera are updated in lateUpdate (postupdate)
    // to guarantee they read the FINAL physics position for this frame.

    this.otherPlayers.forEach((remote) => {
      if (remote.seated) return;
      if (remote.isMoving) {
        remote.sprite.anims.play(getAnimKey(remote.direction), true);
      } else {
        remote.sprite.anims.stop();
        remote.sprite.setFrame(getIdleFrame(remote.direction));
      }
    });

    if (!this.target) {
      if (this.playerBody.speed > 0.1) {
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
        this.emitMovement(false);
      }
      return;
    }

    const bx = this.playerBody.position.x;
    const by = this.playerBody.position.y;

    // Stuck detection: if the player hasn't moved significantly, reroute
    if (this.lastStuckPos) {
      const movedDist = Math.hypot(bx - this.lastStuckPos.x, by - this.lastStuckPos.y);
      if (movedDist < 0.5) {
        this.stuckFrames++;
        if (this.stuckFrames >= this.STUCK_THRESHOLD) {
          this.stuckFrames = 0;
          this.lastStuckPos = null;
          this.reroute();
          return;
        }
      } else {
        this.stuckFrames = 0;
        this.rerouteAttempts = 0;
      }
    }
    this.lastStuckPos = { x: bx, y: by };

    // Distance to current waypoint
    const dx = this.target.x - bx;
    const dy = this.target.y - by;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Check if we've arrived at the current waypoint
    const isLastWaypoint = this.currentWaypointIndex >= this.pathWaypoints.length - 1;
    const arrivalThreshold = isLastWaypoint ? 1.0 : this.playerSpeed * 2.5;

    if (dist < arrivalThreshold) {
      if (!isLastWaypoint) {
        // Advance to next waypoint
        this.currentWaypointIndex++;
        this.target = this.pathWaypoints[this.currentWaypointIndex];
      } else {
        // Reached final destination - stop
        this.target = null;
        this.pathWaypoints = [];
        this.currentWaypointIndex = 0;
        this.finalDestination = null;
        this.rerouteAttempts = 0;
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
        this.emitMovement(false);
        if (this.onPositionUpdate) this.onPositionUpdate(this.player.x, this.player.y);
        return;
      }
    }

    // Calculate velocity towards current waypoint
    const tdx = this.target.x - bx;
    const tdy = this.target.y - by;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdist < 0.1) return;

    // Smoothly decelerate when approaching the final destination
    let speed = this.playerSpeed;
    if (isLastWaypoint) {
      const decelZone = this.playerSpeed * 6;
      if (tdist < decelZone) {
        speed = Math.max(0.4, this.playerSpeed * (tdist / decelZone));
      }
    }

    const vx = (tdx / tdist) * speed;
    const vy = (tdy / tdist) * speed;
    this.matter.body.setVelocity(this.playerBody, { x: vx, y: vy });

    const dir = this.getDirection8(tdx, tdy);
    this.currentDirection = dir;

    // Stop walk animation when speed is too low (deceleration phase)
    if (speed < this.playerSpeed * 0.35) {
      this.player.anims.stop();
      this.player.setFrame(getIdleFrame(dir));
    } else {
      this.player.anims.play(getAnimKey(dir), true);
      this.player.anims.timeScale = speed / MAP_CONFIG.playerSpeed;
    }

    const now = Date.now();
    if (now - this.lastSentTime >= this.SEND_INTERVAL) {
      this.emitMovement(true, dir);
      this.lastSentTime = now;
    }

    if (this.onPositionUpdate && this.game.loop.frame % 30 === 0) {
      this.onPositionUpdate(this.player.x, this.player.y);
    }
  }

  private getDirection8(dx: number, dy: number): Direction8 {
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle >= -22.5 && angle < 22.5) return 'right';
    if (angle >= 22.5 && angle < 67.5) return 'down-right';
    if (angle >= 67.5 && angle < 112.5) return 'down';
    if (angle >= 112.5 && angle < 157.5) return 'down-left';
    if (angle >= 157.5 || angle < -157.5) return 'left';
    if (angle >= -157.5 && angle < -112.5) return 'up-left';
    if (angle >= -112.5 && angle < -67.5) return 'up';
    return 'up-right';
  }

  private emitMovement(isMoving: boolean, direction: Direction8 = this.currentDirection) {
    if (!this.movementSender) return;
    // Send sprite position (origin point), not raw body position, for remote rendering consistency
    const spriteX = this.playerBody.position.x - this.playerFeetOffsetX;
    const spriteY = this.playerBody.position.y - this.playerFeetOffset;
    this.movementSender({
      x: spriteX,
      y: spriteY,
      targetX: this.target?.x ? this.target.x - this.playerFeetOffsetX : spriteX,
      targetY: this.target?.y ? this.target.y - this.playerFeetOffset : spriteY,
      direction,
      isMoving,
    });
  }

  // --- Public API ---

  public setLocalPlayer(playerId: string, _region: string) {
    this.localPlayerId = playerId;
  }

  public setMovementSender(sender: MovementSender) {
    this.movementSender = sender;
  }

  public getPlayerPosition(): { x: number; y: number } {
    if (this.playerBody) {
      return { x: this.playerBody.position.x, y: this.playerBody.position.y };
    }
    return { x: 1273, y: 926 };
  }

  public getArenas(): ChessArenaZone[] {
    return this.arenas;
  }

  public getCurrentMapKey(): string {
    return this.currentMapKey;
  }

  public handlePlayerJoined(p: { id: string; socketId: string; username: string; rating: number; region: string; x: number; y: number; targetX: number; targetY: number; direction: string; isMoving: boolean }) {
    if (p.id === this.localPlayerId) return;
    const sessionId = p.socketId;
    if (this.otherPlayers.has(sessionId)) return;
    this.addRemotePlayer(sessionId, p);
  }

  public handlePlayerLeftBySession(sessionId: string) {
    const remote = this.otherPlayers.get(sessionId);
    if (remote) {
      remote.container.destroy();
      this.otherPlayers.delete(sessionId);
    }
  }

  public setRemotePlayerVisibility(sessionId: string, visible: boolean) {
    const remote = this.otherPlayers.get(sessionId);
    if (remote) {
      remote.container.setVisible(visible);
    }
  }

  public hideAllRemotePlayers() {
    for (const remote of this.otherPlayers.values()) {
      remote.container.setVisible(false);
    }
  }

  public showRemotePlayer(sessionId: string) {
    const remote = this.otherPlayers.get(sessionId);
    if (remote) {
      remote.container.setVisible(true);
    }
  }

  public destroyAllRemotePlayers() {
    for (const remote of this.otherPlayers.values()) {
      remote.container.destroy();
    }
    this.otherPlayers.clear();
  }

  public updateRemotePlayerState(sessionId: string, state: { x: number; y: number; targetX: number; targetY: number; direction: string; isMoving: boolean }) {
    const remote = this.otherPlayers.get(sessionId);
    if (!remote) return;
    if (remote.seated) return;
    remote.interpolator.pushSnapshot(state.x, state.y);
    remote.direction = (state.direction as Direction8) || 'down';
    remote.isMoving = state.isMoving;
  }

  public seatRemotePlayerById(playerId: string, seat: 'bottom' | 'top', tableId: string) {
    let remote: RemotePlayer | undefined;
    for (const r of this.otherPlayers.values()) {
      if (r.playerId === playerId) { remote = r; break; }
    }
    if (!remote) return;

    const anchors = this.tableRegistry?.tables.get(tableId);
    if (!anchors) return;
    const anchor = getSeatAnchor(anchors, 'player', seat);
    if (!anchor) return;

    remote.seated = true;
    remote.seatedBoardId = tableId;
    remote.seatedSeat = seat;
    remote.isMoving = false;
    remote.sprite.anims.stop();

    // Check if local camera is rotated 180° (local player is Black)
    const localCameraRotated = this.targetRotation === Math.PI;

    if (localCameraRotated) {
      // From Black's view: opponent (White, bottom) should appear as south.png right-side-up
      // Rotate sprite 180° to counteract camera rotation
      const sittingTexture = seat === 'bottom' ? 'sitting-south' : 'sitting-north';
      remote.sprite.setTexture(sittingTexture);
      remote.sprite.setRotation(Math.PI);
    } else {
      // From White/spectator view: bottom=north, top=south (normal)
      const sittingTexture = seat === 'bottom' ? 'sitting-north' : 'sitting-south';
      remote.sprite.setTexture(sittingTexture);
      remote.sprite.setRotation(0);
    }

    remote.sprite.setFrame(0);
    remote.container.setPosition(anchor.x, anchor.y);
    remote.interpolator.pushSnapshot(anchor.x, anchor.y);
  }

  public unseatRemotePlayerById(playerId: string) {
    let remote: RemotePlayer | undefined;
    for (const r of this.otherPlayers.values()) {
      if (r.playerId === playerId) { remote = r; break; }
    }
    if (!remote) return;
    remote.seated = false;
    remote.seatedBoardId = '';
    remote.seatedSeat = '';
    remote.interpolator.pushSnapshot(remote.container.x, remote.container.y);
    const charDef = getCharacter();
    remote.sprite.setTexture(charDef.id);
    remote.sprite.setRotation(0);
    remote.sprite.setFrame(getIdleFrame(remote.direction));
  }

  public unseatRemotePlayersAtBoard(boardId: string) {
    for (const remote of this.otherPlayers.values()) {
      if (remote.seated && remote.seatedBoardId === boardId) {
        remote.seated = false;
        remote.seatedBoardId = '';
        remote.seatedSeat = '';
        remote.interpolator.pushSnapshot(remote.container.x, remote.container.y);
        const charDef = getCharacter();
        remote.sprite.setTexture(charDef.id);
        remote.sprite.setRotation(0);
        remote.sprite.setFrame(getIdleFrame(remote.direction));
      }
    }
  }

  private addRemotePlayer(sessionId: string, p: { id: string; username: string; rating: number; x: number; y: number; direction: string; isMoving: boolean }) {
    const charDef = getCharacter();
    const c = this.add.container(p.x, p.y).setDepth(99);
    const s = this.add.sprite(0, 0, charDef.id, 0);
    s.setScale(charDef.scale);
    s.setOrigin(charDef.originX, charDef.originY);
    c.add(s);

    const nameText = this.add.text(0, -30, p.username, {
      fontSize: '8px',
      color: '#fff',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5);
    c.add(nameText);

    const ratingText = this.add.text(0, -20, `${p.rating}`, {
      fontSize: '7px',
      color: '#ffd700',
      stroke: '#000',
      strokeThickness: 1,
    }).setOrigin(0.5);
    c.add(ratingText);

    c.setSize(48, 48);
    c.setInteractive(new Phaser.Geom.Rectangle(-24, -24, 48, 48), Phaser.Geom.Rectangle.Contains);
    c.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      if (this.onPlayerClick) this.onPlayerClick(p.id);
    });

    const interpolator = new RemotePlayerInterpolator(p.x, p.y);
    const direction = (p.direction as Direction8) || 'down';
    this.otherPlayers.set(sessionId, {
      container: c,
      sprite: s,
      nameText,
      interpolator,
      direction,
      isMoving: p.isMoving,
      sessionId,
      playerId: p.id,
      seated: false,
      seatedBoardId: '',
      seatedSeat: '',
    });
  }

  public updateBoardStatus(arenaId: string, status: string, info?: { playerName?: string; timeLabel?: string; fen?: string }) {
    // Use overlay manager if available
    if (this.chessOverlay) {
      if (status === 'waiting') {
        // Show board overlay with starting position; banner is handled by HTML
        this.chessOverlay.removeBanner(arenaId);
        this.chessOverlay.showMatchOverlay(arenaId, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      } else if (status === 'in_match') {
        this.chessOverlay.removeBanner(arenaId);
        if (info?.fen) {
          this.chessOverlay.showMatchOverlay(arenaId, info.fen);
        } else {
          this.chessOverlay.showInProgressBanner(arenaId);
        }
      } else {
        // Idle: show starting position on all boards
        this.chessOverlay.removeBanner(arenaId);
        this.chessOverlay.showMatchOverlay(arenaId, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      }
      return;
    }

    // Fallback to old arena-based indicators
    const arena = this.arenas.find(a => a.id === arenaId || a.title === arenaId || a.name === arenaId);
    if (!arena) return;
    if (arena.statusIndicator) {
      arena.statusIndicator.destroy();
      arena.statusIndicator = undefined;
    }
  }

  public updateBoardFEN(tableId: string, fen: string) {
    if (this.chessOverlay) {
      this.chessOverlay.removeBanner(tableId);
      this.chessOverlay.showMatchOverlay(tableId, fen);
    }
  }

  public activateOverlayInteraction(tableId: string, playerColor?: 'w' | 'b') {
    this.inMatch = true;
    this.activeOverlayTableId = tableId;
    if (this.chessOverlay) {
      this.chessOverlay.setActiveTable(tableId);
    }
    // Rotate 180 for black player - SNAP instantly (no animation)
    if (playerColor === 'b') {
      this.targetRotation = Math.PI;
      this.currentCameraRotation = Math.PI;
      this.cameras.main.setRotation(Math.PI);
      // Re-seat any already-seated remote players to update their sprite rotation
      for (const remote of this.otherPlayers.values()) {
        if (remote.seated && remote.seatedBoardId === tableId) {
          const seat = remote.seatedSeat as 'bottom' | 'top';
          if (!seat) continue;
          const sittingTexture = seat === 'bottom' ? 'sitting-south' : 'sitting-north';
          remote.sprite.setTexture(sittingTexture);
          remote.sprite.setRotation(Math.PI);
          remote.sprite.setFrame(0);
        }
      }
    }
  }

  public deactivateOverlayInteraction() {
    this.inMatch = false;
    const prevTableId = this.activeOverlayTableId;
    this.activeOverlayTableId = null;
    (window as any).__chessOverlayRect = null;
    if (this.chessOverlay && prevTableId) {
      this.chessOverlay.removeBanner(prevTableId);
      this.chessOverlay.clearActiveTable();
      // Restore the starting position overlay on the table
      this.chessOverlay.showMatchOverlay(prevTableId, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    }
    // Smoothly rotate back to normal
    this.targetRotation = 0;
    // Reset zoom to default
    this.targetZoom = MAP_CONFIG.zoom.default;
  }

  private activeOverlayTableId: string | null = null;

  private publishOverlayRect() {
    if (!this.inMatch || !this.activeOverlayTableId) {
      (window as any).__chessOverlayRect = null;
      return;
    }
    const config = this.chessOverlay?.getTableConfig(this.activeOverlayTableId);
    if (!config) {
      (window as any).__chessOverlayRect = null;
      return;
    }
    const cam = this.cameras.main;
    const canvasEl = this.game.canvas;
    const canvasRect = canvasEl.getBoundingClientRect();
    const scaleX = canvasRect.width / canvasEl.width;
    const scaleY = canvasRect.height / canvasEl.height;

    const cx = cam.scrollX + cam.width * 0.5;
    const cy = cam.scrollY + cam.height * 0.5;
    const cos = Math.cos(-this.currentCameraRotation);
    const sin = Math.sin(-this.currentCameraRotation);
    const zoom = cam.zoom;

    const toScreen = (wx: number, wy: number) => {
      const dx = wx - cx;
      const dy = wy - cy;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: (rx * zoom + cam.width * 0.5) * scaleX + canvasRect.left,
        y: (ry * zoom + cam.height * 0.5) * scaleY + canvasRect.top,
      };
    };

    const tl = toScreen(config.x, config.y);
    const br = toScreen(config.x + config.width, config.y + config.height);

    const screenX = Math.min(tl.x, br.x);
    const screenY = Math.min(tl.y, br.y);
    const screenW = Math.abs(br.x - tl.x);
    const screenH = Math.abs(br.y - tl.y);

    (window as any).__chessOverlayRect = {
      x: screenX, y: screenY, width: screenW, height: screenH,
    };
  }

  private publishTournamentPanelRects() {
    if (!this.tournamentPanelAnchors.registry && !this.tournamentPanelAnchors.standings) {
      (window as any).__tournamentPanelRects = null;
      return;
    }
    const cam = this.cameras.main;
    const canvasEl = this.game.canvas;
    const canvasRect = canvasEl.getBoundingClientRect();
    const scaleX = canvasRect.width / canvasEl.width;
    const scaleY = canvasRect.height / canvasEl.height;
    const cx = cam.scrollX + cam.width * 0.5;
    const cy = cam.scrollY + cam.height * 0.5;
    const cos = Math.cos(-this.currentCameraRotation);
    const sin = Math.sin(-this.currentCameraRotation);
    const zoom = cam.zoom;
    const toScreen = (wx: number, wy: number) => {
      const dx = wx - cx;
      const dy = wy - cy;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: (rx * zoom + cam.width * 0.5) * scaleX + canvasRect.left,
        y: (ry * zoom + cam.height * 0.5) * scaleY + canvasRect.top,
      };
    };
    const result: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [key, anchor] of Object.entries(this.tournamentPanelAnchors)) {
      if (!anchor) continue;
      const tl = toScreen(anchor.x, anchor.y);
      const br = toScreen(anchor.x + anchor.width, anchor.y + anchor.height);
      result[key] = {
        x: Math.min(tl.x, br.x),
        y: Math.min(tl.y, br.y),
        width: Math.abs(br.x - tl.x),
        height: Math.abs(br.y - tl.y),
      };
    }
    (window as any).__tournamentPanelRects = result;
  }

  private publishTableScreenRects() {
    if (!this.chessOverlay || !this.tableRegistry) return;
    const cam = this.cameras.main;
    const canvasEl = this.game.canvas;
    const canvasRect = canvasEl.getBoundingClientRect();
    const scaleX = canvasRect.width / canvasEl.width;
    const scaleY = canvasRect.height / canvasEl.height;
    const cx = cam.scrollX + cam.width * 0.5;
    const cy = cam.scrollY + cam.height * 0.5;
    const cos = Math.cos(-this.currentCameraRotation);
    const sin = Math.sin(-this.currentCameraRotation);
    const zoom = cam.zoom;

    const toScreen = (wx: number, wy: number) => {
      const dx = wx - cx;
      const dy = wy - cy;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: (rx * zoom + cam.width * 0.5) * scaleX + canvasRect.left,
        y: (ry * zoom + cam.height * 0.5) * scaleY + canvasRect.top,
      };
    };

    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [tableId] of this.tableRegistry.tables) {
      const config = this.chessOverlay.getTableConfig(tableId);
      if (!config) continue;
      const tl = toScreen(config.x, config.y);
      const br = toScreen(config.x + config.width, config.y + config.height);
      rects[tableId] = {
        x: Math.min(tl.x, br.x),
        y: Math.min(tl.y, br.y),
        width: Math.abs(br.x - tl.x),
        height: Math.abs(br.y - tl.y),
      };
    }
    (window as any).__tableScreenRects = rects;
  }

  public movePlayerToBoard(arenaId: string, side: 'left' | 'right') {
    const arena = this.arenas.find(a => a.id === arenaId || a.title === arenaId);
    if (!arena || !this.player) return;

    const centerY = arena.y + arena.height / 2;
    const targetX = side === 'left' ? arena.x - 16 : arena.x + arena.width + 16;

    this.movementLocked = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    this.tweens.add({
      targets: this.playerBody.position,
      x: targetX,
      y: centerY,
      duration: 500,
      ease: 'Power2',
      onUpdate: () => {
        this.player.x = Math.round(this.playerBody.position.x - this.playerFeetOffsetX);
        this.player.y = Math.round(this.playerBody.position.y - this.playerFeetOffset);
      },
      onComplete: () => {
        this.currentDirection = side === 'left' ? 'right' : 'left';
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
      },
    });

    this.targetZoom = this.boardZoom;
    this.cameraFollowing = false;
    this.cameraTargetX = arena.x + arena.width / 2;
    this.cameraTargetY = arena.y + arena.height / 2;
  }

  public lockMovement(arenaId?: string) {
    this.movementLocked = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    this.player.anims.stop();
    this.player.setFrame(getIdleFrame(this.currentDirection));

    if (arenaId) {
      const arena = this.arenas.find(a => a.id === arenaId);
      if (arena) this.movePlayerToBoard(arenaId, 'left');
    }
  }

  public unlockMovement() {
    this.movementLocked = false;
    this.targetZoom = this.defaultZoom;
    this.cameraFollowing = true;
  }

  public setDefaultZoom(zoom: number) {
    this.defaultZoom = zoom;
    if (!this.movementLocked) {
      this.targetZoom = zoom;
    }
  }

  public setPlayerSpeed(speed: number) {
    this.playerSpeed = speed;
  }

  public setShowDebugVisuals(show: boolean) {
    this.showDebugVisuals = show;
    if (!show && this.debugGfx) this.debugGfx.clear();
  }

  public confirmProximityInteraction() {
    this.interactionSystem?.confirmProximityInteraction();
  }

  public getInteractionStats() {
    return this.interactionSystem?.getStats() || {};
  }

  public loadTableAnchorsFromTMJ(mapKey?: string) {
    const key = mapKey || MAP_CONFIG.key;
    const tmjData = this.cache.tilemap.get(key)?.data;
    if (!tmjData) return;

    this.tableRegistry = loadTableRegistry(tmjData);
    console.log('[WorldScene] Table registry loaded:', this.tableRegistry.tables.size, 'tables');

    // Extract tournament panel anchors from ui_anchors layer
    this.tournamentPanelAnchors = { registry: null, standings: null };
    const findUiAnchors = (layers: any[]): void => {
      for (const l of layers) {
        if (l.type === 'group') findUiAnchors(l.layers || []);
        else if (l.type === 'objectgroup' && l.name === 'ui_anchors') {
          for (const obj of l.objects || []) {
            if (obj.name === 'tournament_registry_anchor') {
              this.tournamentPanelAnchors.registry = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
            } else if (obj.name === 'tournament_standings_anchor') {
              this.tournamentPanelAnchors.standings = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
            }
          }
        }
      }
    };
    findUiAnchors(tmjData.layers || []);

    // Initialize chess overlay manager and register all tables
    this.chessOverlay = new ChessOverlayManager(this);
    const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    for (const [tableId, anchors] of this.tableRegistry.tables) {
      if (anchors.overlayArea) {
        this.chessOverlay.registerTable({
          tableId,
          x: anchors.overlayArea.x,
          y: anchors.overlayArea.y,
          width: anchors.overlayArea.width,
          height: anchors.overlayArea.height,
        });
        this.chessOverlay.showMatchOverlay(tableId, startingFen);
      }
    }
  }

  public seatPlayer(tableId: string, role: 'player' | 'spectator', seat: string, playerColor?: 'w' | 'b') {
    const anchors = this.tableRegistry?.tables.get(tableId);
    if (!anchors || !this.player) {
      console.warn('[WorldScene] seatPlayer: no anchors for', tableId);
      return;
    }

    const anchor = getSeatAnchor(anchors, role, seat);
    if (!anchor || anchor.x === 0) {
      console.warn('[WorldScene] seatPlayer: invalid anchor for', tableId, role, seat);
      return;
    }

    console.log('[WorldScene] seatPlayer:', tableId, role, seat, '->', anchor.x, anchor.y, anchor.direction);

    this.currentSeatInfo = { tableId, role, seat };
    this.movementLocked = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    // Disable collisions so body can pass through obstacles to reach seat
    if (!this.savedCollisionFilter) {
      this.savedCollisionFilter = { ...this.playerBody.collisionFilter };
    }
    this.matter.body.set(this.playerBody, {
      collisionFilter: { group: -1, category: 0, mask: 0 },
    } as any);

    // Make body static so physics engine won't interfere with the tween
    this.matter.body.setStatic(this.playerBody, true);

    // Kill any existing seat tween
    if (this.seatTween) {
      this.seatTween.stop();
      this.seatTween = null;
    }

    // Target: place body so sprite origin ends up at anchor position
    const targetBodyX = anchor.x + this.playerFeetOffsetX;
    const targetBodyY = anchor.y + this.playerFeetOffset;

    const startX = this.playerBody.position.x;
    const startY = this.playerBody.position.y;

    this.seatTween = this.tweens.add({
      targets: { t: 0 },
      t: 1,
      duration: 600,
      ease: 'Power2',
      onUpdate: (_tween, target) => {
        const nx = startX + (targetBodyX - startX) * target.t;
        const ny = startY + (targetBodyY - startY) * target.t;
        this.matter.body.setPosition(this.playerBody, { x: nx, y: ny });
        this.player.x = Math.round(nx - this.playerFeetOffsetX);
        this.player.y = Math.round(ny - this.playerFeetOffset);
      },
      onComplete: () => {
        // Snap precisely to anchor
        this.matter.body.setPosition(this.playerBody, { x: targetBodyX, y: targetBodyY });
        this.player.x = Math.round(anchor.x);
        this.player.y = Math.round(anchor.y);
        this.currentDirection = anchor.direction as any;
        this.player.anims.stop();
        // For Black (camera 180°): use north.png + rotate sprite 180° to counteract camera
        // For White (camera 0°): use north.png normally
        if (playerColor === 'b') {
          this.player.setTexture('sitting-north');
          this.player.setRotation(Math.PI);
        } else {
          this.player.setTexture('sitting-north');
          this.player.setRotation(0);
        }
        this.player.setFrame(0);
        this.seatTween = null;
        // Broadcast final seated position
        this.emitMovement(false, this.currentDirection);
      },
    });

    // Focus camera on table using camera focus area
    const cam = anchors.cameraFocus;
    if (cam) {
      this.cameraFollowing = false;
      this.cameraTargetX = cam.x + cam.width / 2;
      this.cameraTargetY = cam.y + cam.height / 2;
      this.targetZoom = this.boardZoom;
    } else if (anchors.overlayArea) {
      this.cameraFollowing = false;
      this.cameraTargetX = anchors.overlayArea.x + anchors.overlayArea.width / 2;
      this.cameraTargetY = anchors.overlayArea.y + anchors.overlayArea.height / 2;
      this.targetZoom = this.boardZoom;
    }
  }

  public unseatPlayer() {
    if (!this.currentSeatInfo) {
      this.restorePhysics();
      this.unlockMovement();
      return;
    }

    const { tableId, role, seat } = this.currentSeatInfo;
    const anchors = this.tableRegistry?.tables.get(tableId);
    this.currentSeatInfo = null;

    console.log('[WorldScene] unseatPlayer:', tableId, role, seat);

    // Kill any existing seat tween
    if (this.seatTween) {
      this.seatTween.stop();
      this.seatTween = null;
    }

    if (anchors) {
      // Restore walking spritesheet before exit animation
      const charDef = getCharacter();
      this.player.setTexture(charDef.id);
      this.player.setRotation(0);
      this.player.setFrame(getIdleFrame(this.currentDirection));

      const exit = getExitAnchor(anchors, role, seat);
      if (exit && exit.x !== 0) {
        const targetBodyX = exit.x + this.playerFeetOffsetX;
        const targetBodyY = exit.y + this.playerFeetOffset;

        const startX = this.playerBody.position.x;
        const startY = this.playerBody.position.y;

        console.log('[WorldScene] exit tween from', startX, startY, 'to', targetBodyX, targetBodyY);

        this.seatTween = this.tweens.add({
          targets: { t: 0 },
          t: 1,
          duration: 400,
          ease: 'Power2',
          onUpdate: (_tween, target) => {
            const nx = startX + (targetBodyX - startX) * target.t;
            const ny = startY + (targetBodyY - startY) * target.t;
            this.matter.body.setPosition(this.playerBody, { x: nx, y: ny });
            this.player.x = Math.round(nx - this.playerFeetOffsetX);
            this.player.y = Math.round(ny - this.playerFeetOffset);
          },
          onComplete: () => {
            // Snap precisely to exit point
            this.matter.body.setPosition(this.playerBody, { x: targetBodyX, y: targetBodyY });
            this.player.x = Math.round(exit.x);
            this.player.y = Math.round(exit.y);
            this.currentDirection = exit.direction as any;
            this.player.anims.stop();
            this.player.setFrame(getIdleFrame(this.currentDirection));
            this.seatTween = null;
            // Restore body to dynamic and re-enable collisions
            this.matter.body.setStatic(this.playerBody, false);
            this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
            this.restorePhysics();
            this.unlockMovement();
            // Broadcast exit position to all players
            this.emitMovement(false, this.currentDirection);
          },
        });
        this.targetZoom = this.defaultZoom;
        this.cameraFollowing = true;
        return;
      }
    }

    // Fallback: no exit anchor found
    this.matter.body.setStatic(this.playerBody, false);
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    this.restorePhysics();
    this.unlockMovement();
    this.targetZoom = this.defaultZoom;
    this.cameraFollowing = true;
  }

  public unseatPlayerToReception() {
    // Stop any active seat tween
    if (this.seatTween) {
      this.seatTween.stop();
      this.seatTween = null;
    }

    // Stop any active tweens on the player sprite
    this.tweens.killTweensOf(this.player);

    // Clear seat info and pathfinding
    this.currentSeatInfo = null;
    this.target = null;
    this.pathWaypoints = [];

    // Reset velocity
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    // Restore texture and rotation
    const charDef = getCharacter();
    this.player.setTexture(charDef.id);
    this.player.setRotation(0);

    // Find a safe position in the reception center
    const pos = this.findRandomWalkableReceptionCenterTile();
    const targetBodyX = pos.x + this.playerFeetOffsetX;
    const targetBodyY = pos.y + this.playerFeetOffset;

    // Restore body to non-static and reset collision filter
    this.matter.body.setStatic(this.playerBody, false);
    this.restorePhysics();

    // Teleport body and sprite
    this.matter.body.setPosition(this.playerBody, { x: targetBodyX, y: targetBodyY });
    this.player.x = Math.round(pos.x);
    this.player.y = Math.round(pos.y);

    // Set direction and idle frame
    this.currentDirection = 'down';
    this.player.anims.stop();
    this.player.setFrame(getIdleFrame(this.currentDirection));

    // Restore camera and unlock movement
    this.targetZoom = this.defaultZoom;
    this.cameraFollowing = true;
    this.movementLocked = false;

    // Sync position to network immediately (before modules are destroyed)
    this.emitMovement(false, this.currentDirection);

    // Fade in for visual feedback
    this.player.setAlpha(0);
    this.tweens.add({
      targets: this.player,
      alpha: 1,
      duration: 300,
      ease: 'Power2',
    });
  }

  private findRandomWalkablePosition(): { x: number; y: number } {
    const tmjData = this.cache.tilemap.get(this.currentMapKey)?.data;
    if (!tmjData) return { x: 400, y: 400 };

    const mapWidth = tmjData.width * (tmjData.tilewidth || 32);
    const mapHeight = tmjData.height * (tmjData.tileheight || 32);
    const margin = 80;

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = margin + Math.random() * (mapWidth - margin * 2);
      const y = margin + Math.random() * (mapHeight - margin * 2);

      let collides = false;
      for (const rect of this.collisionRects) {
        if (x >= rect.x && x <= rect.x + rect.width &&
            y >= rect.y && y <= rect.y + rect.height) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        return { x, y };
      }
    }
    return { x: mapWidth / 2, y: mapHeight / 2 };
  }

  private findRandomWalkableReceptionCenterTile(): { x: number; y: number } {
    const tmjData = this.cache.tilemap.get(this.currentMapKey)?.data;
    if (!tmjData) return { x: 400, y: 400 };

    const tw = tmjData.tilewidth || 32;
    const th = tmjData.tileheight || 32;
    const mapWidthPx = tmjData.width * tw;
    const mapHeightPx = tmjData.height * th;
    const bodyRadius = getBodyConfig().radius;

    const tryRegion = (xMin: number, xMax: number, yMin: number, yMax: number): { x: number; y: number } | null => {
      const colStart = Math.max(0, Math.floor(xMin / tw));
      const colEnd = Math.min(tmjData.width - 1, Math.floor(xMax / tw));
      const rowStart = Math.max(0, Math.floor(yMin / th));
      const rowEnd = Math.min(tmjData.height - 1, Math.floor(yMax / th));

      const candidates: { x: number; y: number }[] = [];
      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const cx = col * tw + tw / 2;
          const cy = row * th + th / 2;
          candidates.push({ x: cx, y: cy });
        }
      }

      // Shuffle candidates (Fisher-Yates)
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      for (const pt of candidates) {
        if (this.isTileBlocked(pt.x, pt.y, bodyRadius)) continue;
        return pt;
      }
      return null;
    };

    // Try 40% center region first
    const center40 = tryRegion(
      mapWidthPx * 0.3, mapWidthPx * 0.7,
      mapHeightPx * 0.3, mapHeightPx * 0.7,
    );
    if (center40) return center40;

    // Try 60% center region
    const center60 = tryRegion(
      mapWidthPx * 0.2, mapWidthPx * 0.8,
      mapHeightPx * 0.2, mapHeightPx * 0.8,
    );
    if (center60) return center60;

    // Full map fallback
    const full = tryRegion(0, mapWidthPx, 0, mapHeightPx);
    if (full) return full;

    return { x: mapWidthPx / 2, y: mapHeightPx / 2 };
  }

  private isTileBlocked(cx: number, cy: number, radius: number): boolean {
    const testPoints = [
      { x: cx, y: cy },
      { x: cx - radius, y: cy },
      { x: cx + radius, y: cy },
      { x: cx, y: cy - radius },
      { x: cx, y: cy + radius },
    ];

    for (const rect of this.collisionRects) {
      const expanded = {
        x: rect.x - radius,
        y: rect.y - radius,
        width: rect.width + radius * 2,
        height: rect.height + radius * 2,
      };
      if (cx >= expanded.x && cx <= expanded.x + expanded.width &&
          cy >= expanded.y && cy <= expanded.y + expanded.height) {
        return true;
      }
    }

    for (const poly of this.collisionPolys) {
      if (poly.length < 3) continue;
      const phaserPoly = new Phaser.Geom.Polygon(poly);
      for (const pt of testPoints) {
        if (Phaser.Geom.Polygon.Contains(phaserPoly, pt.x, pt.y)) {
          return true;
        }
      }
    }

    return false;
  }

  private restorePhysics() {
    if (this.savedCollisionFilter) {
      this.matter.body.set(this.playerBody, {
        collisionFilter: this.savedCollisionFilter,
      } as any);
      this.savedCollisionFilter = null;
    }
  }

  public getTableAnchors(tableId: string): TableAnchors | undefined {
    return this.tableRegistry?.tables.get(tableId);
  }

  public getChessOverlay(): ChessOverlayManager | null {
    return this.chessOverlay || null;
  }

  public isSeated(): boolean {
    return this.currentSeatInfo !== null;
  }

  // =========================================================
  // Map Switching
  // =========================================================

  private teardownCurrentMap() {
    // Destroy tile layers
    for (const layer of this.mapTileLayers) {
      layer.destroy();
    }
    this.mapTileLayers = [];

    // Destroy tile object sprites
    for (const sprite of this.mapTileObjectSprites) {
      sprite.destroy();
    }
    this.mapTileObjectSprites = [];

    // Remove collision bodies from Matter world
    for (const body of this.mapCollisionBodies) {
      this.matter.world.remove(body);
    }
    this.mapCollisionBodies = [];
    this.collisionRects = [];
    this.collisionPolys = [];

    // Destroy interaction system
    if (this.interactionSystem) {
      this.interactionSystem.destroy();
      this.interactionSystem = null as any;
    }

    // Clear arenas
    this.arenas = [];

    // Clear chess overlay
    if (this.chessOverlay) {
      this.chessOverlay.destroy();
      this.chessOverlay = null as any;
    }

    // Clear table registry
    this.tableRegistry = null as any;
    this.tournamentPanelAnchors = { registry: null, standings: null };
    (window as any).__tournamentPanelRects = null;

    // Destroy tilemap
    if (this.currentTilemap) {
      this.currentTilemap.destroy();
      this.currentTilemap = null;
    }
  }

  // Tournament arena module system
  public arenaManager: ArenaModuleManager | null = null;

  public loadArenaModules(modules: Array<{ instanceId: string; moduleType: string; order: number }>, tables?: Array<{ runtimeTableId: string; tableNumber: number; moduleInstanceId: string; localSlotId: string }>) {
    if (!this.arenaManager) {
      this.arenaManager = new ArenaModuleManager(this);
    }
    if (this.arenaManager.isLoaded) return;

    const bounds = this.arenaManager.loadModules(modules, tables || [], this.currentMapKey);

    // Expand physics and camera bounds to include modules
    const currentTmj = this.cache.tilemap.get(this.currentMapKey)?.data;
    const recWidth = currentTmj ? currentTmj.width * (currentTmj.tilewidth || 32) : 1440;
    const recHeight = currentTmj ? currentTmj.height * (currentTmj.tileheight || 32) : 896;
    const totalWidth = Math.max(recWidth, bounds.width);
    const totalHeight = recHeight + Math.abs(bounds.minY);

    if (bounds.minY < 0) {
      this.matter.world.setBounds(0, bounds.minY, totalWidth, totalHeight);
      this.cameraBounds = { x: 0, y: bounds.minY, w: totalWidth, h: totalHeight };
      // Don't use Phaser's setBounds — it conflicts with manual snapCameraToTarget clamping
      this.cameras.main.removeBounds();
    }

    // Rebuild pathfinder with expanded area including module collisions
    const moduleCollisionRects = this.arenaManager.getCollisionRects();
    const allRects = [...this.collisionRects, ...moduleCollisionRects];
    this.pathfinder = new AStarGrid(16);
    this.pathfinder.buildGrid(totalWidth, totalHeight, allRects, this.collisionPolys, 12, 0, bounds.minY);

    // Register table anchors in the table registry
    const tableAnchors = this.arenaManager.getTableAnchors();
    for (const [runtimeId, anchors] of tableAnchors) {
      this.tableRegistry.tables.set(runtimeId, {
        tableId: runtimeId,
        playerTop: anchors.playerTop,
        playerBottom: anchors.playerBottom,
        spectatorLeft01: anchors.spectatorLeft01,
        spectatorLeft02: anchors.spectatorLeft02,
        spectatorRight01: anchors.spectatorRight01,
        spectatorRight02: anchors.spectatorRight02,
        exitTop: anchors.exitTop,
        exitBottom: anchors.exitBottom,
        exitLeft: anchors.exitLeft,
        exitRight: anchors.exitRight,
        cameraFocus: anchors.cameraFocus,
        overlayArea: anchors.overlayArea,
      });

      // Register with chess overlay so the board renders on module tables
      if (anchors.overlayArea && this.chessOverlay) {
        this.chessOverlay.registerTable({
          tableId: runtimeId,
          x: anchors.overlayArea.x,
          y: anchors.overlayArea.y,
          width: anchors.overlayArea.width,
          height: anchors.overlayArea.height,
        });
        this.chessOverlay.showMatchOverlay(runtimeId, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      }
    }

    console.log('[WorldScene] Arena modules loaded, tables registered:', tableAnchors.size,
      'pathfinder rebuilt with origin Y:', bounds.minY);
  }

  public removeArenaModules() {
    if (!this.arenaManager) return;

    // 1. Get reception dimensions from the cached TMJ
    const tmjData = this.cache.tilemap.get(this.currentMapKey)?.data;
    const tw = tmjData?.tilewidth || 32;
    const th = tmjData?.tileheight || 32;
    const receptionWidth = tmjData ? tmjData.width * tw : 9999;
    const receptionHeight = tmjData ? tmjData.height * th : 9999;

    // 2. Get module bounds and table IDs before removal
    const moduleBounds = this.arenaManager.getBounds();
    const arenaTableIds = new Set(this.arenaManager.getTableAnchors().keys());

    // 3. Determine if the local player needs to be returned to reception
    if (this.player && this.playerBody) {
      const px = this.playerBody.position.x;
      const py = this.playerBody.position.y;

      const isOutsideReception = px < 0 || py < 0 || px > receptionWidth || py > receptionHeight;
      const isInModuleRegion = moduleBounds.minY !== 0 && py <= moduleBounds.minY;
      const isSeatedAtModuleTable = this.currentSeatInfo != null && arenaTableIds.has(this.currentSeatInfo.tableId);

      if (isOutsideReception || isInModuleRegion || isSeatedAtModuleTable) {
        // 4. Teleport player to reception center and sync immediately
        this.unseatPlayerToReception();
      }
    }

    // 5. Clean up runtime tables and overlays
    for (const runtimeId of arenaTableIds) {
      this.tableRegistry.tables.delete(runtimeId);
      if (this.chessOverlay) {
        try { this.chessOverlay.unregisterTable(runtimeId); } catch { /* already removed */ }
      }
    }

    // 6. Destroy module layers, sprites, bodies
    this.arenaManager.removeAll();

    // 7. Restore physics and camera bounds to reception dimensions
    if (tmjData) {
      this.matter.world.setBounds(0, 0, receptionWidth, receptionHeight);
      this.cameraBounds = { x: 0, y: 0, w: receptionWidth, h: receptionHeight };
      this.cameras.main.removeBounds();

      // 8. Rebuild pathfinder with only reception collisions
      this.pathfinder = new AStarGrid(16);
      this.pathfinder.buildGrid(receptionWidth, receptionHeight, this.collisionRects, this.collisionPolys, 12);
    }
  }

  public setDoorState(open: boolean) {
    if (!this.arenaManager) {
      this.arenaManager = new ArenaModuleManager(this);
    }
    this.arenaManager.setDoorOpen(open);

    // Hide/show the north_extension_door_closed visual object
    for (const sprite of this.mapTileObjectSprites) {
      if ((sprite as any).__objName === 'north_extension_door_closed') {
        sprite.setVisible(!open);
      }
    }
  }

  public initDoorSystem() {
    const tmjData = this.cache.tilemap.get(this.currentMapKey)?.data;
    if (!tmjData) return;
    if (!this.arenaManager) {
      this.arenaManager = new ArenaModuleManager(this);
    }
    this.arenaManager.initDoorBlocker(tmjData);
  }


  public async switchMap(mapPath: string, targetSpawnId: string) {
    this.movementLocked = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    if (this.playerBody) {
      this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    }

    // Determine map key from path
    let mapKey: string;
    if (mapPath === MAP_CONFIG.path || mapPath === '/assets/world-v2/main_world.tmj') {
      mapKey = MAP_CONFIG.key;
    } else {
      mapKey = mapPath.replace(/^\/assets\/world-v2\//, '').replace('.tmj', '');
    }

    // Hide all remote players during transition
    for (const remote of this.otherPlayers.values()) {
      remote.container.setVisible(false);
    }

    // Load the TMJ if not already cached
    if (!this.cache.tilemap.has(mapKey)) {
      await new Promise<void>((resolve, reject) => {
        this.load.tilemapTiledJSON(mapKey, mapPath);
        this.load.once('complete', () => resolve());
        this.load.once('loaderror', () => reject(new Error(`Failed to load map: ${mapPath}`)));
        this.load.start();
      });
    }

    // Teardown old map
    try {
      this.teardownCurrentMap();
    } catch (e) {
      console.warn('[WorldScene] teardown error (non-fatal):', e);
    }

    // Build new map
    this.currentMapKey = mapKey;
    const tmjData = this.cache.tilemap.get(mapKey)?.data;
    if (!tmjData) {
      console.error('[WorldScene] switchMap: no TMJ data for', mapKey);
      this.movementLocked = false;
      return;
    }

    // Create Phaser tilemap
    const map = this.make.tilemap({ key: mapKey });
    this.currentTilemap = map;

    // Add tilesets (match TMJ tileset names to our texture keys)
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of tmjData.tilesets) {
      const textureKey = getTextureKeyForTileset(ts.name);
      if (!textureKey) {
        console.warn('[WorldScene] switchMap: unknown tileset', ts.name);
        continue;
      }
      const tileset = map.addTilesetImage(ts.name, textureKey);
      if (tileset) tilesets.push(tileset);
    }

    // Create tile layers (respect order, above-player grouping, and hidden layers)
    const logicalSet = new Set(MAP_CONFIG.logicalLayers.map(n => n.toLowerCase()));
    const abovePlayerNames = new Set<string>();
    this.collectAbovePlayerLayers(tmjData.layers, false, abovePlayerNames);

    // Compute hidden layer indices for this specific map
    const hiddenLayerIndices = this.getHiddenTileLayerIndicesForMap(tmjData);

    for (let i = 0; i < map.layers.length; i++) {
      const layerData = map.layers[i];
      const lowerName = layerData.name.toLowerCase();
      const shortName = lowerName.split('/').pop() || lowerName;
      if (logicalSet.has(lowerName) || logicalSet.has(shortName)) continue;
      if (hiddenLayerIndices.has(i)) continue;
      if (layerData.tilemapLayer) continue;

      const layer = map.createLayer(i, tilesets);
      if (layer) {
        const isAbove = abovePlayerNames.has(lowerName) || [...abovePlayerNames].some(n => n.endsWith('/' + lowerName));
        layer.setDepth(isAbove ? 200 : 0);
        (layer as any).setCullPadding?.(2, 2);
        this.mapTileLayers.push(layer);
      }
    }

    // Render tile objects (single-image sprites)
    this.renderTileObjects(map, logicalSet, mapKey);

    // Setup collisions
    this.setupCollisionsFromTMJ(mapKey);

    // Build pathfinder using actual TMJ tile dimensions
    const mapWidth = tmjData.width * (tmjData.tilewidth || MAP_CONFIG.tileSize);
    const mapHeight = tmjData.height * (tmjData.tileheight || MAP_CONFIG.tileSize);
    this.pathfinder = new AStarGrid(16);
    this.pathfinder.buildGrid(mapWidth, mapHeight, this.collisionRects, this.collisionPolys, 12);

    // Update Matter world bounds
    this.matter.world.setBounds(0, 0, mapWidth, mapHeight);

    // Setup interactions
    this.setupInteractives(map, mapKey);

    // Load table anchors from new map
    this.loadTableAnchorsFromTMJ(mapKey);

    // Position player at target spawn
    this.positionAtSpawn(tmjData, targetSpawnId);

    // Set appropriate background color for the map
    if (mapKey === MAP_CONFIG.key) {
      this.cameras.main.setBackgroundColor(0x2d5a27);
    } else {
      this.cameras.main.setBackgroundColor(0x1a1a2e);
    }

    // Update camera bounds
    this.cameraBounds = { x: 0, y: 0, w: mapWidth, h: mapHeight };

    // Register new arenas with Colyseus
    this.onMapSwitch?.(mapKey);

    // Unlock movement
    this.movementLocked = false;

    console.log('[WorldScene] switchMap complete:', mapKey, 'spawn:', targetSpawnId);

    // Initialize door system for tournament reception
    if (mapKey.includes('tournament_reception')) {
      this.initDoorSystem();
    }
  }

  private positionAtSpawn(tmjData: any, spawnId: string) {
    const spawns = this.findTMJObjectLayer(tmjData.layers, 'spawns');
    if (!spawns) {
      console.warn('[WorldScene] positionAtSpawn: no spawns layer');
      return;
    }

    let spawnObj: any = null;
    for (const obj of spawns) {
      const props: any[] = obj.properties || [];
      const sid = props.find((p: any) => p.name === 'spawnId')?.value;
      if (sid === spawnId) {
        spawnObj = obj;
        break;
      }
    }

    if (!spawnObj) {
      console.warn('[WorldScene] positionAtSpawn: spawn not found:', spawnId);
      return;
    }

    const props: any[] = spawnObj.properties || [];
    const direction = props.find((p: any) => p.name === 'direction')?.value || 'down';

    const x = spawnObj.x;
    const y = spawnObj.y;

    // Move body to spawn position
    this.matter.body.setPosition(this.playerBody, { x: x + this.playerFeetOffsetX, y: y + this.playerFeetOffset });
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    // Snap sprite
    if (this.player) {
      this.player.setPosition(x, y);
    }

    // Apply direction
    this.currentDirection = direction as any;
    if (this.player) {
      this.player.anims.stop();
      this.player.setFrame(getIdleFrame(this.currentDirection));
    }

    // Snap camera
    this.cameraTargetX = x;
    this.cameraTargetY = y;
    const cam = this.cameras.main;
    cam.centerOn(x, y);
  }
}
