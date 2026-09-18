/**
 * Hunting system — shared contract between server (WorldRoom/HuntingManager),
 * client (game + /admin/hunting) and the api-server mirror.
 *
 * Assets: public/assets/CraftingWorld/resources/hunting_animals/<category>/<animal>/<variant>.png
 *   - category ∈ hunts | residents; every PNG in one animal folder is a VARIANT of the
 *     same animal (same sheet layout, same rig; independent stats).
 *   - variantId = `<category>/<animal>/<file-without-ext>` (e.g. `hunts/bear/forest_bear_black`).
 *   - animalKey = `<category>/<animal>`; rigId = `animal-<category>-<animal>` (rig_configs row,
 *     RigConfig v2: rows south/west/east/north = 0..3, animations idle/walk/run/attack).
 * Sheet layout (all animal sheets): 12 columns × 8 rows of square frames; only rows 0..3 are used
 *   (S, W, E, N). Columns: idle 0-2, walk 3-5, run 6-8, attack 9-11; every animation loops 1-2-3-2.
 */

import { DEFAULT_MOTION, parseMotionConfig, type HuntingMotionConfig } from './HuntingMotion.js';

export const HUNTING_CONFIG_SCHEMA_VERSION = 1 as const;

export const HUNTING_CATEGORIES = ['hunts', 'residents'] as const;
export type HuntingCategory = (typeof HUNTING_CATEGORIES)[number];
export const HUNTING_CATEGORY_LABELS: Record<HuntingCategory, string> = { hunts: 'Caças (contratos)', residents: 'Residentes' };

export const ANIMAL_SHEET_COLUMNS = 12;
export const ANIMAL_SHEET_ROWS = 8;
export const ANIMAL_SHEET_USED_ROWS = 4;
export const ANIMAL_ANIMATIONS = ['idle', 'walk', 'run', 'attack'] as const;
export type AnimalAnimation = (typeof ANIMAL_ANIMATIONS)[number];
/** Sheet columns per animation (3 frames each). Playback is yoyo: 0-1-2-1-0-1-2… */
export const ANIMAL_ANIMATION_COLUMNS: Record<AnimalAnimation, number[]> = {
  idle: [0, 1, 2], walk: [3, 4, 5], run: [6, 7, 8], attack: [9, 10, 11],
};
/** Frames per second per animation — shared so the server attack timeline matches the client. */
export const ANIMAL_ANIMATION_FPS: Record<AnimalAnimation, number> = { idle: 4, walk: 8, run: 10, attack: 10 };
/** Local frame sequence of one yoyo attack cycle (indexes into ANIMAL_ANIMATION_COLUMNS.attack). */
export const ANIMAL_ATTACK_FRAME_SEQUENCE = [0, 1, 2, 1] as const;
export const ANIMAL_ATTACK_DURATION_MS = Math.round((ANIMAL_ATTACK_FRAME_SEQUENCE.length / ANIMAL_ANIMATION_FPS.attack) * 1000);
/** Local frames of the attack cycle in which the hitbox is applied (server) — the "bite" frames. */
export const ANIMAL_ATTACK_HIT_FRAMES = [2] as const;

/** Rows S/W/E/N — matches RIG_DIRECTION_NAMES order exactly. */
export const ANIMAL_DIRECTIONS = ['south', 'west', 'east', 'north'] as const;
export type AnimalDirection = (typeof ANIMAL_DIRECTIONS)[number];
export function animalDirectionFromVector(dx: number, dy: number): AnimalDirection {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'west' : 'east';
  return dy < 0 ? 'north' : 'south';
}

// ───────────────────────── Difficulty levels ─────────────────────────

export const HUNTING_LEVELS = ['easy', 'medium', 'moderate', 'hard'] as const;
export type HuntingLevel = (typeof HUNTING_LEVELS)[number];
export const HUNTING_LEVEL_LABELS: Record<HuntingLevel, string> = { easy: 'Fácil', medium: 'Médio', moderate: 'Moderado', hard: 'Difícil' };

