import Phaser from 'phaser';
import decomp from 'poly-decomp';
import { MAP_CONFIG } from '../config/mapConfig';
import { CRAFTING_MAP } from '../config/craftingMapConfig';
import { CraftingMapRuntime } from '../world/CraftingMapRuntime';
import { WORLD_TILESETS, ALL_TILESETS, EXTRA_TILESETS, findTilesetForGid, findTilesetForGidInMap, getTextureKeyForTileset } from '../config/worldAssets';
import { ArenaModuleManager } from '../map/ArenaModuleManager';
import {
  getSelectedCharacter,
  getWorldCharacter,
  setSelectedCharacterId,
  movementOrFallback,
  firstFrameIndexFor,
  rowIndexFor,
  animKeyFor,
  directionForVector,
  RUNTIME_CHARACTER_PREFIX,
  type WorldCharacterDef,
  type Direction8,
} from '../characters/characterCatalog';
import { composedDefIdFor, ensureAppearanceDef, getGeneratorManifest, pruneComposedAppearances } from '../characters/appearanceRuntime';
import { COMPOSED_SHEET, parseWeaponRef } from '../../shared/characters/PlayerCharacterShapes';
import { loadRigConfig } from '../rigs/rigLoader';
import { resolveGatherStats, resolveWeaponProfileForFamily, resolveWeaponShootStats, type GatherToolStats } from '../rigs/weaponLoader';
import { INVENTORY_DROP_MAX_DISTANCE, WORLD_DROP_WARNING_MS, type GatherToolKind } from '../../shared/collection/CollectionShapes';
import { projectilePairedFamily } from '../../lib/character-generator/weaponCatalog';
import { ArrowProjectiles } from '../world/ArrowProjectiles';
import { RESOURCE_DROP_ICONS } from '../../lib/collection/resourceCatalog';
import type { CraftThumb } from '../../lib/craft/craftCatalog';
import {
  RIG_DIRECTION_BY_ROW,
  composedFrameColumn,
  rigHurtboxRectsFor,
  weaponHitboxRectsFor,
} from '../rigs/composedRigFrames';
import { localRectToWorldRect, type LocalRectangle, type RigConfig, type RigDirection } from '../../shared/combat/RigShapes';
import type { WeaponHitboxProfile } from '../../shared/combat/WeaponShapes';
import {
  ATTACK_COOLDOWN_CLIENT_MARGIN_MS,
  ATTACK_COOLDOWN_PAD_MS,
  getActiveHitboxRects,
  getActiveHurtboxRects,
  localShapeToWorldCoordinates,
} from '../../shared/combat/CharacterCombatShapes';
import { RemotePlayerInterpolator } from '../network/interpolation';
import { KeyboardControls, isTextInputFocused } from '../input/KeyboardControls';
import { getKeyBindings, isCapturingKey } from '../../stores/controlsStore';
import { useGameStore } from '../../stores/gameStore';
import AStarGrid from '../pathfinding/AStarGrid';
import { InteractionSystem } from '../interactions/InteractionSystem';
import type { InteractionEvent, InteractionObject, ZoneChangeEvent } from '../interactions/InteractionSystem';
import { loadTableRegistry, getSeatAnchor, getExitAnchor } from '../config/tableAnchors';
import type { TableAnchors, TableRegistry } from '../config/tableAnchors';
import { ChessOverlayManager } from '../overlay/ChessOverlayManager';
import { playerTagBus, type PlayerTagEntry } from '../playerTagBus';
import { PlacedStationLayer, type PlacementGhost } from '../world/PlacedStationLayer';
import {
  PLACED_STATION_CLEARANCE,
  PUBLIC_STATION_RECTS,
  placeableStationFor,
  placedStationRect,
  pointInRect,
  rectsOverlap,
  type Rect as StationRect,
} from '../../shared/craft/PlaceableStations';
import type { PlacedStationView } from '../../stores/placedStationsStore';

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

// ---------------------------------------------------------------------------
// Barra de HP — REGRA DE TESTE: por enquanto a barra só aparece em jogadores
// usando o personagem abaixo. Quando o sistema for aprovado, troque esta
// regra por "sempre visível" (ou por config).
// ---------------------------------------------------------------------------
const HP_BAR_TEST_CHARACTER = 'character01';
const HP_BAR_WIDTH = 28;
const HP_BAR_HEIGHT = 4;
/** Y offset of the HP bar above the sprite origin (name tags sit at -32). */
const HP_BAR_OFFSET_Y = -26;

// Hold-to-move: keep re-pathing toward the pointer while it stays pressed.
const HOLD_MOVE_ACTIVATE_MS = 150;
const HOLD_MOVE_REPATH_MS = 150;
/** Pointer must move at least this many world px to trigger a new re-path. */
const HOLD_MOVE_MIN_DELTA_PX = 6;

/** Dados de disparo resolvidos p/ uma arma de arco (flecha pareada + config do admin). */
interface ArrowShootData {
  arrowSheetUrl: string;
  rangePx: number;
  /** Dano da flecha (levels da variação no admin) — HP tirado do nó atingido. */
  damage: number;
  hitbox: Partial<Record<RigDirection, LocalRectangle>>;
}

/** Nascimento da flecha em relação à origem do sprite (centro do frame 96×96). */
const ARROW_SPAWN_OFFSET: Record<string, { x: number; y: number }> = {
  down: { x: 0, y: 10 },
  up: { x: 0, y: -16 },
  left: { x: -16, y: -6 },
  right: { x: 16, y: -6 },
};

interface RemotePlayer {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  /** Display name shown in the HTML name-tag overlay (not Canvas text). */
  username: string;
  /** Elo rating shown in the HTML name-tag overlay. */
  rating: number;
  interpolator: RemotePlayerInterpolator;
  direction: Direction8;
  isMoving: boolean;
  /** Frames consecutivos sem deslocamento visível (histerese walk/idle). */
  stillFrames: number;
  sessionId: string;
  playerId: string;
  seated: boolean;
  seatedBoardId: string;
  seatedSeat: 'bottom' | 'top' | '';
  characterId: string;
  def: WorldCharacterDef;
  /** While in the future, an attack animation owns this sprite. */
  attackingUntil: number;
  /** While in the future, the hurt animation owns this sprite (anim only). */
  hurtUntil: number;
  /** While in the future, this player is dead (death pose owns the sprite). */
  deadUntil: number;
  hp: number;
  maxHp: number;
  /** HP bar inside the container (visibility: HP_BAR_TEST_CHARACTER rule). */
  hpBar: Phaser.GameObjects.Graphics;
  /** Receita canônica renderizada ('' / ausente = personagem legado). */
  appearanceRaw?: string;
  /** Ref da arma refletida na textura composta atual ('' = desarmado). */
  equippedWeaponRef?: string;
}

type MovementSender = (data: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  isMoving: boolean;
}) => void;

type AttackSender = (data: {
  type: 'attack';
  movement: string;
  direction: string;
  characterId: string;
}) => void;