/** Behaviour tuning of one level (speed lives per variant: `speedByLevel`). Editable in the admin (`HuntingConfig.levelProfiles`). */
export interface HuntingLevelProfile {
  /** How often the animal decides to attack when in range (0..1 per decision, decisions every 100 ms). */
  aggression: number;
  /** Delay between noticing a threat and reacting (ms). */
  reactionMs: number;
  /** Minimum time between two bites (ms). */
  attackCooldownMs: number;
  /** Chance to sidestep (leap sideways) when the player starts a swing nearby (0..1). */
  dodgeChance: number;
  /** Chance to circle/flank instead of charging straight (0..1). */
  flankChance: number;
  /** Retreats when hp/maxHp drops below this (0 = never retreats). */
  retreatHpRatio: number;
  /** Re-engages once hp/maxHp recovered to this ratio while retreating. */
  reengageHpRatio: number;
  /** Longest retreat (ms) — after this it re-attacks even without recovering. */
  retreatMaxMs: number;
  /** Fraction of maxHp recovered per second while retreating. */
  retreatHealPerSecond: number;
  /** Extra chase persistence multiplier applied to combatBreakDistance (1 = as configured). */
  persistence: number;
  /** Farther than this (px) from a standing target the animal RUNS; closer it stalks (walks). It always runs after a moving target. */
  runDistance: number;
  /** Shooters (`canShoot` variants): farthest distance (px) a shot travels — the AI only shoots targets inside it. */
  shootRange: number;
  /** Shooters: projectile speed (px/s). */
  shootSpeed: number;
  /** Shooters: minimum time between two shots (ms). */
  shootCooldownMs: number;
  /** Shooters: chance to shoot when the target is beyond bite range and inside shootRange (0..1 per decision, decisions every 100 ms). */
  shootChance: number;
}
export const LEVEL_PROFILE_FIELDS: readonly { key: keyof HuntingLevelProfile; label: string; hint: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: 'aggression', label: 'Agressividade', hint: 'Chance de morder quando está ao alcance (avaliada 10× por segundo)', min: 0, max: 1, step: 0.05 },
  { key: 'reactionMs', label: 'Tempo de reação', hint: 'Espera entre perceber o jogador e reagir', min: 0, max: 5000, step: 50, unit: 'ms' },
  { key: 'attackCooldownMs', label: 'Intervalo entre mordidas', hint: 'Tempo mínimo entre dois ataques', min: 300, max: 10000, step: 50, unit: 'ms' },
  { key: 'dodgeChance', label: 'Chance de esquiva', hint: 'Salta para o lado quando o jogador começa um golpe perto', min: 0, max: 1, step: 0.05 },
  { key: 'flankChance', label: 'Chance de flanquear', hint: 'Contorna o jogador em vez de atacar de frente', min: 0, max: 1, step: 0.05 },
  { key: 'retreatHpRatio', label: 'Recua abaixo de', hint: 'Fração do HP em que o animal foge (0 = nunca recua)', min: 0, max: 0.9, step: 0.05 },
  { key: 'reengageHpRatio', label: 'Volta a atacar com', hint: 'Fração do HP recuperada que encerra a fuga', min: 0, max: 1, step: 0.05 },
  { key: 'retreatMaxMs', label: 'Fuga máxima', hint: 'Depois desse tempo volta a atacar mesmo sem se recuperar', min: 500, max: 30000, step: 250, unit: 'ms' },
  { key: 'retreatHealPerSecond', label: 'Cura durante a fuga', hint: 'Fração do HP máximo recuperada por segundo enquanto foge', min: 0, max: 0.5, step: 0.01, unit: '/s' },
  { key: 'persistence', label: 'Persistência', hint: 'Multiplica a distância de combat break durante a perseguição', min: 0.5, max: 3, step: 0.1, unit: '×' },
  { key: 'runDistance', label: 'Corre a partir de', hint: 'Mais longe que isso de um alvo parado ele corre; mais perto, anda. Alvo em movimento: sempre corre', min: 0, max: 1000, step: 10, unit: 'px' },
  { key: 'shootRange', label: 'Alcance do tiro', hint: 'Só para animais que atiram: distância máxima que o projétil percorre (a IA só atira em alvos dentro dela)', min: 60, max: 1200, step: 10, unit: 'px' },
  { key: 'shootSpeed', label: 'Velocidade do tiro', hint: 'Velocidade do projétil', min: 60, max: 900, step: 10, unit: 'px/s' },
  { key: 'shootCooldownMs', label: 'Intervalo entre tiros', hint: 'Tempo mínimo entre dois tiros', min: 300, max: 15000, step: 50, unit: 'ms' },
  { key: 'shootChance', label: 'Chance de atirar', hint: 'Chance de atirar quando o alvo está fora do alcance da mordida e dentro do alcance do tiro (avaliada 10× por segundo)', min: 0, max: 1, step: 0.05 },
];
/** Defaults of each level — the admin can override every value (`HuntingConfig.levelProfiles`). */
export const HUNTING_LEVEL_PROFILES: Record<HuntingLevel, HuntingLevelProfile> = {
  easy:     { aggression: 0.5,  reactionMs: 800, attackCooldownMs: 1800, dodgeChance: 0.0,  flankChance: 0.0,  retreatHpRatio: 0.15, reengageHpRatio: 0.5,  retreatMaxMs: 5000, retreatHealPerSecond: 0.02, persistence: 1.0, runDistance: 160, shootRange: 180, shootSpeed: 200, shootCooldownMs: 2400, shootChance: 0.5 },
  medium:   { aggression: 0.75, reactionMs: 500, attackCooldownMs: 1400, dodgeChance: 0.15, flankChance: 0.15, retreatHpRatio: 0.2,  reengageHpRatio: 0.45, retreatMaxMs: 4000, retreatHealPerSecond: 0.02, persistence: 1.0, runDistance: 140, shootRange: 260, shootSpeed: 240, shootCooldownMs: 1900, shootChance: 0.65 },
  moderate: { aggression: 0.9,  reactionMs: 300, attackCooldownMs: 1000, dodgeChance: 0.3,  flankChance: 0.3,  retreatHpRatio: 0.25, reengageHpRatio: 0.4,  retreatMaxMs: 3500, retreatHealPerSecond: 0.03, persistence: 1.2, runDistance: 120, shootRange: 340, shootSpeed: 280, shootCooldownMs: 1500, shootChance: 0.8 },
  hard:     { aggression: 1.0,  reactionMs: 120, attackCooldownMs: 750,  dodgeChance: 0.5,  flankChance: 0.45, retreatHpRatio: 0.3,  reengageHpRatio: 0.4,  retreatMaxMs: 3000, retreatHealPerSecond: 0.04, persistence: 1.5, runDistance: 100, shootRange: 440, shootSpeed: 330, shootCooldownMs: 1100, shootChance: 0.95 },
};
export type HuntingLevelProfiles = Record<HuntingLevel, HuntingLevelProfile>;
export function defaultLevelProfiles(): HuntingLevelProfiles {
  return { easy: { ...HUNTING_LEVEL_PROFILES.easy }, medium: { ...HUNTING_LEVEL_PROFILES.medium }, moderate: { ...HUNTING_LEVEL_PROFILES.moderate }, hard: { ...HUNTING_LEVEL_PROFILES.hard } };
}
/** Suggested run speed (px/s) per level; wandering uses ANIMAL_WANDER_SPEED_FACTOR of it. */
export const DEFAULT_SPEED_BY_LEVEL: Record<HuntingLevel, number> = { easy: 70, medium: 95, moderate: 120, hard: 150 };
/** Wandering (walk) speed = run speed × this. */
export const ANIMAL_WANDER_SPEED_FACTOR = 0.55;
/** Stalking a standing target inside `runDistance` (walk) = run speed × this. */
export const ANIMAL_APPROACH_SPEED_FACTOR = 0.7;
/** Hunt animals (contract targets) notice players inside this radius (px). */
export const ANIMAL_HUNT_AGGRO_RADIUS = 260;
/** Contract animals alive at acceptance: this share of the quota (%). */
export const DEFAULT_CONTRACT_INITIAL_PERCENT = 20;
/** Contract animals spawned together once the previous ones are dead. */
export const DEFAULT_CONTRACT_REFILL_BATCH = 2;

export const HP_REGEN_OPTIONS = [0, 5, 10, 20, 30, 60] as const;
export type HpRegenSeconds = (typeof HP_REGEN_OPTIONS)[number];
export const HP_REGEN_LABELS: Record<HpRegenSeconds, string> = { 0: 'Instantâneo', 5: '5 s', 10: '10 s', 20: '20 s', 30: '30 s', 60: '1 min' };

export const RESIDENT_REACTIONS = ['attacked', 'radius'] as const;
export type ResidentReaction = (typeof RESIDENT_REACTIONS)[number];
export const RESIDENT_REACTION_LABELS: Record<ResidentReaction, string> = { attacked: 'Reage ao ser atacado', radius: 'Reage ao entrar no raio' };

/** 'fixed' spawns exactly `spawnCount`; 'random' rolls once per room between `spawnMin` and `spawnMax` (inclusive). */
export type SpawnMode = 'fixed' | 'random';

// ───────────────────────── Config document ─────────────────────────

export interface AnimalVariantConfig {
  /** Display name shown above the animal. */
  name: string;
  hp: number;
  /** Damage dealt to the player's HP per bite. */
  damage: number;
  xpEnabled: boolean;
  /** Hunting-skill XP granted per kill (when xpEnabled). */
  xp: number;
  level: HuntingLevel;
  /** Run speed px/s per level (editable suggestions). */
  speedByLevel: Record<HuntingLevel, number>;
  spawnMode: SpawnMode;
  /** Ambient population (spawnMode 'fixed'). Anchors are only spawn points: counts above the anchor total reuse random anchors. */
  spawnCount: number;
  /** Random population range (spawnMode 'random'), rolled once per room. */
  spawnMin: number;
  spawnMax: number;
  /** Distance (px) between animal and its target that ends the fight. */
  combatBreakDistance: number;
  hpRegenSeconds: HpRegenSeconds;
  /** Also shoots a projectile (same `damage` as the bite) when the target is out of bite range — range/speed/cadence come from the level profile. */
  canShoot: boolean;
  // residents only (ignored for hunts):
  reaction: ResidentReaction;
  /** Aggro radius in px (reaction 'radius'). */
  radius: number;
  /** Seconds until a killed resident respawns at any resident anchor. */
  respawnCooldownSeconds: number;
}