type CharacterSetSender = (characterId: string) => void;

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private playerBody!: MatterJS.BodyType;
  private target: { x: number; y: number } | null = null;
  private pathWaypoints: { x: number; y: number }[] = [];
  private currentWaypointIndex = 0;
  private arenas: ChessArenaZone[] = [];
  private otherPlayers: Map<string, RemotePlayer> = new Map();
  /** Server-authoritative ground inventory drops. */
  private worldDrops = new Map<string, Phaser.GameObjects.Container>();
  /** Aviso de "vai sumir" agendado por drop (cancelado ao recolher/remover). */
  private worldDropWarnings = new Map<string, Phaser.Time.TimerEvent>();
  /** Feedback do fluxo de soltar item: anel de alcance (segue o jogador) + marcador do ponto. */
  private dropRadiusRing: Phaser.GameObjects.Graphics | null = null;
  private dropMarker: Phaser.GameObjects.Container | null = null;
  /** Estações portáteis posicionadas (desenho + colisão); criado em create(). */
  private placedStationLayer: PlacedStationLayer | null = null;
  private placedStationRects: StationRect[] = [];
  private placedStationTickAt = 0;
  /** Clique numa estação portátil posicionada (abre painel / pedido de permissão). */
  public onPlacedStationClick: ((placedId: string) => void) | null = null;
  private inventoryPickupSender: ((dropId: string) => void) | null = null;

  // Debug graphics
  private debugGfx!: Phaser.GameObjects.Graphics;
  private clickMarker: { x: number; y: number } | null = null;
  private localPlayerId: string = '';

  private lastSentTime = 0;
  private readonly SEND_INTERVAL = 33;
  private movementLocked = false;
  /** Why the last switchCharacter() call was refused (PT-BR, for the dev button UI). */
  public lastSwitchDenial: string | null = null;
  private defaultZoom = MAP_CONFIG.zoom.default;
  private boardZoom = MAP_CONFIG.zoom.board;
  private movementSender: MovementSender | null = null;
  private attackSender: AttackSender | null = null;
  private characterSetSender: CharacterSetSender | null = null;
  private localDef: WorldCharacterDef | null = null;
  /** Composições de remotes em voo: sessionId → defId esperado (dedupe + races). */
  private pendingAppearanceAdds = new Map<string, string>();
  /** Stamp do setLocalAppearance: a última chamada vence entre awaits. */
  private localAppearanceSeq = 0;
  /** Def alvo da troca local em voo — protege o build da coleta (prune). */
  private localAppearanceTargetId: string | null = null;
  private attackingUntil = 0;
  /** False while swinging walk-attack/run-attack: those allow moving. */
  private attackLocksMovement = true;
  /** While in the future, the hurt animation owns the local sprite (anim only). */
  private hurtUntil = 0;
  /** While in the future, the local player is dead: input, movement and anims locked. */
  private deadUntil = 0;
  /** Server-aligned attack cooldown — earlier sends would be silently dropped. */
  private attackCooldownUntil = 0;
  // Hold-to-move state (see updateHoldToMove)
  private holdStartedAt = 0;
  private holdActive = false;
  private lastHoldRepath = 0;
  private lastHoldTarget: { x: number; y: number } | null = null;
  /** Teclas do jogador (WASD/atacar/interagir configuráveis) — ver updateKeyboardMove. */
  private keyboardControls: KeyboardControls | null = null;
  /** True enquanto o teclado comanda o movimento (tem prioridade sobre o clique). */
  private keyboardMoving = false;
  /** Vetores reutilizados na projeção tela→mundo do teclado (sem alocar por frame). */
  private readonly kbWorldA = new Phaser.Math.Vector2();
  private readonly kbWorldB = new Phaser.Math.Vector2();
  private localHp = 100;
  private localMaxHp = 100;
  private localHpBar: Phaser.GameObjects.Graphics | null = null;
  private combatDebugLabel: Phaser.GameObjects.Text | null = null;
  // --- Character Rig Controller no jogo (defs compostos pc-…) ---
  /** Rig carregado de /admin/rigs — dono das hurtboxes e do contrato da folha. */
  private localRig: RigConfig | null = null;
  /** Ref da arma equipada local ('' = desarmado) — chave do perfil de hitbox. */
  private localWeaponRef: string | null = null;
  /** Perfis de hitbox resolvidos por ref de arma; null = arma sem perfil. */
  private weaponProfilesByRef = new Map<string, WeaponHitboxProfile | null>();
  /** Identidade do golpe local — o mundo de coleta consome cada golpe uma vez. */
  private swingSeq = 0;
  /** Dados de disparo por ref de arma (null = arma comum, não atira). */
  private shootDataByRef = new Map<string, ArrowShootData | null>();
  private shootDataInflight = new Map<string, Promise<ArrowShootData | null>>();
  /** Stats de coleta por ref equipada (poder/nível/tipo; mão limpa = soco). */
  private gatherStatsByRef = new Map<string, GatherToolStats>();
  /** Flechas em voo (local + cosméticas dos remotos). */
  private arrowProjectiles: ArrowProjectiles | null = null;
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
  /** Cache do getBoundingClientRect do canvas — layout forçado a 60fps é caro. */
  private canvasRectLeft = 0;
  private canvasRectTop = 0;
  private canvasRectScaleX = 1;
  private canvasRectScaleY = 1;
  private canvasRectFrame = -999;
  /** Nº de tags emitidas no último frame (evita re-emitir lista vazia). */
  private lastTagCount = 0;
  /** Debug desligado: gfx já está limpo? (evita clear() por frame à toa) */
  private debugGfxCleared = false;
  /** Última pose da câmera — overlays só republicam quando ela muda. */
  private lastCamPoseX = Number.NaN;
  private lastCamPoseY = Number.NaN;
  private lastCamPoseZoom = Number.NaN;
  private lastCamPoseRot = Number.NaN;
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

    // Dark backdrop + progress bar while assets download (was: green flash)
    this.cameras.main.setBackgroundColor('#0f172a');
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const barBg = this.add.rectangle(cx, cy, 320, 10, 0x1e293b).setScrollFactor(0).setDepth(9999);
    const bar = this.add.rectangle(cx - 158, cy, 4, 6, 0xf59e0b).setOrigin(0, 0.5).setScrollFactor(0).setDepth(9999);
    const label = this.add.text(cx, cy - 26, 'Carregando mundo… 0%', {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: '14px',
      color: '#cbd5e1',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(9999);
    // Named handler so we can detach it on complete: the LoaderPlugin is
    // reused for later runtime loads (e.g. chess piece textures), and firing
    // 'progress' against the destroyed label crashes Phaser (null canvas).
    const onProgress = (v: number) => {
      if (!label.scene) return; // destroyed — stale event
      bar.width = Math.max(4, 316 * v);
      label.setText(`Carregando mundo… ${Math.round(v * 100)}%`);
    };
    this.load.on('progress', onProgress);
    this.load.once('complete', () => {
      this.load.off('progress', onProgress);
      bar.destroy();
      barBg.destroy();
      label.destroy();
    });

    this.load.tilemapTiledJSON(MAP_CONFIG.key, MAP_CONFIG.path);

    // Character system (manifest+config driven) is initialized BEFORE the
    // Phaser game is created (GameCanvas awaits initCharacterSystem()).
    const selected = getSelectedCharacter();
    if (selected) {
      this.localDef = selected;
      this.queueCharacterTextures(selected);
    } else {
      console.error('[WorldScene] No valid character found — check assets/characters and /admin/characters');
    }

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
        // @ts-ignore Phaser 4 TilemapGPULayer type
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
    this.setupKeyboardControls();

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

    // Resize: invalida o cache do rect do canvas e força a republicação dos
    // overlays HTML no próximo frame (são interativos — rect velho os desloca).
    const onScaleResize = () => {
      this.canvasRectFrame = -999;
      this.lastCamPoseX = Number.NaN;
    };
    this.scale.on('resize', onScaleResize);
    this.events.once('shutdown', () => this.scale.off('resize', onScaleResize));

    // Mapas/aparências carregados em runtime chegam com filtro NEAREST
    // explícito — marca para reaplicar o modo de zoom atual no frame seguinte
    // (depois que o carregamento e os setFilter dele terminarem).
    const onLoaderDone = () => {
      this.texFilterDirty = true;
    };
    this.load.on('complete', onLoaderDone);
    this.events.once('shutdown', () => this.load.off('complete', onLoaderDone));

    // Build pathfinding grid
    this.buildPathfindingGrid(map.widthInPixels, map.heightInPixels);

    // Click-to-move: tap (press + release) walks to the clicked point, while
    // press-and-HOLD keeps re-pathing toward wherever the pointer is
    // (updateHoldToMove). Pinch and interactive objects never trigger walking.
    const DRAG_THRESHOLD = 8; // px — if pointer moved more than this, it was a drag, not a tap
    this.input.on('pointerdown', () => {
      this.holdStartedAt = Date.now();
      this.holdActive = false;
      this.lastHoldRepath = 0;
      this.lastHoldTarget = null;
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const wasHolding = this.holdActive;
      this.holdStartedAt = 0;
      this.holdActive = false;
      // Hold already navigated continuously — keep walking to the last point.
      if (wasHolding) return;
      if (this.movementLocked) return;
      if (this.isPinching) return;
      if (Date.now() < this.deadUntil) return;
      const dist = Phaser.Math.Distance.Between(
        pointer.downX, pointer.downY, pointer.upX, pointer.upY
      );
      if (dist > DRAG_THRESHOLD) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      // Don't walk if pointer is over an interactive object (handled by InteractionSystem)
      if (this.interactionSystem?.hitTestPointer(worldPoint.x, worldPoint.y)) return;
      // Estação portátil posicionada: o clique abre o painel (zona interativa), não anda.
      if (this.placedStationLayer?.hitTest(worldPoint.x, worldPoint.y)) return;
      if (this.inMatch) return;
      this.navigateTo(worldPoint.x, worldPoint.y);
    });

    this.placedStationLayer = new PlacedStationLayer(
      this,
      (y) => (this.craftingRuntime.active ? this.craftingRuntime.depthForY(y) : 80),
      (placedId) => this.onPlacedStationClick?.(placedId),
      (rects) => {
        this.placedStationRects = rects;
        // Rotas do jogador e dos animais desviam do corpo (mesma folga das paredes).
        this.pathfinder?.setDynamicRects(rects, 12);
      },
    );

    this.events.once('shutdown', () => {
      this.keyboardControls?.destroy();
      this.keyboardControls = null;
      this.interactionSystem?.destroy();
      this.arrowProjectiles?.destroy();
      this.arrowProjectiles = null;
      this.placedStationLayer?.destroy();
      this.placedStationLayer = null;
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
      const dx = this.player.x - this.cameraTargetX;
      const dy = this.player.y - this.cameraTargetY;
      // Zona morta de 1 texel (1/zoom): sem ela o lerp assintótico persegue
      // frações para sempre e o floor do snap fica alternando ±1px (jitter).
      const texel = 1 / this.cameras.main.zoom;
      this.cameraTargetX = Math.abs(dx) < texel ? this.player.x : this.cameraTargetX + dx * lerpSpeed;
      this.cameraTargetY = Math.abs(dy) < texel ? this.player.y : this.cameraTargetY + dy * lerpSpeed;
    }

    // Final pixel-perfect camera snap (last thing before render)
    this.snapCameraToTarget();

    // Publica retângulos de overlay (tabuleiro/mesas/painéis) só quando a
    // câmera mudou — parado, os rects na tela são idênticos. A cada 10 frames
    // republica mesmo assim (estados que mudam sem mexer a câmera, ex.: sentar).
    {
      const cam = this.cameras.main;
      const camMoved =
        cam.scrollX !== this.lastCamPoseX ||
        cam.scrollY !== this.lastCamPoseY ||
        cam.zoom !== this.lastCamPoseZoom ||
        this.currentCameraRotation !== this.lastCamPoseRot;
      if (camMoved || this.game.loop.frame % 10 === 0) {
        this.lastCamPoseX = cam.scrollX;
        this.lastCamPoseY = cam.scrollY;
        this.lastCamPoseZoom = cam.zoom;
        this.lastCamPoseRot = this.currentCameraRotation;
        this.publishOverlayRect();
        this.publishTableScreenRects();
        this.publishTournamentPanelRects();
      }
    }

    // Remotos: posição interpolada SEM floor em world-space — o floor aqui
    // quantizava o passo em pixels de MUNDO (a zoom 3x cada passo virava um
    // salto de 3px na tela). roundPixels já arredonda no espaço da tela ao
    // desenhar, que é a granularidade certa.
    const frameDelta = this.game.loop.delta;
    this.otherPlayers.forEach((remote) => {
      if (remote.seated) return;
      const pos = remote.interpolator.getPosition(frameDelta);
      const moved =
        Math.abs(pos.x - remote.container.x) + Math.abs(pos.y - remote.container.y) > 0.02;
      remote.stillFrames = moved ? 0 : Math.min(remote.stillFrames + 1, 999);
      remote.container.x = pos.x;
      remote.container.y = pos.y;
    });

    // Emit HTML name-tag positions for the React overlay (PlayerNameTags).
    // We compute container-relative screen coords (no canvasRect offset) so
    // the overlay's absolute-inset-0 positioning maps directly.
    if (this.otherPlayers.size === 0) {
      // Sem remotos: emite lista vazia UMA vez e pula todo o bloco (inclusive
      // o getBoundingClientRect, que força layout do navegador).
      if (this.lastTagCount !== 0) {
        this.lastTagCount = 0;
        playerTagBus.emit([]);
      }
    } else {
      const cam = this.cameras.main;
      this.refreshCanvasRectCache();
      const scaleX = this.canvasRectScaleX;
      const scaleY = this.canvasRectScaleY;
      const cx  = cam.scrollX + cam.width  * 0.5;
      const cy  = cam.scrollY + cam.height * 0.5;
      const cos = Math.cos(-this.currentCameraRotation);
      const sin = Math.sin(-this.currentCameraRotation);
      const zoom = cam.zoom;
      // Name-tag Y offset above the container centre in world pixels.
      // 32 puts the badge just above the character's head at default zoom.
      const HEAD_OFFSET = 32;

      const tags: PlayerTagEntry[] = [];
      this.otherPlayers.forEach((remote) => {
        const wx = remote.container.x;
        const wy = remote.container.y - HEAD_OFFSET;
        const dx = wx - cx;
        const dy = wy - cy;
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        tags.push({
          sessionId: remote.sessionId,
          username:  remote.username,
          rating:    remote.rating,
          x: (rx * zoom + cam.width  * 0.5) * scaleX,
          y: (ry * zoom + cam.height * 0.5) * scaleY,
        });
      });
      this.lastTagCount = tags.length;
      playerTagBus.emit(tags);
    }
  }

  /** Atualiza o cache do rect do canvas (~2x/s) — getBoundingClientRect força layout. */
  private refreshCanvasRectCache(): void {
    if (this.canvasRectFrame >= 0 && this.game.loop.frame - this.canvasRectFrame <= 30) return;
    const canvasEl = this.game.canvas;
    const r = canvasEl.getBoundingClientRect();
    this.canvasRectLeft = r.left;
    this.canvasRectTop = r.top;
    this.canvasRectScaleX = canvasEl.width > 0 ? r.width / canvasEl.width : 1;
    this.canvasRectScaleY = canvasEl.height > 0 ? r.height / canvasEl.height : 1;
    this.canvasRectFrame = this.game.loop.frame;
  }

  /** true = texturas em LINEAR (zoom out): ver applyWorldTextureFilter. */
  private texFilterLinear = false;
  /** Reaplicar o filtro no próximo frame (setado quando o loader termina). */
  private texFilterDirty = false;

  /**
   * Zoom out (< 0.75): NEAREST em minificação vira decimação — metade das
   * linhas/colunas dos sprites some e as vacas/árvores parecem "ferver".
   * LINEAR tira a média dos texels (a 0.5x é exatamente um box filter 2x2).
   * Ao voltar para zoom >= 1, restaura NEAREST (visual pixel art intacto).
   */
  private applyWorldTextureFilter(zoom: number) {
    const wantLinear = zoom < 0.75;
    // Só reaplica ao cruzar o limiar de zoom OU quando o loader terminou um
    // carregamento (texFilterDirty). NUNCA por contagem de texturas: textos de
    // aviso/dano criam e destroem texturas o tempo todo em combate, e varrer
    // ~300 texturas com chamadas de GPU a cada golpe derrubava o FPS.
    if (wantLinear === this.texFilterLinear && !this.texFilterDirty) return;
    this.texFilterDirty = false;
    this.texFilterLinear = wantLinear;
    const mode = wantLinear
      ? Phaser.Textures.FilterMode.LINEAR
      : Phaser.Textures.FilterMode.NEAREST;
    const list = this.textures.list as Record<string, Phaser.Textures.Texture>;
    for (const key in list) {
      if (key.startsWith('__')) continue; // texturas internas do Phaser
      const tex = list[key];
      if (tex && typeof tex.setFilter === 'function') tex.setFilter(mode);
    }
  }

  private drawDebug() {
    if (!this.showDebugVisuals) {
      // Desligado: limpa UMA vez e não toca mais no gfx (clear por frame à toa).
      if (!this.debugGfxCleared) {
        this.debugGfx.clear();
        this.debugGfxCleared = true;
      }
      return;
    }
    this.debugGfxCleared = false;
    this.debugGfx.clear();
    const bx = this.playerBody.position.x;
    const by = this.playerBody.position.y;
    const radius = this.localDef?.bodyRadius ?? 10;

    // WHITE rectangle = full character frame canvas (current frame size)
    const fw = this.player.frame.width;
    const fh = this.player.frame.height;
    const frameX = this.player.x - this.player.originX * fw;
    const frameY = this.player.y - this.player.originY * fh;
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

    // Combat boxes (hurtbox lime / hitbox magenta) following the live frame
    this.drawCombatDebug();

    // Mundo de Coleta: hurtboxes dos recursos/animais (as caixas do personagem
    // saem do drawCombatDebug acima, direto do Character Rig Controller).
    if (this.craftingRuntime.active) {
      this.craftingRuntime.drawDebug(this.debugGfx);
    }
  }

  /** Zooms "limpos" para pixel art — frações tipo 1.25/1.75 deixam colunas de
   *  pixels com larguras alternadas na tela (shimmer/jitter ao mover a câmera). */
  private static readonly ZOOM_LEVELS: number[] = [0.5, 1, 2, 3, 4];

  private snapToZoomLevel(zoom: number): number {
    const levels = WorldScene.ZOOM_LEVELS;
    let best = levels[0];
    for (const z of levels) {
      if (Math.abs(z - zoom) < Math.abs(best - zoom)) best = z;
    }
    return best;
  }

  private nextZoomLevel(zoom: number, direction: 1 | -1): number {
    const levels = WorldScene.ZOOM_LEVELS;
    const i = levels.indexOf(this.snapToZoomLevel(zoom));
    return levels[Math.min(levels.length - 1, Math.max(0, i + direction))];
  }

  private setupZoom() {
    const { min, max } = MAP_CONFIG.zoom;

    // Desktop: roda do mouse / trackpad — anda pelos níveis "limpos" de zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any[], _deltaX: number, deltaY: number) => {
      if (this.movementLocked && !this.inMatch) return;
      const direction = deltaY > 0 ? -1 : 1;
      this.targetZoom = this.nextZoomLevel(this.targetZoom, direction);
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
          this.targetZoom = this.snapToZoomLevel(this.targetZoom);
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
        const lowerGroup = name.toLowerCase();
        const groupAbove = isAbove || lowerGroup === 'visual_above' || lowerGroup === 'above player';
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

  private navigateTo(worldX: number, worldY: number, opts?: { keepPathOnFail?: boolean }) {
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
    const prevFinalDestination = this.finalDestination;
    this.finalDestination = { x: targetBodyX, y: targetBodyY };

    const waypoints = this.pathfinder.findPath(startX, startY, targetBodyX, targetBodyY);
    if (waypoints.length >= 2) {
      this.pathWaypoints = waypoints;
      this.currentWaypointIndex = 1;
      this.target = this.pathWaypoints[this.currentWaypointIndex];
      // New destination: emit on the very next frame instead of waiting out
      // the throttle window, so remote clients see the direction change ASAP.
      this.lastSentTime = 0;
    } else if (opts?.keepPathOnFail) {
      // Hold-to-move sweeping over an unreachable spot (wall, water): keep
      // walking the previous path instead of freezing in place.
      this.finalDestination = prevFinalDestination;
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
    this.localIdle();
    this.emitMovement(false);
  }

  /**
   * Hold-to-move: while the pointer stays pressed, keep re-pathing toward it
   * (throttled). A quick tap is still handled by the pointerup handler; this
   * only activates after HOLD_MOVE_ACTIVATE_MS or once the pointer drags.
   */
  private updateHoldToMove() {
    if (this.holdStartedAt <= 0) return;
    if (this.keyboardMoving) return; // teclado manda; o toque volta a valer ao soltar as teclas
    if (this.isPinching || this.movementLocked || this.inMatch || this.currentSeatInfo || this.seatTween) {
      this.holdStartedAt = 0;
      this.holdActive = false;
      return;
    }
    const pointer = this.input.activePointer;
    if (!pointer.isDown) {
      // Normal exit is the pointerup handler; this covers releases that
      // happen outside the canvas.
      this.holdStartedAt = 0;
      this.holdActive = false;
      return;
    }
    const now = Date.now();
    if (!this.holdActive) {
      const heldLong = now - this.holdStartedAt >= HOLD_MOVE_ACTIVATE_MS;
      const draggedFar =
        Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.x, pointer.y) > 8;
      if (!heldLong && !draggedFar) return;
      this.holdActive = true;
    }
    // Sem caminho ativo (chegou no ponto intermediário do steering), espera
    // bem menos que os 150ms — mas nunca zero: repath por FRAME rumo a um
    // alvo inalcançável seria um A* falho (~20ms) a cada 16ms = congelamento.
    const repathWait = this.target ? HOLD_MOVE_REPATH_MS : 75;
    if (now - this.lastHoldRepath < repathWait) return;
    const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    // Hovering an interactive object mid-hold: keep the current path.
    if (this.interactionSystem?.hitTestPointer(wp.x, wp.y)) return;
    this.lastHoldRepath = now;
    const last = this.lastHoldTarget;
    if (last && this.target && Math.hypot(wp.x - last.x, wp.y - last.y) <= HOLD_MOVE_MIN_DELTA_PX) {
      return; // pointer basically didn't move — keep the current path
    }
    // Zona morta: dedo praticamente em cima do personagem — parar em vez de
    // navegar "até si mesmo" (gerava flicker anda/para + spam de rede).
    const px = this.playerBody.position.x - this.playerFeetOffsetX;
    const py = this.playerBody.position.y - this.playerFeetOffset;
    const holdDx = wp.x - px;
    const holdDy = wp.y - py;
    const holdDist = Math.hypot(holdDx, holdDy);
    if (holdDist < 20) {
      if (this.target) this.stopMovement();
      this.lastHoldTarget = { x: wp.x, y: wp.y };
      return;
    }
    this.lastHoldTarget = { x: wp.x, y: wp.y };
    // Steering: segurar/arrastar é DIREÇÃO, não destino. Limita o alvo a
    // ~240px à frente — rota curta mantém o A* barato. Rota longa recalculada
    // a cada 150ms custava 10-30ms no celular → engasgo → passo de
    // compensação da física = o "pique" ao arrastar.
    let tx = wp.x;
    let ty = wp.y;
    if (holdDist > 240) {
      const k = 240 / holdDist;
      tx = px + holdDx * k;
      ty = py + holdDy * k;
    }
    this.navigateTo(tx, ty, { keepPathOnFail: true });
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
    const def = this.localDef;
    const walk = def ? movementOrFallback(def, 'walk') : null;

    if (def && walk) {
      this.player = this.add.sprite(x, y, walk.textureKey, firstFrameIndexFor(def, walk, 'down'));
      this.player.setOrigin(def.originX, def.originY);
    } else {
      console.error('[WorldScene] createPlayer: no character definition — using placeholder');
      this.player = this.add.sprite(x, y, '__DEFAULT', 0);
      this.player.setOrigin(0.5, 0.5);
    }
    this.player.setDepth(100);
    // Nasce invisível: o sprite só aparece quando a aparência composta do
    // jogador aplicar (setLocalAppearance). Personagens legados saíram do
    // jogo — sem personagem criado, ninguém se vê (nem os outros te veem).
    this.player.setVisible(false);

    // Collision body at the character's feet using a circle for smooth sliding.
    // Body config comes from admin-defined values (or fallback defaults).
    const bodyRadius = def?.bodyRadius ?? 10;
    const feetOffsetX = Math.round(def?.bodyOffsetX ?? 0);
    const feetOffsetY = Math.round(def?.bodyOffsetY ?? 21);

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
    if (this.localDef) this.ensureCharacterAnimations(this.localDef);
  }

  private craftingRuntime = new CraftingMapRuntime(this);

  update(_time: number = 0, delta: number = 16.7) {
    if (!this.player || !this.playerBody) return;
    if (this.dropRadiusRing) this.dropRadiusRing.setPosition(this.player.x, this.player.y);
    if (this.placedStationLayer && _time - this.placedStationTickAt >= 250) {
      this.placedStationTickAt = _time;
      this.placedStationLayer.tick(Date.now());
    }

    // Mundo de Coleta: profundidade por Y — player passa atrás/na frente de árvores etc.
    if (this.craftingRuntime.active) {
      this.craftingRuntime.update(delta, this.player?.x, this.player?.y);
      this.player.setDepth(this.craftingRuntime.depthForY(this.player.y));
      this.otherPlayers.forEach((remote) => {
        remote.container.setDepth(this.craftingRuntime.depthForY(remote.container.y));
      });
    }

    // Flechas em voo: movem e (no mundo de coleta) testam contra os nós.
    if (this.arrowProjectiles) {
      const tester = this.craftingRuntime.active
        ? (rects: Phaser.Geom.Rectangle[], x: number, y: number, damage: number) =>
            this.craftingRuntime.tryProjectileHit(rects, x, y, damage)
        : null;
      this.arrowProjectiles.update(delta, tester);
    }

    // Smooth zoom interpolation — snap to target once close enough
    const currentZoom = this.cameras.main.zoom;
    if (Math.abs(currentZoom - this.targetZoom) > 0.005) {
      const newZoom = Phaser.Math.Linear(currentZoom, this.targetZoom, MAP_CONFIG.zoom.smoothSpeed * 2);
      this.cameras.main.setZoom(newZoom);
    } else if (currentZoom !== this.targetZoom) {
      this.cameras.main.setZoom(this.targetZoom);
    }
    this.applyWorldTextureFilter(this.cameras.main.zoom);

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
      // TESTE: barra de HP visível apenas para o personagem de teste.
      remote.hpBar.setVisible(!remote.seated && remote.characterId === HP_BAR_TEST_CHARACTER);
      if (remote.seated) return;
      if (Date.now() < remote.deadUntil) return; // death pose owns the sprite
      if (remote.attackingUntil > 0 && Date.now() >= remote.attackingUntil) {
        remote.attackingUntil = 0;
      }
      if (remote.attackingUntil > 0) return; // attack animation owns the sprite
      if (remote.hurtUntil > 0 && Date.now() >= remote.hurtUntil) {
        remote.hurtUntil = 0;
      }
      if (remote.hurtUntil > 0) return; // hurt animation owns the sprite
      const walk = movementOrFallback(remote.def, 'walk');
      if (!walk) return;
      // Anda enquanto o flag do servidor OU o deslocamento interpolado indicar
      // movimento (histerese: sem isso a animação alternava walk/idle nos
      // degraus de patch e o remoto parecia "gaguejar").
      if (remote.isMoving || remote.stillFrames < 8) {
        remote.sprite.anims.play(animKeyFor(remote.def.id, walk.movement, this.dirForDef(remote.def, remote.direction)), true);
      } else {
        this.remoteIdle(remote);
      }
    });

    // Local attack animation finished → settle back to idle pose
    if (this.attackingUntil > 0 && Date.now() >= this.attackingUntil) {
      this.attackingUntil = 0;
      if (!this.target && !this.keyboardMoving) this.localIdle();
    }
    // Hurt animation finished → settle (hurt never blocks movement)
    if (this.hurtUntil > 0 && Date.now() >= this.hurtUntil) {
      this.hurtUntil = 0;
      if (!this.target && !this.keyboardMoving && this.attackingUntil <= 0) this.localIdle();
    }
    this.updateLocalHpBar();
    // Dead: the corpse pose owns everything — no input, no motion — until the
    // server revives us (deadUntil also self-expires as a safety net).
    if (Date.now() < this.deadUntil) {
      if (this.playerBody.speed > 0.1) {
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
      }
      return;
    }
    this.updateHoldToMove();
    // Stationary 'attack' blocks movement; walk-attack/run-attack don't.
    if (this.attackingUntil > 0 && this.attackLocksMovement) return;

    if (this.updateKeyboardMove()) return;

    if (!this.target) {
      if (this.playerBody.speed > 0.1) {
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.localIdle();
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
        this.localIdle();
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

    // Smoothly decelerate when approaching the final destination.
    // NÃO durante hold-to-steer: com o dedo perto do personagem a zona de
    // desaceleração deixava ele lento e, ao virar o polegar para longe, a
    // volta instantânea ao speed cheio parecia uma "arrancada".
    let speed = this.playerSpeed;
    if (isLastWaypoint && !this.holdActive) {
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
      this.localIdle(dir);
    } else {
      this.localWalk(dir, speed / MAP_CONFIG.playerSpeed);
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

  /**
   * Movimento por teclado (WASD por padrão). Tem prioridade sobre o
   * clique-para-andar: apertar uma direção descarta o caminho atual sem parar.
   * Mesmas travas do clique (movimento travado, partida, assento, morte — esta
   * já tratada antes). Retorna true quando o teclado comandou este frame
   * (andando, ou acabou de soltar as teclas e parou).
   */
  private updateKeyboardMove(): boolean {
    const kb = this.keyboardControls;
    if (!kb) return false;
    if (this.movementLocked || this.inMatch || this.currentSeatInfo || this.seatTween) {
      // Travado (partida, assento, troca de mapa…): solta as teclas presas para
      // nada ficar "na fila" até destravar; quem estava andando para e avisa.
      kb.clear();
      if (this.keyboardMoving) {
        this.keyboardMoving = false;
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.localIdle();
        this.emitMovement(false);
      }
      return false;
    }
    const v = kb.moveVector();
    if (!v) {
      if (!this.keyboardMoving) return false;
      this.keyboardMoving = false;
      this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
      this.localIdle();
      this.emitMovement(false);
      if (this.onPositionUpdate) this.onPositionUpdate(this.player.x, this.player.y);
      return true;
    }
    if (this.target || this.finalDestination) {
      this.target = null;
      this.pathWaypoints = [];
      this.currentWaypointIndex = 0;
      this.finalDestination = null;
      this.stuckFrames = 0;
      this.lastStuckPos = null;
      this.rerouteAttempts = 0;
    }
    if (!this.keyboardMoving) {
      this.keyboardMoving = true;
      this.lastSentTime = 0; // primeira posição sai já neste frame
    }
    // Tela → mundo: a câmera pode estar girada (180° para quem joga de pretas),
    // e "cima" tem que ser cima NA TELA. Projeta dois pontos da tela pela
    // própria câmera (exato para qualquer rotação/zoom) e normaliza.
    let wx = v.x;
    let wy = v.y;
    if (this.currentCameraRotation !== 0) {
      const cam = this.cameras.main;
      const cx = cam.width * 0.5;
      const cy = cam.height * 0.5;
      cam.getWorldPoint(cx, cy, this.kbWorldA);
      cam.getWorldPoint(cx + v.x * 100, cy + v.y * 100, this.kbWorldB);
      const dx = this.kbWorldB.x - this.kbWorldA.x;
      const dy = this.kbWorldB.y - this.kbWorldA.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        wx = dx / len;
        wy = dy / len;
      }
    }
    this.matter.body.setVelocity(this.playerBody, { x: wx * this.playerSpeed, y: wy * this.playerSpeed });

    const dir = this.getDirection8(wx, wy);
    this.currentDirection = dir;
    this.localWalk(dir, this.playerSpeed / MAP_CONFIG.playerSpeed);

    const now = Date.now();
    if (now - this.lastSentTime >= this.SEND_INTERVAL) {
      this.emitMovement(true, dir);
      this.lastSentTime = now;
    }
    if (this.onPositionUpdate && this.game.loop.frame % 30 === 0) {
      this.onPositionUpdate(this.player.x, this.player.y);
    }
    return true;
  }

  private getDirection8(dx: number, dy: number): Direction8 {
    // 4-direction characters use the |dx|>|dy| rule; 8-direction use sectors.
    return directionForVector(this.localDef?.directions ?? 8, dx, dy);
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

  public handlePlayerJoined(p: { id: string; socketId: string; username: string; rating: number; region: string; x: number; y: number; targetX: number; targetY: number; direction: string; isMoving: boolean; characterId?: string; hp?: number; maxHp?: number; appearance?: string; equippedWeapon?: string }) {
    if (p.id === this.localPlayerId) return;
    const sessionId = p.socketId;
    if (this.otherPlayers.has(sessionId)) return;
    if (p.appearance) {
      // Reoferta com receita/arma NOVAS substitui a composição em voo:
      // addAppearanceRemote re-estampa o pending e o job antigo aborta no
      // check de stamp. Receita idêntica já em voo → dedupe.
      const defId = composedDefIdFor(p.appearance, p.equippedWeapon || null);
      if (defId && this.pendingAppearanceAdds.get(sessionId) === defId) return;
      void this.addAppearanceRemote(sessionId, p);
      return;
    }
    // Sem aparência criada = invisível para todos (personagens legados
    // saíram do jogo; quando a receita chegar via onChange, o GameCanvas
    // reoferece o join e o sprite nasce).
  }

  public handlePlayerLeftBySession(sessionId: string) {
    this.pendingAppearanceAdds.delete(sessionId); // aborta composição em voo
    const remote = this.otherPlayers.get(sessionId);
    if (remote) {
      remote.container.destroy();
      this.otherPlayers.delete(sessionId);
    }
    // Coleta defs compostos órfãos (cada textura ~3 MB).
    pruneComposedAppearances(this, this.composedDefsInUse());
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
    this.pendingAppearanceAdds.clear();
    for (const remote of this.otherPlayers.values()) {
      remote.container.destroy();
    }
    this.otherPlayers.clear();
    // Troca de mapa/sala: só o def do jogador local continua em uso.
    pruneComposedAppearances(this, this.composedDefsInUse());
  }

  /** O sprite remoto desta sessão já existe? (GameCanvas evita re-join por patch) */
  public hasRemotePlayer(sessionId: string): boolean {
    return this.otherPlayers.has(sessionId);
  }

  public updateRemotePlayerState(sessionId: string, state: { x: number; y: number; targetX: number; targetY: number; direction: string; isMoving: boolean; characterId?: string; hp?: number; maxHp?: number; appearance?: string; equippedWeapon?: string }) {
    const remote = this.otherPlayers.get(sessionId);
    if (!remote) return;
    if (state.appearance) {
      // Personagem composto: re-compõe quando a receita OU a arma mudam.
      const weapon = state.equippedWeapon ?? '';
      if (state.appearance !== remote.appearanceRaw || weapon !== (remote.equippedWeaponRef ?? '')) {
        this.applyAppearanceToRemote(remote, state.appearance, weapon);
      }
    } else if (state.characterId && state.characterId !== remote.characterId) {
      this.applyCharacterToRemote(remote, state.characterId);
    }
    if (typeof state.hp === 'number' || typeof state.maxHp === 'number') {
      const hp = typeof state.hp === 'number' ? state.hp : remote.hp;
      const maxHp = typeof state.maxHp === 'number' && state.maxHp > 0 ? state.maxHp : remote.maxHp;
      if (hp !== remote.hp || maxHp !== remote.maxHp) {
        remote.hp = hp;
        remote.maxHp = maxHp;
        this.drawHpBar(remote.hpBar, hp, maxHp);
      }
    }
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

  /**
   * Reconciles a remote sprite's seat flag with the server state. If the
   * server cleared the player's board (tournament teleport/board teardown)
   * while our sprite is still flagged as seated, the seated-skip inside
   * updateRemotePlayerState would silently discard position updates and the
   * sprite would stay pinned at the (possibly removed) arena table forever.
   * Unseats and SNAPS to the authoritative position in that case.
   */
  public syncRemoteSeat(sessionId: string, currentBoardId: string, x: number, y: number) {
    const remote = this.otherPlayers.get(sessionId);
    if (!remote) return;
    if (!remote.seated || currentBoardId !== '') return;

    remote.seated = false;
    remote.seatedBoardId = '';
    remote.seatedSeat = '';
    remote.isMoving = false;
    remote.sprite.setRotation(0);
    this.restoreRemoteWalkTexture(remote);
    remote.container.setPosition(x, y);
    remote.interpolator.pushSnapshot(x, y);
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
    remote.sprite.setRotation(0);
    this.restoreRemoteWalkTexture(remote);
  }

  public unseatRemotePlayersAtBoard(boardId: string) {
    for (const remote of this.otherPlayers.values()) {
      if (remote.seated && remote.seatedBoardId === boardId) {
        remote.seated = false;
        remote.seatedBoardId = '';
        remote.seatedSeat = '';
        remote.interpolator.pushSnapshot(remote.container.x, remote.container.y);
        remote.sprite.setRotation(0);
        this.restoreRemoteWalkTexture(remote);
      }
    }
  }

  private addRemotePlayer(sessionId: string, p: { id: string; username: string; rating: number; x: number; y: number; direction: string; isMoving: boolean; characterId?: string; hp?: number; maxHp?: number }) {
    const def = getWorldCharacter(p.characterId);
    if (!def) {
      console.error('[WorldScene] addRemotePlayer: no character definitions available');
      return;
    }
    const walk = movementOrFallback(def, 'walk');
    if (!walk) return;

    const c = this.add.container(p.x, p.y).setDepth(99);
    const hasTexture = this.textures.exists(walk.textureKey);
    const s = this.add.sprite(0, 0, hasTexture ? walk.textureKey : '__DEFAULT', 0);
    s.setOrigin(def.originX, def.originY);
    c.add(s);

    c.setSize(48, 48);
    c.setInteractive(new Phaser.Geom.Rectangle(-24, -24, 48, 48), Phaser.Geom.Rectangle.Contains);
    c.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      if (this.onPlayerClick) this.onPlayerClick(p.id);
    });

    const interpolator = new RemotePlayerInterpolator(p.x, p.y);
    const direction = (p.direction as Direction8) || 'down';
    const hpBar = this.add.graphics();
    hpBar.setPosition(0, HP_BAR_OFFSET_Y);
    c.add(hpBar);
    const remote: RemotePlayer = {
      container: c,
      sprite: s,
      username: p.username,
      rating: p.rating,
      interpolator,
      direction,
      isMoving: p.isMoving,
      stillFrames: 999,
      sessionId,
      playerId: p.id,
      seated: false,
      seatedBoardId: '',
      seatedSeat: '',
      characterId: def.id,
      def,
      attackingUntil: 0,
      hurtUntil: 0,
      deadUntil: 0,
      hp: typeof p.hp === 'number' ? p.hp : 100,
      maxHp: typeof p.maxHp === 'number' && p.maxHp > 0 ? p.maxHp : 100,
      hpBar,
    };
    this.drawHpBar(hpBar, remote.hp, remote.maxHp);
    hpBar.setVisible(def.id === HP_BAR_TEST_CHARACTER);
    this.otherPlayers.set(sessionId, remote);

    // The remote may use a character whose sheets we haven't loaded yet
    // (e.g. after they switched characters). Load on demand, then apply.
    this.ensureCharacterLoaded(def).then(() => {
      if (!remote.sprite.scene) return; // destroyed meanwhile
      if (remote.characterId !== def.id) return; // switched again meanwhile
      if (!remote.seated) this.restoreRemoteWalkTexture(remote);
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
      // Fix local player sprite: rotate Math.PI to counteract the camera rotation so
      // the character appears upright from black's perspective.
      if (this.player) {
        this.player.setTexture('sitting-north');
        this.player.setRotation(Math.PI);
        this.player.setFrame(0);
      }
    }
  }

  /**
   * Called by the ChessBoardOverlay React component when a pinch gesture
   * starts/moves/ends on the board HTML overlay.  Lets the player zoom
   * even while touching the board (which normally intercepts touch events).
   */
  public handleBoardPinch(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) {
    const { min, max } = MAP_CONFIG.zoom;
    const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
    if (phase === 'start') {
      this.isPinching = true;
      this.pinchStartDistance = dist;
      this.pinchStartZoom = this.targetZoom;
    } else if (phase === 'move' && this.isPinching && this.pinchStartDistance > 0) {
      const scale = dist / this.pinchStartDistance;
      this.targetZoom = Phaser.Math.Clamp(this.pinchStartZoom * scale, min, max);
    } else if (phase === 'end') {
      this.isPinching = false;
      this.targetZoom = this.snapToZoomLevel(this.targetZoom);
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
    this.refreshCanvasRectCache();
    const canvasRect = { left: this.canvasRectLeft, top: this.canvasRectTop };
    const scaleX = this.canvasRectScaleX;
    const scaleY = this.canvasRectScaleY;

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
    this.refreshCanvasRectCache();
    const canvasRect = { left: this.canvasRectLeft, top: this.canvasRectTop };
    const scaleX = this.canvasRectScaleX;
    const scaleY = this.canvasRectScaleY;
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
    this.refreshCanvasRectCache();
    const canvasRect = { left: this.canvasRectLeft, top: this.canvasRectTop };
    const scaleX = this.canvasRectScaleX;
    const scaleY = this.canvasRectScaleY;
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

    // Publish the active table's camera_focus_area rect (screen-space AABB +
    // its world width) so the DOM MatchHUD can anchor time boxes / buttons to
    // the board through zoom, pan and camera rotation.
    const activeId = this.activeOverlayTableId;
    const focus = activeId ? this.tableRegistry.tables.get(activeId)?.cameraFocus : null;
    if (focus && focus.width > 0) {
      const ftl = toScreen(focus.x, focus.y);
      const fbr = toScreen(focus.x + focus.width, focus.y + focus.height);
      (window as any).__activeCameraFocusRect = {
        x: Math.min(ftl.x, fbr.x),
        y: Math.min(ftl.y, fbr.y),
        width: Math.abs(fbr.x - ftl.x),
        height: Math.abs(fbr.y - ftl.y),
        worldWidth: focus.width,
      };
    } else {
      (window as any).__activeCameraFocusRect = null;
    }
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
        this.localIdle();
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
    this.localIdle();

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
    // Snap para níveis limpos de pixel art — zoom fracionário (ex.: 2.5 vindo
    // das configurações do admin/banco) gera colunas de pixels com larguras
    // alternadas (shimmer).
    const snapped = this.snapToZoomLevel(zoom);
    this.defaultZoom = snapped;
    if (!this.movementLocked) {
      this.targetZoom = snapped;
    }
  }

  /** Zoom used when the camera focuses a chess board (game mode). */
  public setBoardZoom(zoom: number) {
    // Snap para níveis limpos (evita shimmer com valores tipo 2.5 do mobile).
    const snapped = this.snapToZoomLevel(zoom);
    if (snapped === this.boardZoom) return;
    this.boardZoom = snapped;
    // Camera not following = currently focused on a board; apply live.
    if (!this.cameraFollowing) {
      this.targetZoom = snapped;
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

    // Seating as a PLAYER with a known color: orient the camera immediately so
    // a black challenge creator sees the board from their side while waiting
    // (same look as in-match). White explicitly resets to 0.
    if (role === 'player' && playerColor) {
      const rot = playerColor === 'b' ? Math.PI : 0;
      this.targetRotation = rot;
      this.currentCameraRotation = rot;
      this.cameras.main.setRotation(rot);
      // Counter-rotate the Phaser board preview pieces so they read upright
      this.chessOverlay?.setPreviewRotation(tableId, rot);
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

    // Restore camera orientation (challenge-as-black rotates it 180°)
    this.targetRotation = 0;
    this.chessOverlay?.setPreviewRotation(tableId, 0);

    console.log('[WorldScene] unseatPlayer:', tableId, role, seat);

    // Kill any existing seat tween
    if (this.seatTween) {
      this.seatTween.stop();
      this.seatTween = null;
    }

    if (anchors) {
      // Restore walking spritesheet before exit animation
      this.restoreLocalWalkTexture();
      this.player.setRotation(0);

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
            this.localIdle();
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
    this.restoreLocalWalkTexture();
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
    this.localIdle();

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
    const bodyRadius = this.localDef?.bodyRadius ?? 10;

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

  public getCurrentSeatTableId(): string | null {
    return this.currentSeatInfo?.tableId ?? null;
  }

  // =========================================================
  // Map Switching
  // =========================================================

  private teardownCurrentMap() {
    // Mundo de Coleta: sprites de recursos/collections e timer da água
    this.craftingRuntime.teardown();

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
      this.tableRegistry!.tables.set(runtimeId, {
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

    // Register clickable spectator seats for module tables (runtime ids)
    this.interactionSystem?.addModuleChessInteractions(this.arenaManager.getInteractionFeeds());

    console.log('[WorldScene] Arena modules loaded, tables registered:', tableAnchors.size,
      'pathfinder rebuilt with origin Y:', bounds.minY);
  }

  public removeArenaModules() {
    if (!this.arenaManager) return;

    // Drop module spectator-seat click zones before the tables disappear
    this.interactionSystem?.removeModuleChessInteractions();

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
      this.tableRegistry!.tables.delete(runtimeId);
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
    const isCrafting = this.craftingRuntime.isCraftingPath(mapPath);
    if (mapPath === MAP_CONFIG.path || mapPath === '/assets/world-v2/main_world.tmj') {
      mapKey = MAP_CONFIG.key;
    } else if (isCrafting) {
      mapKey = CRAFTING_MAP.key;
    } else {
      mapKey = mapPath.replace(/^\/assets\/world-v2\//, '').replace('.tmj', '');
    }

    // Mundo de Coleta: garante TMJ embutido + texturas dinâmicas ANTES de montar o mapa
    if (isCrafting) {
      await this.craftingRuntime.prepare();
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
      const textureKey = getTextureKeyForTileset(ts.name) ?? this.craftingRuntime.textureKeyForTileset(ts.name);
      if (!textureKey) {
        // Collections do Mundo de Coleta são desenhadas pelo runtime, não via createLayer
        if (!isCrafting) console.warn('[WorldScene] switchMap: unknown tileset', ts.name);
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
        // @ts-ignore Phaser 4 TilemapGPULayer type
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
    // Estações portáteis que continuam posicionadas (mesma sala) voltam à grade nova.
    this.placedStationLayer?.reattachBodies();

    // Update Matter world bounds
    this.matter.world.setBounds(0, 0, mapWidth, mapHeight);

    // Setup interactions
    this.setupInteractives(map, mapKey);

    // Load table anchors from new map
    this.loadTableAnchorsFromTMJ(mapKey);

    // Conteúdo específico do Mundo de Coleta (collections, água animada, recursos)
    if (isCrafting) {
      // Animais respeitam as mesmas colisões do jogador (grade do pathfinder).
      this.craftingRuntime.setCollisionQuery((x, y) => this.pathfinder.isWorldBlockedAt(x, y));
      // Golpes em recursos usam as hitboxes da arma equipada (perfil do
      // Character Rig Controller), frame a frame.
      this.craftingRuntime.setPlayerSwingQuery(() => this.currentSwingState());
      this.craftingRuntime.postBuild(map, tmjData);
    } else if (this.player) {
      this.player.setDepth(100); // restaura o depth fixo fora do Mundo de Coleta
    }

    // Position player at target spawn
    this.positionAtSpawn(tmjData, targetSpawnId);

    // Set appropriate background color for the map
    if (mapKey === MAP_CONFIG.key || isCrafting) {
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
    // Mapas sem camada 'spawns' (ex.: Mundo de Coleta) usam 'character_spawn' (pontos simples)
    const spawns = this.findTMJObjectLayer(tmjData.layers, 'spawns')
      ?? this.findTMJObjectLayer(tmjData.layers, 'character_spawn');
    if (!spawns) {
      console.warn('[WorldScene] positionAtSpawn: no spawns layer');
      return;
    }

    let spawnObj: any = null;
    for (const obj of spawns) {
      const props: any[] = obj.properties || [];
      const sid = props.find((p: any) => p.name === 'spawnId')?.value;
      if (sid === spawnId || obj.name === spawnId) {
        spawnObj = obj;
        break;
      }
    }

    if (!spawnObj) {
      // Pontos de character_spawn não têm spawnId — usa o primeiro da camada
      spawnObj = spawns[0];
      if (!spawnObj) {
        console.warn('[WorldScene] positionAtSpawn: spawn not found:', spawnId);
        return;
      }
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
      this.localIdle();
    }

    // Snap camera
    this.cameraTargetX = x;
    this.cameraTargetY = y;
    const cam = this.cameras.main;
    cam.centerOn(x, y);
  }

  // Server-driven teleport (e.g. tournament end): snap the local player to
  // the given coordinates, killing any active tweens (seat/unseat).
  teleportLocalPlayer(x: number, y: number) {
    // Cancel any seat/exit tween first: its onUpdate drags the body toward
    // the table exit anchor via a proxy target, so killTweensOf(player)
    // alone would NOT stop it and it would override this teleport.
    if (this.seatTween) {
      this.seatTween.stop();
      this.seatTween = null;
    }
    if (this.player) {
      this.tweens.killTweensOf(this.player);
      this.restoreLocalWalkTexture();
    }
    this.currentSeatInfo = null;
    this.target = null;
    this.pathWaypoints = [];
    this.matter.body.setStatic(this.playerBody, false);
    this.restorePhysics();
    this.unlockMovement();
    this.matter.body.setPosition(this.playerBody, { x: x + this.playerFeetOffsetX, y: y + this.playerFeetOffset });
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    if (this.player) {
      this.player.setPosition(x, y);
      this.player.setRotation(0);
      this.localIdle();
    }
    this.cameraTargetX = x;
    this.cameraTargetY = y;
    this.cameras.main.centerOn(x, y);
  }

  // ------------------------------------------------------------------
  // Character system helpers (manifest/config driven)
  // ------------------------------------------------------------------

  /** Maps any incoming direction string onto a direction this def supports. */
  private dirForDef(def: WorldCharacterDef, direction: string): Direction8 {
    return def.directionRows[rowIndexFor(def, direction)];
  }

  private queueCharacterTextures(def: WorldCharacterDef) {
    for (const m of def.movements.values()) {
      if (this.textures.exists(m.textureKey)) continue;
      this.load.spritesheet(m.textureKey, m.url, {
        frameWidth: m.frameWidth,
        frameHeight: m.frameHeight,
      });
    }
  }

  /** Creates every movement × direction animation for a character (idempotent). */
  private ensureCharacterAnimations(def: WorldCharacterDef) {
    const LOOPING = new Set(['walk', 'run', 'idle']);
    for (const m of def.movements.values()) {
      for (const dir of def.directionRows) {
        const key = animKeyFor(def.id, m.movement, dir);
        if (this.anims.exists(key)) continue;
        if (!this.textures.exists(m.textureKey)) continue;
        const start = firstFrameIndexFor(def, m, dir);
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(m.textureKey, { start, end: start + m.columns - 1 }),
          frameRate: 12,
          repeat: LOOPING.has(m.movement) ? -1 : 0,
        });
      }
    }
  }

  /** Loads a character's spritesheets on demand (for switch + remote players). */
  private ensureCharacterLoaded(def: WorldCharacterDef): Promise<void> {
    const missing = [...def.movements.values()].filter((m) => !this.textures.exists(m.textureKey));
    if (missing.length === 0) {
      this.ensureCharacterAnimations(def);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      for (const m of missing) {
        this.load.spritesheet(m.textureKey, m.url, {
          frameWidth: m.frameWidth,
          frameHeight: m.frameHeight,
        });
      }
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.ensureCharacterAnimations(def);
        resolve();
      });
      this.load.start();
    });
  }

  /** Local player: play looping idle animation or freeze on the walk row's first frame. */
  private localIdle(direction: Direction8 = this.currentDirection) {
    if (Date.now() < this.deadUntil) return; // death pose owns the sprite
    const def = this.localDef;
    if (!def || !this.player) return;
    if (this.attackingUntil > 0 || this.hurtUntil > 0) return;
    const dir = this.dirForDef(def, direction);
    if (def.movements.has('idle')) {
      this.player.anims.play(animKeyFor(def.id, 'idle', dir), true);
      this.player.anims.timeScale = 1;
      return;
    }
    const walk = movementOrFallback(def, 'walk');
    if (!walk) return;
    this.player.anims.stop();
    if (this.player.texture.key !== walk.textureKey) this.player.setTexture(walk.textureKey);
    this.player.setFrame(firstFrameIndexFor(def, walk, dir));
  }

  /** Local player: walking animation with speed-scaled playback. */
  private localWalk(direction: Direction8, timeScale: number) {
    if (Date.now() < this.deadUntil) return; // death pose owns the sprite
    const def = this.localDef;
    if (!def || !this.player) return;
    if (this.attackingUntil > 0 || this.hurtUntil > 0) return;
    const walk = movementOrFallback(def, 'walk');
    if (!walk) return;
    this.player.anims.play(animKeyFor(def.id, walk.movement, this.dirForDef(def, direction)), true);
    this.player.anims.timeScale = timeScale;
  }

  /** Restores the local player's walking texture + idle frame (no idle anim). */
  private restoreLocalWalkTexture() {
    const def = this.localDef;
    if (!def || !this.player) return;
    const walk = movementOrFallback(def, 'walk');
    if (!walk || !this.textures.exists(walk.textureKey)) return;
    this.player.anims.stop();
    if (this.player.texture.key !== walk.textureKey) this.player.setTexture(walk.textureKey);
    this.player.setFrame(firstFrameIndexFor(def, walk, this.dirForDef(def, this.currentDirection)));
  }

  /** Remote player idle pose (idle anim when the character has one). */
  private remoteIdle(remote: RemotePlayer) {
    const def = remote.def;
    if (def.movements.has('idle')) {
      const key = animKeyFor(def.id, 'idle', this.dirForDef(def, remote.direction));
      if (this.anims.exists(key)) {
        remote.sprite.anims.play(key, true);
        return;
      }
    }
    const walk = movementOrFallback(def, 'walk');
    if (!walk || !this.textures.exists(walk.textureKey)) return;
    remote.sprite.anims.stop();
    if (remote.sprite.texture.key !== walk.textureKey) remote.sprite.setTexture(walk.textureKey);
    remote.sprite.setFrame(firstFrameIndexFor(def, walk, this.dirForDef(def, remote.direction)));
  }

  /** Restores a remote player's own walking texture + idle frame. */
  private restoreRemoteWalkTexture(remote: RemotePlayer) {
    const def = remote.def;
    const walk = movementOrFallback(def, 'walk');
    if (!walk || !this.textures.exists(walk.textureKey)) return;
    remote.sprite.anims.stop();
    remote.sprite.setTexture(walk.textureKey);
    remote.sprite.setOrigin(def.originX, def.originY);
    remote.sprite.setFrame(firstFrameIndexFor(def, walk, this.dirForDef(def, remote.direction)));
  }

  /** Applies a (possibly not yet loaded) character to a remote player. */
  private applyCharacterToRemote(remote: RemotePlayer, characterId: string) {
    const def = getWorldCharacter(characterId);
    if (!def || def.id === remote.characterId) return;
    remote.characterId = def.id;
    this.ensureCharacterLoaded(def).then(() => {
      if (!remote.sprite.scene) return; // destroyed meanwhile
      if (remote.characterId !== def.id) return; // switched again meanwhile
      remote.def = def;
      remote.attackingUntil = 0;
      remote.hurtUntil = 0;
      remote.deadUntil = 0;
      // HP is server-authoritative and re-synced on switch; redraw with the
      // new character's proportions right away.
      this.drawHpBar(remote.hpBar, remote.hp, remote.maxHp);
      if (!remote.seated) this.restoreRemoteWalkTexture(remote);
    });
  }

  // ------------------------------------------------------------------
  // Aparência composta (personagem do jogador)
  // ------------------------------------------------------------------

  /** True depois que create() montou o mundo (player + corpo físico). */
  public isWorldReady(): boolean {
    return !!this.player && !!this.playerBody;
  }

  /** Monta a folha composta de um remote e o adiciona à cena (assíncrono). */
  private async addAppearanceRemote(
    sessionId: string,
    p: { id: string; username: string; rating: number; x: number; y: number; direction: string; isMoving: boolean; hp?: number; maxHp?: number; appearance?: string; equippedWeapon?: string },
  ): Promise<void> {
    const appearanceRaw = p.appearance ?? '';
    const weaponRef = p.equippedWeapon || null;
    const defId = composedDefIdFor(appearanceRaw, weaponRef);
    if (!defId) return;
    this.pendingAppearanceAdds.set(sessionId, defId);
    const def = await ensureAppearanceDef(this, appearanceRaw, weaponRef);
    // Só adiciona se: ainda somos o pedido mais recente (saída do jogador ou
    // receita mais nova removem/trocam o stamp), o build deu certo e a cena
    // continua viva.
    if (this.pendingAppearanceAdds.get(sessionId) !== defId) return;
    this.pendingAppearanceAdds.delete(sessionId);
    if (!def || !this.player?.scene || this.otherPlayers.has(sessionId)) return;
    this.addRemotePlayer(sessionId, { ...p, characterId: def.id });
    const remote = this.otherPlayers.get(sessionId);
    if (remote) {
      remote.appearanceRaw = appearanceRaw;
      remote.equippedWeaponRef = p.equippedWeapon ?? '';
    }
  }

  /**
   * Defs compostos ainda necessários: local (atual E alvo em transição),
   * remotes (atual E alvo) e composições pendentes. Ids não-runtime na
   * lista são inofensivos — a coleta só olha defs `pc-`.
   */
  private composedDefsInUse(): Set<string> {
    const inUse = new Set<string>();
    const add = (id: string | null | undefined) => {
      if (id) inUse.add(id);
    };
    add(this.localDef?.id);
    add(this.localAppearanceTargetId);
    for (const remote of this.otherPlayers.values()) {
      add(remote.characterId);
      if (remote.appearanceRaw) {
        add(composedDefIdFor(remote.appearanceRaw, remote.equippedWeaponRef || null));
      }
    }
    for (const defId of this.pendingAppearanceAdds.values()) inUse.add(defId);
    return inUse;
  }

  /** Re-compõe a aparência/arma de um remote existente (equipar em tempo real). */
  private applyAppearanceToRemote(remote: RemotePlayer, appearanceRaw: string, weaponRef: string): void {
    // Escreve os alvos ANTES do build: se o estado mudar de novo no meio,
    // a comparação abaixo invalida este build (última escrita vence).
    remote.appearanceRaw = appearanceRaw;
    remote.equippedWeaponRef = weaponRef;
    void ensureAppearanceDef(this, appearanceRaw, weaponRef || null).then((def) => {
      if (!def || !remote.sprite.scene) return;
      if (remote.appearanceRaw !== appearanceRaw || remote.equippedWeaponRef !== weaponRef) return;
      if (remote.def.id === def.id) return; // nada mudou de verdade
      remote.characterId = def.id;
      remote.def = def;
      remote.attackingUntil = 0;
      remote.hurtUntil = 0;
      // Morto: mantém a pose de caído; o update loop restaura depois.
      if (!remote.seated && Date.now() >= remote.deadUntil) this.restoreRemoteWalkTexture(remote);
      // Coleta o def anterior deste remote (ninguém mais pode estar usando).
      pruneComposedAppearances(this, this.composedDefsInUse());
    });
  }

  /**
   * Aplica a aparência composta ao jogador LOCAL (login, criação, equipar).
   * Modelado no switchCharacter, sem as travas de dev: primeira aplicação
   * revela o sprite (createPlayer nasce invisível).
   */
  public async setLocalAppearance(appearanceRaw: string, weaponRef: string | null): Promise<boolean> {
    const seq = ++this.localAppearanceSeq;
    // Arma equipada → perfil de hitbox do Character Rig Controller (golpes de
    // coleta + debug). Carrega em paralelo com a composição da textura.
    this.localWeaponRef = weaponRef ?? '';
    this.ensureRigWeaponData(weaponRef ?? '');
    void this.ensureShootData(weaponRef ?? '');
    // Marca o alvo ANTES do await: um prune disparado no meio (saída de
    // remote etc.) não pode coletar o def que estamos construindo.
    this.localAppearanceTargetId = composedDefIdFor(appearanceRaw, weaponRef);
    const def = await ensureAppearanceDef(this, appearanceRaw, weaponRef);
    if (!def) return false;
    if (seq !== this.localAppearanceSeq) return false; // chamada mais nova venceu
    if (!this.player || !this.playerBody || !this.player.scene) return false;
    if (def.id === this.localDef?.id) {
      this.player.setVisible(true); // idempotente
      return true;
    }

    const prev = this.localDef;
    this.localDef = def;

    // Corpo físico: recria só quando a colisão muda de verdade (defs
    // compostos usam o corpo padrão — na prática, na 1ª aplicação quando o
    // legado divergia) e nunca no meio de um assento (filtro especial ativo).
    if (
      !this.currentSeatInfo &&
      !this.seatTween &&
      (!prev ||
        prev.bodyRadius !== def.bodyRadius ||
        prev.bodyOffsetX !== def.bodyOffsetX ||
        prev.bodyOffsetY !== def.bodyOffsetY)
    ) {
      const spriteX = this.player.x;
      const spriteY = this.player.y;
      const feetOffsetX = Math.round(def.bodyOffsetX);
      const feetOffsetY = Math.round(def.bodyOffsetY);
      this.matter.world.remove(this.playerBody);
      this.playerBody = this.matter.add.circle(spriteX + feetOffsetX, spriteY + feetOffsetY, def.bodyRadius, {
        label: 'player',
        friction: 0,
        frictionAir: 0,
        frictionStatic: 0,
        restitution: 0,
      });
      this.matter.body.setInertia(this.playerBody, Infinity);
      this.savedCollisionFilter = null;
      this.playerFeetOffset = feetOffsetY;
      this.playerFeetOffsetX = feetOffsetX;
    }

    this.player.setOrigin(def.originX, def.originY);
    this.player.setVisible(true);
    // Fora de assento/morte, troca já para a pose parada da nova folha.
    if (!this.currentSeatInfo && !this.seatTween && Date.now() >= this.deadUntil) {
      this.restoreLocalWalkTexture();
      this.emitMovement(false);
    }
    console.log(`[WorldScene] Aparência aplicada -> ${def.id}`);
    // Coleta o def local anterior (troca de arma gera um def novo por hash).
    pruneComposedAppearances(this, this.composedDefsInUse());
    return true;
  }

  // ------------------------------------------------------------------
  // Combat (dev): attack intent + remote attack playback
  // ------------------------------------------------------------------

  /**
   * Teclado do jogador: direções (WASD por padrão), atacar (F) e interagir (E),
   * todas configuráveis em Configurações → Controles. Ouvintes DOM na janela
   * (o plugin de teclado do Phaser não expõe `code`); ignorados enquanto um
   * campo de texto tem foco, o menu de configurações está aberto ou a aba
   * Controles espera uma tecla.
   */
  private setupKeyboardControls() {
    this.keyboardControls?.destroy();
    this.keyboardControls = new KeyboardControls({
      target: window,
      document,
      getBindings: getKeyBindings,
      isBlocked: () => isTextInputFocused() || isCapturingKey() || useGameStore.getState().showSettings,
      onAction: (action) => {
        if (action === 'attack') this.tryAttack();
        else this.confirmProximityInteraction();
      },
    }).attach();
  }

  /** Plays the local attack animation and sends the attack INTENT to the server. */
  public tryAttack(): boolean {
    const def = this.localDef;
    if (!def || !this.player) return false;
    if (this.movementLocked || this.inMatch || this.currentSeatInfo || this.seatTween) return false;
    if (Date.now() < this.deadUntil) return false; // corpses don't swing
    // Mirror of the SERVER cooldown (anim duration + pad) plus a jitter
    // margin: anything sent earlier is silently dropped by the server, which
    // would show a local-only "ghost swing" that deals no damage.
    if (Date.now() < this.attackCooldownUntil) return false;
    // Arco equipado → DISPARO (knock-and-bow) em vez de golpe de mão.
    const shootData = this.localWeaponRef ? this.shootDataByRef.get(this.localWeaponRef) : undefined;
    if (shootData === undefined && this.localWeaponRef) void this.ensureShootData(this.localWeaponRef);
    if (shootData && def.movements.get('shoot')) return this.tryShoot(def, shootData);
    // Moving with a walk-attack sheet available → attack WHILE walking
    // (animation + server damage timeline use the walk-attack asset).
    const moving = !!this.target || this.keyboardMoving;
    const walkAttack = def.movements.get('walk-attack');
    const attackMv =
      (moving && walkAttack ? walkAttack : undefined) ??
      def.movements.get('attack') ??
      walkAttack ??
      def.movements.get('run-attack');
    if (!attackMv) {
      console.warn(`[WorldScene] ${def.id} has no attack movement`);
      return false;
    }
    this.attackLocksMovement = attackMv.movement === 'attack';
    if (this.attackLocksMovement) {
      // Stationary swing: stop and settle movement
      this.target = null;
      this.pathWaypoints = [];
      this.currentWaypointIndex = 0;
      this.finalDestination = null;
      this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    }

    const dir = this.dirForDef(def, this.currentDirection);
    this.attackingUntil = Date.now() + (attackMv.columns / 12) * 1000;
    this.attackCooldownUntil =
      this.attackingUntil + ATTACK_COOLDOWN_PAD_MS + ATTACK_COOLDOWN_CLIENT_MARGIN_MS;
    this.player.anims.timeScale = 1;
    this.player.anims.play(animKeyFor(def.id, attackMv.movement, dir));
    if (this.attackLocksMovement) this.emitMovement(false, dir);
    // Intent only — the server owns validation, timing and hit detection.
    this.attackSender?.({ type: 'attack', movement: attackMv.movement, direction: dir, characterId: def.id });
    // Novo golpe: no mundo de coleta, as hitboxes da ARMA (perfil autorado no
    // Character Rig Controller) são testadas frame a frame via
    // setPlayerSwingQuery — nada de caixa fixa no cliente.
    this.swingSeq += 1;
    return true;
  }

  /**
   * Disparo de arco: para, toca knock-and-bow e agenda a flecha para o FIM
   * da animação (soltar a corda). O servidor recebe o intent 'shoot' só para
   * cronometrar cooldown e avisar os outros clientes (flecha cosmética).
   */
  private tryShoot(def: WorldCharacterDef, data: ArrowShootData): boolean {
    const mv = def.movements.get('shoot');
    if (!mv || !this.player || !this.playerBody) return false;
    // Atirar é sempre parado (knock-and-bow não tem variante andando).
    this.attackLocksMovement = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    const dir = this.dirForDef(def, this.currentDirection);
    const durationMs = (mv.columns / 12) * 1000;
    this.attackingUntil = Date.now() + durationMs;
    this.attackCooldownUntil =
      this.attackingUntil + ATTACK_COOLDOWN_PAD_MS + ATTACK_COOLDOWN_CLIENT_MARGIN_MS;
    this.player.anims.timeScale = 1;
    this.player.anims.play(animKeyFor(def.id, mv.movement, dir));
    this.emitMovement(false, dir);
    this.attackSender?.({ type: 'attack', movement: 'shoot', direction: dir, characterId: def.id });
    const refAtShot = this.localWeaponRef;
    this.time.delayedCall(durationMs, () => {
      if (!this.player || !this.player.scene) return;
      if (Date.now() < this.deadUntil) return; // morreu no meio do gesto
      if (this.localWeaponRef !== refAtShot) return; // trocou/desequipou no meio
      this.spawnArrow(dir, data, false, this.player.x, this.player.y);
    });
    return true;
  }

  /** Cria a flecha no mundo (local = testa nós; cosmetic = só visual). */
  private spawnArrow(direction: string, data: ArrowShootData, cosmetic: boolean, px: number, py: number): void {
    if (!this.arrowProjectiles) this.arrowProjectiles = new ArrowProjectiles(this);
    const off = ARROW_SPAWN_OFFSET[direction] ?? ARROW_SPAWN_OFFSET.down;
    void this.arrowProjectiles.fire({
      sheetUrl: data.arrowSheetUrl,
      direction,
      startX: px + off.x,
      startY: py + off.y,
      rangePx: data.rangePx,
      hitbox: data.hitbox,
      damage: data.damage,
      cosmetic,
    });
  }

  /**
   * Resolve (uma vez por ref) os dados de DISPARO de uma arma: pareamento
   * arco↔flecha pelo group do manifest + config da variação no catálogo
   * público (dano/alcance/hitbox). null = arma comum (segue golpe melee).
   */
  private ensureShootData(ref: string): Promise<ArrowShootData | null> {
    if (!ref) return Promise.resolve(null);
    const cached = this.shootDataByRef.get(ref);
    if (cached !== undefined) return Promise.resolve(cached);
    const inflight = this.shootDataInflight.get(ref);
    if (inflight) return inflight;
    const p = (async (): Promise<ArrowShootData | null> => {
      try {
        const parsed = parseWeaponRef(ref);
        if (!parsed) {
          this.shootDataByRef.set(ref, null);
          return null;
        }
        const familyId = parsed.familyId;
        const variantId = parsed.variantId ?? 'default';
        const manifest = await getGeneratorManifest();
        const arrowFam = projectilePairedFamily(manifest, familyId);
        if (!arrowFam) {
          this.shootDataByRef.set(ref, null); // arma comum
          return null;
        }
        // Flecha do MESMO material; sem variação correspondente, a default.
        const arrowVariant = arrowFam.variants.find((v) => v.id === variantId) ?? null;
        // Dano/alcance/hitbox são autorados na FAMÍLIA DA FLECHA (o admin
        // salva lá, chaveado pelo material do arco) — nunca na do arco.
        const stats = await resolveWeaponShootStats(arrowFam.id, variantId);
        const data: ArrowShootData = {
          arrowSheetUrl: `${import.meta.env.BASE_URL}${(arrowVariant ?? arrowFam.default).url}`,
          rangePx: stats.rangePx,
          damage: stats.damage,
          hitbox: stats.hitbox,
        };
        this.shootDataByRef.set(ref, data);
        return data;
      } catch (e) {
        // Erro de rede: não cacheia — o próximo equipar/tiro tenta de novo.
        console.warn('[WorldScene] dados de disparo indisponíveis:', e instanceof Error ? e.message : e);
        return null;
      } finally {
        this.shootDataInflight.delete(ref);
      }
    })();
    this.shootDataInflight.set(ref, p);
    return p;
  }

  /** Plays another player's attack animation (server broadcast). */
  public playRemoteAttack(sessionId: string, movement: string, direction: string) {
    const remote = this.otherPlayers.get(sessionId);
    if (!remote || remote.seated) return;
    const def = remote.def;
    const mv =
      def.movements.get(movement) ??
      def.movements.get('attack') ??
      movementOrFallback(def, movement);
    if (!mv) return;
    const dir = this.dirForDef(def, direction);
    const key = animKeyFor(def.id, mv.movement, dir);
    if (!this.anims.exists(key)) return;
    remote.direction = dir;
    remote.attackingUntil = Date.now() + (mv.columns / 12) * 1000;
    remote.sprite.anims.timeScale = 1;
    remote.sprite.anims.play(key);

    // Disparo remoto: flecha cosmética ao fim da animação (nunca acerta nós).
    // O 1º tiro pode ainda estar resolvendo os dados — espera a promise em
    // vez de descartar o broadcast (a flecha nasce um instante depois).
    if (movement === 'shoot') {
      const ref = remote.equippedWeaponRef || '';
      if (!ref) return;
      this.time.delayedCall((mv.columns / 12) * 1000, () => {
        void this.ensureShootData(ref).then((data) => {
          if (!data) return; // arma comum ou dados indisponíveis
          const r = this.otherPlayers.get(sessionId);
          if (!r || !r.sprite.scene || r.seated) return;
          if ((r.equippedWeaponRef || '') !== ref) return; // trocou de arma
          this.spawnArrow(dir, data, true, r.container.x, r.container.y);
        });
      });
    }
  }

  /** Brief red flash on a hit player (sessionId null = local player). */
  public flashHitPlayer(sessionId: string | null) {
    const sprite = sessionId ? this.otherPlayers.get(sessionId)?.sprite : this.player;
    if (!sprite || !sprite.scene) return;
    // Phaser 4: fill-tint is set via setTint + setTintMode (setTintFill is a no-op)
    sprite.setTint(0xff4444);
    sprite.setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(140, () => {
      if (sprite.scene) {
        sprite.clearTint();
        sprite.setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
  }

  // ------------------------------------------------------------------
  // HP bars + hurt animation
  // ------------------------------------------------------------------

  /** Redraws an HP bar (centered on 0,0 of the graphics object). */
  private drawHpBar(gfx: Phaser.GameObjects.Graphics, hp: number, maxHp: number) {
    const pct = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
    gfx.clear();
    gfx.fillStyle(0x000000, 0.65);
    gfx.fillRect(-HP_BAR_WIDTH / 2 - 1, -HP_BAR_HEIGHT / 2 - 1, HP_BAR_WIDTH + 2, HP_BAR_HEIGHT + 2);
    const color = pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xeab308 : 0xef4444;
    gfx.fillStyle(color, 1);
    gfx.fillRect(-HP_BAR_WIDTH / 2, -HP_BAR_HEIGHT / 2, HP_BAR_WIDTH * pct, HP_BAR_HEIGHT);
  }

  /** Server-authoritative local HP (from the Colyseus player state). */
  public updateLocalHp(hp: number, maxHp: number) {
    const safeMax = typeof maxHp === 'number' && maxHp > 0 ? maxHp : this.localMaxHp;
    const safeHp = typeof hp === 'number' && Number.isFinite(hp) ? hp : this.localHp;
    if (safeHp === this.localHp && safeMax === this.localMaxHp && this.localHpBar) return;
    this.localHp = safeHp;
    this.localMaxHp = safeMax;
    if (this.localHpBar) this.drawHpBar(this.localHpBar, safeHp, safeMax);
  }

  /** Lazily creates + positions the local HP bar every frame (see update()). */
  private updateLocalHpBar() {
    if (!this.player || !this.player.scene) return;
    if (!this.localHpBar) {
      this.localHpBar = this.add.graphics().setDepth(100);
      this.drawHpBar(this.localHpBar, this.localHp, this.localMaxHp);
    }
    // TESTE: barra de HP visível apenas para o personagem de teste.
    const visible =
      this.localDef?.id === HP_BAR_TEST_CHARACTER && !this.currentSeatInfo && !this.inMatch;
    this.localHpBar.setVisible(!!visible);
    if (visible) this.localHpBar.setPosition(this.player.x, this.player.y + HP_BAR_OFFSET_Y);
  }

  /** Plays the 'hurt' animation on a confirmed hit (sessionId null = local). */
  public playHurt(sessionId: string | null) {
    const now = Date.now();
    if (sessionId === null) {
      const def = this.localDef;
      if (!def || !this.player) return;
      if (now < this.deadUntil) return; // death pose owns the sprite
      if (this.attackingUntil > now) return; // attack anim has priority
      const hurt = def.movements.get('hurt');
      if (!hurt) return; // no hurt sheet — red flash only
      const dir = this.dirForDef(def, this.currentDirection);
      const key = animKeyFor(def.id, hurt.movement, dir);
      if (!this.anims.exists(key)) return;
      this.hurtUntil = now + (hurt.columns / 12) * 1000;
      this.player.anims.timeScale = 1;
      this.player.anims.play(key);
      return;
    }
    const remote = this.otherPlayers.get(sessionId);
    if (!remote || remote.seated) return;
    if (now < remote.deadUntil) return; // death pose owns the sprite
    if (remote.attackingUntil > now) return; // attack anim has priority
    const hurt = remote.def.movements.get('hurt');
    if (!hurt) return;
    const dir = this.dirForDef(remote.def, remote.direction);
    const key = animKeyFor(remote.def.id, hurt.movement, dir);
    if (!this.anims.exists(key)) return;
    remote.hurtUntil = now + (hurt.columns / 12) * 1000;
    remote.sprite.anims.timeScale = 1;
    remote.sprite.anims.play(key);
  }

  /**
   * Death (server broadcast): plays the 'death' sheet, locks input/movement
   * and keeps the corpse pose until the server revives (sessionId null =
   * local player). deadUntil self-expires as a safety net if the revive
   * broadcast is lost.
   */
  public playDeath(sessionId: string | null, respawnMs: number) {
    const now = Date.now();
    const safeMs = Math.max(500, Math.min(30000, respawnMs || 3000));
    if (sessionId === null) {
      if (!this.player || !this.localDef) return;
      this.deadUntil = now + safeMs;
      this.attackingUntil = 0;
      this.attackLocksMovement = false;
      this.hurtUntil = 0;
      // Full stop: corpses don't finish their path.
      this.target = null;
      this.pathWaypoints = [];
      this.currentWaypointIndex = 0;
      this.finalDestination = null;
      this.holdStartedAt = 0;
      this.holdActive = false;
      if (this.playerBody) this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
      this.emitMovement(false);
      this.playDeathAnim(this.player, this.localDef, this.currentDirection);
      return;
    }
    const remote = this.otherPlayers.get(sessionId);
    if (!remote) return;
    remote.deadUntil = now + safeMs;
    remote.attackingUntil = 0;
    remote.hurtUntil = 0;
    // Seated players can't be hit server-side; if this ever fires anyway,
    // track the dead state but leave the seated pose alone.
    if (remote.seated) return;
    remote.isMoving = false;
    this.playDeathAnim(remote.sprite, remote.def, remote.direction);
  }

  /** Plays the 'death' sheet when it exists (non-looping → freezes on the last frame). */
  private playDeathAnim(sprite: Phaser.GameObjects.Sprite, def: WorldCharacterDef, direction: Direction8) {
    const death = def.movements.get('death');
    if (!death) return; // no death sheet — corpse keeps the current pose
    const dir = this.dirForDef(def, direction);
    const key = animKeyFor(def.id, death.movement, dir);
    if (!this.anims.exists(key)) return;
    sprite.anims.timeScale = 1;
    sprite.anims.play(key);
  }

  /** Server revived a player: release the death lock (sessionId null = local). */
  public revivePlayer(sessionId: string | null) {
    if (sessionId === null) {
      this.deadUntil = 0;
      if (this.player?.scene) this.localIdle();
      return;
    }
    const remote = this.otherPlayers.get(sessionId);
    if (!remote) return;
    remote.deadUntil = 0; // the update loop restores idle/walk next tick
  }

  // ------------------------------------------------------------------
  // Character switching (dev tool)
  // ------------------------------------------------------------------

  public getLocalCharacterId(): string | null {
    return this.localDef?.id ?? null;
  }

  public setAttackSender(sender: AttackSender | null) {
    this.attackSender = sender;
  }

  public setCharacterSetSender(sender: CharacterSetSender | null) {
    this.characterSetSender = sender;
  }

  /**
   * Swaps the local player to another character, preserving position.
   * Blocked while seated / in a match / locked. Rebuilds the physics body
   * with the new character's collision config and notifies the server.
   */
  public async switchCharacter(nextId: string): Promise<boolean> {
    const deny = (reason: string): false => {
      this.lastSwitchDenial = reason;
      console.warn(`[WorldScene] switchCharacter negado: ${reason}`);
      return false;
    };
    const blockReason = () =>
      `bloqueado: ${[
        this.movementLocked && 'movimento travado',
        this.inMatch && 'em partida',
        this.currentSeatInfo && 'sentado em um tabuleiro',
        this.seatTween && 'animação de assento em andamento',
      ]
        .filter(Boolean)
        .join(', ')}`;

    this.lastSwitchDenial = null;
    const def = getWorldCharacter(nextId);
    if (!def) return deny(`personagem "${nextId}" não existe no manifest`);
    if (!this.player || !this.playerBody) return deny('o mundo ainda está carregando');
    if (def.id === this.localDef?.id) return deny(`"${def.displayName}" já é o personagem ativo`);
    if (Date.now() < this.deadUntil) return deny('morto — aguarde o respawn');
    if (this.movementLocked || this.inMatch || this.currentSeatInfo || this.seatTween) return deny(blockReason());

    await this.ensureCharacterLoaded(def);
    if (!this.player.scene) return deny('a cena foi recriada durante o carregamento');
    // Re-check guards — the world may have changed while textures loaded
    if (this.movementLocked || this.inMatch || this.currentSeatInfo || this.seatTween) return deny(blockReason());

    // Stop movement
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    this.attackingUntil = 0;
    this.attackCooldownUntil = 0;
    this.hurtUntil = 0;
    this.deadUntil = 0;

    const spriteX = this.player.x;
    const spriteY = this.player.y;

    this.localDef = def;
    setSelectedCharacterId(def.id);

    // Rebuild the physics body with the new character's collision config
    const feetOffsetX = Math.round(def.bodyOffsetX);
    const feetOffsetY = Math.round(def.bodyOffsetY);
    this.matter.world.remove(this.playerBody);
    this.playerBody = this.matter.add.circle(spriteX + feetOffsetX, spriteY + feetOffsetY, def.bodyRadius, {
      label: 'player',
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
      restitution: 0,
    });
    this.matter.body.setInertia(this.playerBody, Infinity);
    this.savedCollisionFilter = null;
    this.playerFeetOffset = feetOffsetY;
    this.playerFeetOffsetX = feetOffsetX;

    this.player.setOrigin(def.originX, def.originY);
    this.restoreLocalWalkTexture();
    this.emitMovement(false);
    this.characterSetSender?.(def.id);
    console.log(`[WorldScene] Switched character -> ${def.id}`);
    return true;
  }

  // ------------------------------------------------------------------
  // Combat debug visuals
  // ------------------------------------------------------------------

  /**
   * Resolves which asset/direction/frame a sprite is showing right now.
   * Returns null when the sprite is on a foreign texture (sitting poses).
   */
  private currentSpriteCombatState(
    sprite: Phaser.GameObjects.Sprite,
    def: WorldCharacterDef,
    fallbackDirection: string,
  ): { assetKey: string; direction: string; frameInDir: number } | null {
    const anim = sprite.anims.currentAnim;
    if (anim && sprite.anims.isPlaying) {
      const parts = anim.key.split(':'); // char:<id>:<movement>:<direction>
      if (parts.length !== 4 || parts[0] !== 'char' || parts[1] !== def.id) return null;
      const m = def.movements.get(parts[2]);
      if (!m) return null;
      const globalIdx = parseInt(sprite.frame.name, 10);
      if (!Number.isFinite(globalIdx)) return null;
      const frameInDir = globalIdx - rowIndexFor(def, parts[3]) * m.columns;
      return { assetKey: m.assetKey, direction: parts[3], frameInDir: Math.max(0, frameInDir) };
    }
    // Frozen pose — only meaningful when the sprite sits on one of our sheets
    const walk = movementOrFallback(def, 'walk');
    if (!walk || sprite.texture.key !== walk.textureKey) return null;
    const dir = this.dirForDef(def, fallbackDirection);
    const globalIdx = parseInt(sprite.frame.name, 10);
    const frameInDir = Number.isFinite(globalIdx) ? globalIdx - rowIndexFor(def, dir) * walk.columns : 0;
    return { assetKey: walk.assetKey, direction: dir, frameInDir: Math.max(0, frameInDir) };
  }

  /**
   * Carrega (com cache) o rig do Character Rig Controller e o perfil de
   * hitbox da arma `ref` — as MESMAS caixas autoradas em /admin/rigs valem
   * no jogo (debug + golpes de coleta), em qualquer mapa.
   */
  private ensureRigWeaponData(ref: string): void {
    void (async () => {
      try {
        const rig = this.localRig ?? (await loadRigConfig());
        this.localRig = rig;
        if (!this.weaponProfilesByRef.has(ref)) {
          // Ref persistida (gen:weapon/... | gen:crafttools/...) → família →
          // perfil. Sem família (mão limpa/ref inválida) fica null: sem
          // perfil, sem golpe.
          const parsed = parseWeaponRef(ref);
          let profile: WeaponHitboxProfile | null = null;
          if (parsed) {
            // Arma de DISPARO (arco): o dano vem da flecha — sem perfil de
            // golpe, nem fallback do rig (evita debug/golpe melee enganoso).
            // Ferramentas (flat, sem `group`) nunca pareiam com flecha.
            const shooter = projectilePairedFamily(await getGeneratorManifest(), parsed.familyId) !== null;
            profile = shooter ? null : await resolveWeaponProfileForFamily(parsed.familyId, rig);
          }
          this.weaponProfilesByRef.set(ref, profile);
        }
        if (!this.gatherStatsByRef.has(ref)) {
          // Stats de coleta (Mundo de Coleta): ferramenta = tool.power/level
          // do admin + tipo (= familyId); arma comum = dano do level 1 e
          // nunca é ferramenta; mão limpa = soco (poder 1, nível 0, 'hand').
          const parsed = parseWeaponRef(ref);
          const stats: GatherToolStats = parsed
            ? await resolveGatherStats(parsed.category, parsed.familyId, parsed.variantId ?? 'default')
            : { power: 1, level: 0, kind: 'hand' };
          this.gatherStatsByRef.set(ref, { ...stats, power: Math.max(1, Math.round(stats.power)) });
        }
      } catch (e) {
        console.warn('[WorldScene] rig/perfil de arma indisponível:', e instanceof Error ? e.message : e);
      }
    })();
  }

  /** Perfil já resolvido para uma ref de arma; dispara o fetch na 1ª consulta. */
  private weaponProfileFor(ref: string | null | undefined): WeaponHitboxProfile | null {
    const key = ref ?? '';
    const cached = this.weaponProfilesByRef.get(key);
    if (cached !== undefined) return cached;
    this.ensureRigWeaponData(key); // popula o cache; até lá, sem hitboxes
    return null;
  }

  /**
   * Frame que um sprite COMPOSTO (def `pc-<hash>`) mostra agora, em termos do
   * rig: movimento, direção (linha do pack) e COLUNA da folha (elo com o rig).
   */
  private composedSpriteState(
    sprite: Phaser.GameObjects.Sprite,
    def: WorldCharacterDef,
    fallbackDirection: string,
  ): { movement: string; direction: string; column: number; playing: boolean } | null {
    if (!def.id.startsWith(RUNTIME_CHARACTER_PREFIX)) return null;
    // Texturas estrangeiras (poses sentadas) não têm frames da folha composta.
    const composedTex = def.movements.get('walk')?.textureKey;
    if (!composedTex || sprite.texture.key !== composedTex) return null;
    const column = composedFrameColumn(sprite.frame.name);
    if (column === null) return null;
    const anim = sprite.anims.currentAnim;
    if (anim && sprite.anims.isPlaying) {
      const parts = anim.key.split(':'); // char:<defId>:<movement>:<direction>
      if (parts.length !== 4 || parts[0] !== 'char' || parts[1] !== def.id) return null;
      return { movement: parts[2], direction: parts[3], column, playing: true };
    }
    // Pose congelada: morto mostra a coluna 22; qualquer outra é parada.
    const movement = column === COMPOSED_SHEET.deadFrame ? 'death' : 'idle';
    return { movement, direction: this.dirForDef(def, fallbackDirection), column, playing: false };
  }

  /** Caixa do SOCO (mão limpa) por direção, relativa ao pé do jogador. */
  private readonly bareHandSwingRects: Record<RigDirection, LocalRectangle> = {
    south: { id: 'hand-south', x: -14, y: -6, width: 28, height: 26 },
    north: { id: 'hand-north', x: -14, y: -36, width: 28, height: 26 },
    east: { id: 'hand-east', x: 4, y: -28, width: 26, height: 26 },
    west: { id: 'hand-west', x: -30, y: -28, width: 26, height: 26 },
  };

  /**
   * Hitboxes de MUNDO do golpe local em andamento — direto do perfil da arma
   * equipada (Character Rig Controller). Fora de golpe, sem perfil ou frame
   * sem caixa autorada → null/vazio. Exceção: MÃO LIMPA (sem ref) usa uma
   * caixa curta fixa à frente do jogador — soco coleta recursos "de mão".
   */
  private currentSwingState(): {
    swingId: number;
    playerX: number;
    playerY: number;
    rects: Phaser.Geom.Rectangle[];
    power: number;
    toolKind: GatherToolKind | null;
    toolLevel: number;
    toolRef: string;
  } | null {
    if (!this.player || !this.localDef) return null;
    if (Date.now() >= this.attackingUntil) return null;
    const ref = this.localWeaponRef ?? '';
    const isBareHand = ref === '';
    const rig = this.localRig;
    const profile = this.weaponProfileFor(this.localWeaponRef);
    // Arma/ferramenta SEM perfil de golpe (ex.: arco) segue sem swing melee.
    if (!isBareHand && (!rig || !profile)) return null;
    const st = this.composedSpriteState(this.player, this.localDef, this.currentDirection);
    if (!st || !st.playing || st.movement !== 'attack') return null;
    const rigDir = RIG_DIRECTION_BY_ROW[st.direction];
    if (!rigDir) return null;
    const locals =
      !isBareHand && rig && profile
        ? weaponHitboxRectsFor(rig, profile, rigDir, st.column)
        : [this.bareHandSwingRects[rigDir]];
    const rects = locals.map((r) => {
      const w = localRectToWorldRect(r, this.player.x, this.player.y);
      return new Phaser.Geom.Rectangle(w.x, w.y, w.width, w.height);
    });
    const stats =
      this.gatherStatsByRef.get(ref) ??
      ({ power: 1, level: 0, kind: isBareHand ? 'hand' : null } satisfies GatherToolStats);
    return {
      swingId: this.swingSeq,
      playerX: this.player.x,
      playerY: this.player.y,
      rects,
      power: stats.power,
      toolKind: stats.kind,
      toolLevel: stats.level,
      toolRef: ref,
    };
  }

  private drawCombatDebug() {
    let labelText = '';

    // Defs COMPOSTOS (pc-…): as caixas vêm do Character Rig Controller —
    // hurtboxes no rig, hitboxes no perfil da arma equipada. Vale em qualquer
    // mapa; frame sem caixa autorada simplesmente não desenha nada.
    const drawRigFor = (
      sprite: Phaser.GameObjects.Sprite,
      def: WorldCharacterDef,
      fallbackDirection: string,
      originWorldX: number,
      originWorldY: number,
      isLocal: boolean,
      weaponRef: string | null,
    ) => {
      const rig = this.localRig;
      if (!rig) return;
      const st = this.composedSpriteState(sprite, def, fallbackDirection);
      if (!st) return;
      const rigDir = RIG_DIRECTION_BY_ROW[st.direction];
      if (!rigDir) return;
      const profile = this.weaponProfileFor(weaponRef);
      const hurt = rigHurtboxRectsFor(rig, st.movement, rigDir, st.column);
      const hit = profile ? weaponHitboxRectsFor(rig, profile, rigDir, st.column) : [];
      this.debugGfx.lineStyle(1, 0x00ff66, 0.95); // lima = hurtbox (rig)
      for (const r of hurt) {
        const w = localRectToWorldRect(r, originWorldX, originWorldY);
        this.debugGfx.strokeRect(w.x, w.y, w.width, w.height);
      }
      this.debugGfx.lineStyle(1, 0xff00ff, 0.95); // magenta = hitbox (arma)
      for (const r of hit) {
        const w = localRectToWorldRect(r, originWorldX, originWorldY);
        this.debugGfx.strokeRect(w.x, w.y, w.width, w.height);
      }
      if (isLocal) {
        labelText = `rig ${st.movement} ${st.direction} c${st.column}${
          profile ? '' : ' — arma sem perfil de hitbox'
        }`;
      }
    };

    const drawFor = (
      sprite: Phaser.GameObjects.Sprite,
      def: WorldCharacterDef | null,
      fallbackDirection: string,
      originWorldX: number,
      originWorldY: number,
      isLocal: boolean,
      weaponRef: string | null,
    ) => {
      if (!def) return;
      // Sem config legada → def composto: caixas do Character Rig Controller.
      if (!def.combat) {
        drawRigFor(sprite, def, fallbackDirection, originWorldX, originWorldY, isLocal, weaponRef);
        return;
      }
      // Legado (character NN): config de combate própria do personagem.
      // Debug shows the SAVED boxes even when "Ativas no jogo" is off —
      // that flag gates gameplay damage (server side), not inspection.
      const combat = def.combat;
      const state = this.currentSpriteCombatState(sprite, def, fallbackDirection);
      if (!state) return;
      const hurt = getActiveHurtboxRects(combat, state.assetKey, state.direction, state.frameInDir);
      const hit = getActiveHitboxRects(combat, state.assetKey, state.direction, state.frameInDir);
      this.debugGfx.lineStyle(1, 0x00ff66, 0.95); // lime = hurtbox
      for (const r of hurt) {
        const w = localShapeToWorldCoordinates(r, originWorldX, originWorldY);
        this.debugGfx.strokeRect(w.x, w.y, w.width, w.height);
      }
      this.debugGfx.lineStyle(1, 0xff00ff, 0.95); // magenta = hitbox
      for (const r of hit) {
        const w = localShapeToWorldCoordinates(r, originWorldX, originWorldY);
        this.debugGfx.strokeRect(w.x, w.y, w.width, w.height);
      }
      if (isLocal) {
        labelText = `${state.assetKey.split('/')[0]} ${state.direction} #${state.frameInDir}${
          combat.combatBoxesEnabled ? '' : ' (caixas inativas)'
        }`;
      }
    };

    if (this.player && this.localDef) {
      drawFor(this.player, this.localDef, this.currentDirection, this.player.x, this.player.y, true, this.localWeaponRef);
    }
    this.otherPlayers.forEach((remote) => {
      if (remote.seated) return;
      drawFor(
        remote.sprite,
        remote.def,
        remote.direction,
        remote.container.x,
        remote.container.y,
        false,
        remote.equippedWeaponRef ?? null,
      );
    });

    // Hitboxes das flechas em voo (ciano).
    this.arrowProjectiles?.drawDebug(this.debugGfx);

    if (labelText) {
      if (!this.combatDebugLabel) {
        this.combatDebugLabel = this.add
          .text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#a5f3fc',
            backgroundColor: '#0f172acc',
          })
          .setDepth(9000)
          .setOrigin(0.5, 1);
      }
      this.combatDebugLabel
        .setVisible(true)
        .setPosition(this.player.x, this.player.y - 44)
        .setText(labelText);
    } else if (this.combatDebugLabel) {
      this.combatDebugLabel.setVisible(false);
    }
  }

  public setInventoryPickupSender(sender: ((dropId: string) => void) | null) {
    this.inventoryPickupSender = sender;
  }

  /** Called from Colyseus MapSchema handlers. It deliberately accepts plain
   * objects too, so cloud rooms that do not yet expose worldDrops stay safe. */
  public upsertWorldDrop(drop: { id?: string; itemKey: string; qty: number; x: number; y: number; expiresAt?: number }, mapKey?: string, thumb?: CraftThumb) {
    const id = drop.id ?? mapKey;
    if (!id) return;
    // Cena já destruída (troca de mapa/HMR) com listener do room ainda vivo: nada a desenhar.
    if (!this.sys?.displayList) return;
    this.removeWorldDrop(id);
    const container = this.add.container(drop.x, drop.y).setDepth(80);
    this.worldDrops.set(id, container);
    this.scheduleWorldDropWarning(id, container, drop.expiresAt);
    const bg = this.add.rectangle(0, 0, 24, 24, 0x17110b, 0.8).setStrokeStyle(1, 0xd69e3a).setInteractive({ useHandCursor: true });
    const label = this.add.text(0, -19, `${drop.qty}x`, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5);
    container.add([bg, label]);
    const icon = RESOURCE_DROP_ICONS[drop.itemKey];
    if (thumb && thumb.kind !== 'none') {
      this.addDropThumb(container, id, thumb);
    } else if (thumb?.kind === 'none') {
      container.add(this.add.text(0, 0, 'Item', { fontSize: '8px', color: '#f7d36a' }).setOrigin(0.5));
    } else
    if (icon) {
      const key = `world-drop:${drop.itemKey}`;
      const addIcon = () => {
        if (!this.textures.exists(key) || !container.active) return;
        const image = this.add.image(0, 0, key).setDisplaySize(20, 20);
        container.add(image);
      };
      if (this.textures.exists(key)) addIcon();
      else {
        this.load.image(key, encodeURI(icon));
        this.load.once(`filecomplete-image-${key}`, addIcon);
        if (!this.load.isLoading()) this.load.start();
      }
    } else container.add(this.add.text(0, 0, 'Item', { fontSize: '8px', color: '#f7d36a' }).setOrigin(0.5));
    bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); this.inventoryPickupSender?.(id); });
  }

  private addDropThumb(container: Phaser.GameObjects.Container, dropId: string, thumb: Exclude<CraftThumb, { kind: 'none' }>) {
    const url = thumb.url;
    const key = `drop-thumb:${url}:${thumb.kind === 'sheet96' ? thumb.col : thumb.kind === 'frame' ? `${thumb.frameWidth}x${thumb.frameHeight}` : 'image'}`;
    const add = () => {
      if (!container.active || this.worldDrops.get(dropId) !== container || !this.textures.exists(key)) return;
      container.add(this.add.image(0, 0, key).setDisplaySize(20, 20));
    };
    if (this.textures.exists(key)) { add(); return; }
    const fallback = () => {
      if (container.active && this.worldDrops.get(dropId) === container) container.add(this.add.text(0, 0, 'Item', { fontSize: '8px', color: '#f7d36a' }).setOrigin(0.5));
    };
    const image = new Image();
    image.onload = () => {
      if (this.textures.exists(key)) { add(); return; }
      const canvas = this.textures.createCanvas(key, 24, 24);
      if (!canvas) return;
      const ctx = canvas.context;
      ctx.imageSmoothingEnabled = false;
      const source = thumb.kind === 'sheet96'
        ? { x: thumb.col * 96, y: 0, w: 96, h: 96 }
        : thumb.kind === 'frame'
          ? { x: 0, y: 0, w: thumb.frameWidth, h: thumb.frameHeight }
          : { x: 0, y: 0, w: image.width, h: image.height };
      const scale = Math.min(20 / source.w, 20 / source.h);
      const w = source.w * scale; const h = source.h * scale;
      try {
        ctx.drawImage(image, source.x, source.y, source.w, source.h, (24 - w) / 2, (24 - h) / 2, w, h);
        canvas.refresh();
      } catch {
        // Imagem sem CORS "suja" o canvas e o WebGL recusa a textura: cai no rótulo.
        this.textures.remove(key);
        fallback();
        return;
      }
      add();
    };
    image.onerror = fallback;
    // Ícones de craft items vêm do Storage (outra origem): sem isto o canvas fica "tainted".
    image.crossOrigin = 'anonymous';
    image.src = url;
  }

  public removeWorldDrop(id: string) {
    this.worldDropWarnings.get(id)?.remove(false);
    this.worldDropWarnings.delete(id);
    const old = this.worldDrops.get(id);
    if (old) {
      this.tweens.killTweensOf(old);
      old.destroy();
    }
    this.worldDrops.delete(id);
  }

  /**
   * Nos últimos segundos antes de o servidor apagar o item, ele pisca. O
   * sumiço em si é sempre do servidor (onRemove); aqui é só aviso — com o
   * relógio do cliente, então um desvio de segundos só desloca o piscar.
   */
  private scheduleWorldDropWarning(id: string, container: Phaser.GameObjects.Container, expiresAt: number | undefined) {
    if (!expiresAt || !Number.isFinite(expiresAt)) return;
    const startIn = Math.max(0, expiresAt - Date.now() - WORLD_DROP_WARNING_MS);
    const blink = () => {
      this.worldDropWarnings.delete(id);
      if (!container.active || this.worldDrops.get(id) !== container) return;
      this.tweens.add({ targets: container, alpha: 0.25, duration: 220, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    };
    if (startIn === 0) { blink(); return; }
    this.worldDropWarnings.set(id, this.time.delayedCall(startIn, blink));
  }

  public clearWorldDrops() {
    for (const id of this.worldDrops.keys()) this.removeWorldDrop(id);
    this.setDropRadiusVisible(false);
    this.setDropMarker(null);
  }

  /** Posição do sprite do jogador local — a mesma referência que o servidor usa para o alcance. */
  public getPlayerSpritePosition(): { x: number; y: number } {
    if (this.player) return { x: this.player.x, y: this.player.y };
    return this.getPlayerPosition();
  }

  /** Espelha as estações portáteis posicionadas da sala (store → cena). */
  public syncPlacedStations(views: PlacedStationView[]) {
    this.placedStationLayer?.sync(views);
  }

  /** Fantasma do posicionamento (null = remove). */
  public setPlacementGhost(ghost: PlacementGhost | null) {
    this.placedStationLayer?.setGhost(ghost);
  }

  /**
   * Validação local do ponto de posicionamento (o servidor repete as regras
   * que consegue: distância, estações públicas/posicionadas, jogadores; as
   * paredes do mapa só existem aqui).
   */
  public validateStationPlacement(itemKey: string, x: number, y: number): { ok: boolean; reason?: string } {
    const def = placeableStationFor(itemKey);
    if (!def) return { ok: false, reason: 'Item não pode ser posicionado' };
    if (!this.craftingRuntime.active) return { ok: false, reason: 'Só pode ser posicionada no Mundo de Coleta' };
    const rect = placedStationRect(def, x, y);
    if (!this.pathfinder || this.pathfinder.isMapRectBlocked(rect)) return { ok: false, reason: 'Encosta em um obstáculo' };
    for (const pub of Object.values(PUBLIC_STATION_RECTS)) {
      if (rectsOverlap(rect, pub, PLACED_STATION_CLEARANCE)) return { ok: false, reason: 'Muito perto de uma estação pública' };
    }
    for (const other of this.placedStationRects) {
      if (rectsOverlap(rect, other, PLACED_STATION_CLEARANCE)) return { ok: false, reason: 'Muito perto de outra estação' };
    }
    if (this.player && pointInRect(this.player.x, this.player.y, rect)) return { ok: false, reason: 'Você está em cima do lugar' };
    for (const remote of this.otherPlayers.values()) {
      if (pointInRect(remote.container.x, remote.container.y, rect)) return { ok: false, reason: 'Tem um jogador nesse lugar' };
    }
    return { ok: true };
  }

  /** Anel tracejado com o alcance máximo do drop; acompanha o jogador no update(). */
  public setDropRadiusVisible(visible: boolean) {
    if (!visible) {
      this.dropRadiusRing?.destroy();
      this.dropRadiusRing = null;
      return;
    }
    if (this.dropRadiusRing || !this.player) return;
    const ring = this.add.graphics().setDepth(79);
    const radius = INVENTORY_DROP_MAX_DISTANCE;
    ring.fillStyle(0xf7d36a, 0.06);
    ring.fillCircle(0, 0, radius);
    ring.lineStyle(2, 0xf7d36a, 0.85);
    const segments = 48;
    for (let i = 0; i < segments; i += 2) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      ring.beginPath();
      ring.arc(0, 0, radius, a0, a1, false);
      ring.strokePath();
    }
    ring.setPosition(this.player.x, this.player.y);
    this.dropRadiusRing = ring;
  }

  public setDropMarker(point: { x: number; y: number } | null) {
    this.dropMarker?.destroy();
    this.dropMarker = null;
    if (!point) return;
    const marker = this.add.container(point.x, point.y).setDepth(81);
    const halo = this.add.circle(0, 0, 14, 0xf7d36a, 0.22).setStrokeStyle(2, 0xf7d36a, 0.95);
    const dot = this.add.circle(0, 0, 3, 0xfff3c4, 1);
    marker.add([halo, dot]);
    this.tweens.add({ targets: halo, scaleX: 1.35, scaleY: 1.35, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.dropMarker = marker;
  }
}