export interface HuntingContractConfig {
  id: string;
  variantId: string;
  quantity: number;
  timeLimitMinutes: number;
  xpReward: number;
  crownsReward: number;
  /**
   * Hours until the contract is offered again after it is COMPLETED (reward claimed). Failing it
   * (deadline, abandon, death) never locks it: the player simply accepts it again at the NPC.
   */
  cooldownHours: number;
  /** Share (%) of the quota alive right after the contract is accepted (at least 1 animal). */
  initialPercent: number;
  /** Animals spawned together (at random other spots) once every spawned one is dead, until the quota is reached. */
  refillBatch: number;
  /** Visible in game. */
  enabled: boolean;
}

export interface HuntingGeneralConfig {
  /** Damage dealt with bare hands (no main weapon). */
  handDamage: number;
  /** Seconds until an ambient hunt animal respawns after being killed. */
  huntsRespawnSeconds: number;
  /** Max distance (px) from the NPC at which contracts can be accepted/claimed. */
  npcInteractRadius: number;
  /** Master switch — when false no animals/NPC are spawned. */
  enabled: boolean;
}

export interface HuntingConfig {
  schemaVersion: typeof HUNTING_CONFIG_SCHEMA_VERSION;
  general: HuntingGeneralConfig;
  /** variantId → config. Unknown variants (asset removed) are kept but ignored at runtime. */
  variants: Record<string, AnimalVariantConfig>;
  contracts: HuntingContractConfig[];
  /** Behaviour (AI) tuning per difficulty level — defaults in HUNTING_LEVEL_PROFILES. */
  levelProfiles: HuntingLevelProfiles;
  /** The run leap (distance, duration, pause) shared by every animal — configured in /dev/caca, see HuntingMotion. */
  motion: HuntingMotionConfig;
}

export const HUNTING_LIMITS = {
  hp: { min: 1, max: 100000 }, damage: { min: 0, max: 10000 }, xp: { min: 0, max: 1000000 },
  speed: { min: 10, max: 600 }, spawnCount: { min: 0, max: 200 }, combatBreak: { min: 50, max: 4000 },
  radius: { min: 16, max: 2000 }, respawn: { min: 0, max: 86400 }, quantity: { min: 1, max: 200 },
  timeLimit: { min: 1, max: 1440 }, crowns: { min: 0, max: 1000000 }, cooldownHours: { min: 0, max: 720 },
  initialPercent: { min: 1, max: 100 }, refillBatch: { min: 1, max: 200 },
  contracts: 200, nameLength: 40,
} as const;

export function defaultVariantConfig(name = 'Animal'): AnimalVariantConfig {
  return {
    name, hp: 60, damage: 8, xpEnabled: true, xp: 15, level: 'medium',
    speedByLevel: { ...DEFAULT_SPEED_BY_LEVEL }, spawnMode: 'fixed', spawnCount: 0, spawnMin: 1, spawnMax: 4,
    combatBreakDistance: 420, hpRegenSeconds: 10, canShoot: false,
    reaction: 'attacked', radius: 160, respawnCooldownSeconds: 60,
  };
}
export function defaultHuntingConfig(): HuntingConfig {
  return {
    schemaVersion: HUNTING_CONFIG_SCHEMA_VERSION,
    general: { handDamage: 5, huntsRespawnSeconds: 120, npcInteractRadius: 220, enabled: true },
    variants: {},
    contracts: [],
    levelProfiles: defaultLevelProfiles(),
    motion: { ...DEFAULT_MOTION },
  };
}

// ───────────────────────── Ids & assets ─────────────────────────

export const VARIANT_ID_RE = /^(hunts|residents)\/([a-z0-9][a-z0-9_-]{0,40})\/([a-z0-9][a-z0-9_ .-]{0,60})$/i;
export interface ParsedVariantId { category: HuntingCategory; animal: string; variant: string; animalKey: string }
export function parseVariantId(id: string): ParsedVariantId | null {
  const m = VARIANT_ID_RE.exec(id);
  if (!m) return null;
  const category = m[1].toLowerCase() as HuntingCategory;
  return { category, animal: m[2], variant: m[3], animalKey: `${category}/${m[2]}` };
}
export function isVariantId(v: unknown): v is string { return typeof v === 'string' && VARIANT_ID_RE.test(v); }
/** rig_configs row id shared by every variant of an animal. */
export function rigIdForAnimal(category: HuntingCategory, animal: string): string {
  const slug = animal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  return `animal-${category}-${slug}`;
}
/** Animal that never wanders: spawns at monster_tree anchors and only moves once attacked. */
export const MONSTER_TREE_ANIMAL_KEY = 'residents/tree';
export const HUNTING_ASSET_ROOT = 'assets/CraftingWorld/resources/hunting_animals';
export const NPC_ASSET_ROOT = 'assets/CraftingWorld/resources/npcs';
export const HUNTING_MANIFEST_PATH = `${HUNTING_ASSET_ROOT}/manifest.json`;
/** Sheet URL relative to the app base (prepend import.meta.env.BASE_URL on the client). */
export function animalSheetPath(variantId: string): string { return `${HUNTING_ASSET_ROOT}/${variantId}.png`; }

/** Served by the Vite plugin (dev route + emitted on build) at HUNTING_MANIFEST_PATH. */
export interface HuntingManifestVariant { variantId: string; file: string; url: string; width: number; height: number; frameWidth: number; frameHeight: number }
export interface HuntingManifestAnimal { animalKey: string; category: HuntingCategory; animal: string; rigId: string; variants: HuntingManifestVariant[] }
export interface HuntingManifest { generatedAt: string; animals: HuntingManifestAnimal[] }

/** Defaults used while an animal has no saved rig (origin-relative frame px, like RigConfig). */
export const ANIMAL_DEFAULT_ORIGIN = { x: 0.5, y: 0.8 } as const;
export const ANIMAL_DEFAULT_HURTBOX = { x: -24, y: -48, width: 48, height: 48 } as const;
export const ANIMAL_DEFAULT_HITBOX = { x: -32, y: -44, width: 64, height: 52 } as const;
export const ANIMAL_DEFAULT_COLLISION_RADIUS = 12;
/** Distance (px, center to center) at which an animal considers the player "in bite range". */
export const ANIMAL_BITE_RANGE = 44;
/** Shooters: a shot hits a player when its ground point passes within this radius (px) of the player's hurtbox. */
export const ANIMAL_SHOT_RADIUS = 10;
/** Shooters: the shot leaves the animal this far (px) ahead of its centre, so it never spawns inside its own sprite. */
export const ANIMAL_SHOT_MUZZLE_PX = 14;

/**
 * Room state schema (server/src/schemas, synced to the client):
 *  AnimalState { id, variantId, name, x, y, dir (index into ANIMAL_DIRECTIONS), anim (AnimalAnimation),
 *                hp, maxHp, level (HuntingLevel), dead (boolean), contractOwner (user id or ''),
 *                frame (local run frame 0..2 picked by the server each tick — see HuntingMotion) }
 *  NpcState    { id (NPC_BARBARIAN_ID), x, y, dir (index into NPC_DIRECTION_ORDER), isMoving }
 * WorldState gets `animals: MapSchema<AnimalState>` and `npcs: MapSchema<NpcState>` (craft:* rooms only).
 */
// ───────────────────────── NPC ─────────────────────────

export const NPC_BARBARIAN_ID = 'barbarian';
/** Barbarian sheets are 64×64 px per frame (2× pixel art: idle 256×256, walk 384×256). */
export const NPC_FRAME_SIZE = 64;
/** Barbarian sheets: rows S, N, W, E (different from animals!). idle 4 cols, walk 6 cols. */
export const NPC_DIRECTION_ROWS = { south: 0, north: 1, west: 2, east: 3 } as const;
export type NpcDirection = keyof typeof NPC_DIRECTION_ROWS;
export const NPC_SHEETS = {
  idle: { file: 'barbarian/barbarian_idle.png', columns: 4, fps: 4 },
  walk: { file: 'barbarian/barbarian_walk.png', columns: 6, fps: 8 },
} as const;
/** Index order used by NpcState.dir (0..3) — NOT the same order as animals. */
export const NPC_DIRECTION_ORDER = ['south', 'north', 'west', 'east'] as const;
export const NPC_WALK_SPEED = 45;
/** How long the NPC stands still facing south after a player talks to him (ms). */
export const NPC_TALK_HOLD_MS = 8000;

// ───────────────────────── Room protocol ─────────────────────────

export const HUNT_MSG = {
  /** client → server: player clicked the NPC. Reply: HUNT_MSG.contracts. */
  npcTalk: 'hunt_npc_talk',
  accept: 'hunt_contract_accept',      // { requestId, contractId }
  claim: 'hunt_contract_claim',        // { requestId }
  abandon: 'hunt_contract_abandon',    // { requestId }
  arrowHit: 'hunt_arrow_hit',          // { requestId, animalId } — client-detected arrow hit, validated by last swing
  /** server → client */
  contracts: 'hunt_contracts',         // HuntContractsPayload
  state: 'hunt_state',                 // HuntStatePayload (active contract of THIS player)
  event: 'hunt_event',                 // HuntEventPayload
  animalHit: 'animal_hit',             // broadcast { animalId, damage, hp, bySessionId }
  requestResult: 'hunt_request_result',// { requestId, ok, error? }
  shot: 'hunt_shot',                   // broadcast HuntShotPayload — an animal fired a projectile
  shotHit: 'hunt_shot_hit',            // broadcast HuntShotHitPayload — the projectile hit a player (remove it early)
} as const;

/**
 * Animal projectile. The server simulates it (ground-level straight line at `speed` px/s from
 * (x, y) along the unit vector (dx, dy), at most `range` px — already cut at the first wall) and the
 * client only replays the same line from the message, so no per-frame network traffic is needed.
 */
export interface HuntShotPayload { id: string; animalId: string; x: number; y: number; dx: number; dy: number; speed: number; range: number }
export interface HuntShotHitPayload { id: string; x: number; y: number; targetSessionId: string }

export type ContractAvailability = 'available' | 'active' | 'locked' | 'busy';
export interface HuntContractView {
  id: string; variantId: string; animalName: string; quantity: number; timeLimitMinutes: number;
  xpReward: number; crownsReward: number; cooldownHours: number;
  availability: ContractAvailability;
  /** Epoch ms when the lock ends (availability 'locked'). */
  lockedUntil?: number;
}
export interface ActiveContractView {
  contractId: string; variantId: string; animalName: string; quantity: number; killed: number;
  acceptedAt: number; deadline: number; xpReward: number; crownsReward: number;
  /** All animals killed — ready to claim at the NPC. */
  complete: boolean;
}
export interface HuntContractsPayload { now: number; contracts: HuntContractView[]; active: ActiveContractView | null; tableMissing?: boolean }
export interface HuntStatePayload { active: ActiveContractView | null; now: number }
export type HuntEventType = 'progress' | 'completed' | 'claimed' | 'expired' | 'cancelled_death' | 'abandoned' | 'kill';
export interface HuntEventPayload { type: HuntEventType; message: string; killed?: number; quantity?: number; xp?: number; crowns?: number; animalName?: string }

/** Persisted per-player row (`player_hunting`). */
export interface PlayerHuntingActive { contractId: string; variantId: string; quantity: number; killed: number; acceptedAt: number; deadline: number; region: string }
export interface PlayerHuntingRecord { active: PlayerHuntingActive | null; locks: Record<string, number> }

// ───────────────────────── Parsing / normalization ─────────────────────────

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, min: number, max: number, int = true): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  const c = Math.min(max, Math.max(min, n));
  return int ? Math.round(c) : c;
};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || d : d);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : d);

export function parseVariantConfig(raw: unknown, fallbackName = 'Animal'): AnimalVariantConfig {
  const d = defaultVariantConfig(fallbackName);
  if (!isRec(raw)) return d;
  const speeds = isRec(raw.speedByLevel) ? raw.speedByLevel : {};
  const speedByLevel = {} as Record<HuntingLevel, number>;
  for (const lvl of HUNTING_LEVELS) speedByLevel[lvl] = num(speeds[lvl], DEFAULT_SPEED_BY_LEVEL[lvl], HUNTING_LIMITS.speed.min, HUNTING_LIMITS.speed.max);
  const regenRaw = typeof raw.hpRegenSeconds === 'number' ? raw.hpRegenSeconds : Number(raw.hpRegenSeconds);
  const spawnCount = num(raw.spawnCount, d.spawnCount, HUNTING_LIMITS.spawnCount.min, HUNTING_LIMITS.spawnCount.max);
  // configs saved before spawnMin/spawnMax existed used 0..spawnCount for 'random': keep that maximum (0 → default range)
  const legacyMax = spawnCount > 0 ? spawnCount : d.spawnMax;
  const boundA = num(raw.spawnMin, d.spawnMin, HUNTING_LIMITS.spawnCount.min, HUNTING_LIMITS.spawnCount.max);
  const boundB = num(raw.spawnMax, Math.max(boundA, legacyMax), HUNTING_LIMITS.spawnCount.min, HUNTING_LIMITS.spawnCount.max);
  const spawnMin = Math.min(boundA, boundB), spawnMax = Math.max(boundA, boundB);
  return {
    name: str(raw.name, d.name, HUNTING_LIMITS.nameLength),
    hp: num(raw.hp, d.hp, HUNTING_LIMITS.hp.min, HUNTING_LIMITS.hp.max),
    damage: num(raw.damage, d.damage, HUNTING_LIMITS.damage.min, HUNTING_LIMITS.damage.max),
    xpEnabled: bool(raw.xpEnabled, d.xpEnabled),
    xp: num(raw.xp, d.xp, HUNTING_LIMITS.xp.min, HUNTING_LIMITS.xp.max),
    level: oneOf(raw.level, HUNTING_LEVELS, d.level),
    speedByLevel,
    spawnMode: oneOf(raw.spawnMode, ['fixed', 'random'] as const, d.spawnMode),
    spawnCount, spawnMin, spawnMax,
    combatBreakDistance: num(raw.combatBreakDistance, d.combatBreakDistance, HUNTING_LIMITS.combatBreak.min, HUNTING_LIMITS.combatBreak.max),
    hpRegenSeconds: (HP_REGEN_OPTIONS as readonly number[]).includes(regenRaw) ? (regenRaw as HpRegenSeconds) : d.hpRegenSeconds,
    canShoot: bool(raw.canShoot, d.canShoot),
    reaction: oneOf(raw.reaction, RESIDENT_REACTIONS, d.reaction),
    radius: num(raw.radius, d.radius, HUNTING_LIMITS.radius.min, HUNTING_LIMITS.radius.max),
    respawnCooldownSeconds: num(raw.respawnCooldownSeconds, d.respawnCooldownSeconds, HUNTING_LIMITS.respawn.min, HUNTING_LIMITS.respawn.max),
  };
}

export const CONTRACT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function parseContractConfig(raw: unknown): HuntingContractConfig | null {
  if (!isRec(raw) || typeof raw.id !== 'string' || !CONTRACT_ID_RE.test(raw.id) || !isVariantId(raw.variantId)) return null;
  return {
    id: raw.id, variantId: raw.variantId,
    quantity: num(raw.quantity, 1, HUNTING_LIMITS.quantity.min, HUNTING_LIMITS.quantity.max),
    timeLimitMinutes: num(raw.timeLimitMinutes, 30, HUNTING_LIMITS.timeLimit.min, HUNTING_LIMITS.timeLimit.max),
    xpReward: num(raw.xpReward, 100, HUNTING_LIMITS.xp.min, HUNTING_LIMITS.xp.max),
    crownsReward: num(raw.crownsReward, 10, HUNTING_LIMITS.crowns.min, HUNTING_LIMITS.crowns.max),
    cooldownHours: num(raw.cooldownHours, 24, HUNTING_LIMITS.cooldownHours.min, HUNTING_LIMITS.cooldownHours.max, false),
    initialPercent: num(raw.initialPercent, DEFAULT_CONTRACT_INITIAL_PERCENT, HUNTING_LIMITS.initialPercent.min, HUNTING_LIMITS.initialPercent.max),
    refillBatch: num(raw.refillBatch, DEFAULT_CONTRACT_REFILL_BATCH, HUNTING_LIMITS.refillBatch.min, HUNTING_LIMITS.refillBatch.max),
    enabled: bool(raw.enabled, true),
  };
}

/**
 * How many contract animals to spawn when none of the owner's is alive: the initial share of the
 * quota while nothing was killed yet, then `refillBatch` at a time — never more than what is left
 * to kill (`quantity - killed`). Killed animals leave the world for good; the next batch appears
 * elsewhere only after the previous one is dead.
 */
export function contractSpawnBatch(
  contract: Pick<HuntingContractConfig, 'initialPercent' | 'refillBatch'>,
  progress: { quantity: number; killed: number },
): number {
  const remaining = Math.max(0, Math.floor(progress.quantity) - Math.max(0, Math.floor(progress.killed)));
  const initial = Math.max(1, Math.round((progress.quantity * contract.initialPercent) / 100));
  return Math.min(remaining, progress.killed > 0 ? Math.max(1, Math.floor(contract.refillBatch)) : initial);
}

export function parseLevelProfile(raw: unknown, level: HuntingLevel): HuntingLevelProfile {
  const d = HUNTING_LEVEL_PROFILES[level];
  const out = { ...d };
  if (!isRec(raw)) return out;
  for (const field of LEVEL_PROFILE_FIELDS) {
    const integer = field.step >= 1;
    out[field.key] = num(raw[field.key], d[field.key], field.min, field.max, integer);
  }
  return out;
}
export function parseLevelProfiles(raw: unknown): HuntingLevelProfiles {
  const source = isRec(raw) ? raw : {};
  const out = defaultLevelProfiles();
  for (const level of HUNTING_LEVELS) out[level] = parseLevelProfile(source[level], level);
  return out;
}

/** Lenient parser: fills defaults, drops malformed contracts/variants, dedupes contract ids. */
export function parseHuntingConfig(raw: unknown): HuntingConfig {
  const d = defaultHuntingConfig();
  if (!isRec(raw)) return d;
  const g = isRec(raw.general) ? raw.general : {};
  const general: HuntingGeneralConfig = {
    handDamage: num(g.handDamage, d.general.handDamage, 0, HUNTING_LIMITS.damage.max),
    huntsRespawnSeconds: num(g.huntsRespawnSeconds, d.general.huntsRespawnSeconds, HUNTING_LIMITS.respawn.min, HUNTING_LIMITS.respawn.max),
    npcInteractRadius: num(g.npcInteractRadius, d.general.npcInteractRadius, 32, 2000),
    enabled: bool(g.enabled, d.general.enabled),
  };
  const variants: Record<string, AnimalVariantConfig> = {};
  if (isRec(raw.variants)) {
    for (const [id, v] of Object.entries(raw.variants)) {
      const parsed = parseVariantId(id);
      if (!parsed) continue;
      variants[id] = parseVariantConfig(v, parsed.variant);
    }
  }
  const contracts: HuntingContractConfig[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.contracts)) {
    for (const c of raw.contracts.slice(0, HUNTING_LIMITS.contracts)) {
      const parsed = parseContractConfig(c);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      contracts.push(parsed);
    }
  }
  return { schemaVersion: HUNTING_CONFIG_SCHEMA_VERSION, general, variants, contracts, levelProfiles: parseLevelProfiles(raw.levelProfiles), motion: parseMotionConfig(raw.motion) };
}

/** Effective ambient population of a variant: exact for 'fixed'; 'random' rolls spawnMin..spawnMax (inclusive). Roll ONCE per room. */
export function rollSpawnCount(v: AnimalVariantConfig, rand: () => number = Math.random): number {
  if (v.spawnMode === 'random') {
    const min = Math.min(v.spawnMin, v.spawnMax), max = Math.max(v.spawnMin, v.spawnMax);
    return min + Math.floor(Math.min(0.999999, Math.max(0, rand())) * (max - min + 1));
  }
  return v.spawnCount;
}
/** Signature of the spawn settings — when it changes the server re-rolls a 'random' population. */
export function spawnSignature(v: AnimalVariantConfig): string { return `${v.spawnMode}:${v.spawnCount}:${v.spawnMin}:${v.spawnMax}`; }
/**
 * Ambient animals configured for a category (shown next to the anchor total in the admin).
 * Anchors are spawn/respawn POINTS, not a cap: extra animals share random anchors. 'random' counts its maximum.
 * The monster tree is excluded (it has its own anchors, one tree per anchor).
 */
export function configuredAnimalCount(variants: Record<string, AnimalVariantConfig>, category: HuntingCategory): number {
  let total = 0;
  for (const [id, v] of Object.entries(variants)) {
    const parsed = parseVariantId(id);
    if (!parsed || parsed.category !== category || parsed.animalKey === MONSTER_TREE_ANIMAL_KEY) continue;
    total += v.spawnMode === 'random' ? Math.max(v.spawnMin, v.spawnMax) : v.spawnCount;
  }
  return total;
}
export function runSpeedFor(v: AnimalVariantConfig): number { return v.speedByLevel[v.level] ?? DEFAULT_SPEED_BY_LEVEL[v.level]; }
export function levelProfileFor(config: Pick<HuntingConfig, 'levelProfiles'>, v: AnimalVariantConfig): HuntingLevelProfile {
  return config.levelProfiles?.[v.level] ?? HUNTING_LEVEL_PROFILES[v.level];
}

export const HUNTING_CONFIG_TABLE_SQL = `create table if not exists hunting_config (
  config_id text primary key default 'default',
  config jsonb not null,
  updated_at timestamptz not null default now()
);`;
export const PLAYER_HUNTING_TABLE_SQL = `create table if not exists player_hunting (
  user_id uuid primary key,
  active jsonb,
  locks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);`;
