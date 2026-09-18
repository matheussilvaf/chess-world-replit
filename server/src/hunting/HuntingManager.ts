import type { Client } from '@colyseus/core';
import type { WorldState } from '../schemas/WorldState.js';
import type { PlayerState } from '../schemas/PlayerState.js';
import { AnimalState } from '../schemas/AnimalState.js';
import { NpcState } from '../schemas/NpcState.js';
import {
  ANIMAL_ANIMATION_FPS,
  ANIMAL_APPROACH_SPEED_FACTOR,
  ANIMAL_ATTACK_DURATION_MS,
  ANIMAL_ATTACK_HIT_FRAMES,
  ANIMAL_BITE_RANGE,
  ANIMAL_DEFAULT_HITBOX,
  ANIMAL_DEFAULT_HURTBOX,
  ANIMAL_DIRECTIONS,
  ANIMAL_HUNT_AGGRO_RADIUS,
  ANIMAL_SHOT_MUZZLE_PX,
  ANIMAL_SHOT_RADIUS,
  ANIMAL_WANDER_SPEED_FACTOR,
  DEFAULT_CONTRACT_INITIAL_PERCENT,
  DEFAULT_CONTRACT_REFILL_BATCH,
  HUNT_MSG,
  MONSTER_TREE_ANIMAL_KEY,
  NPC_BARBARIAN_ID,
  NPC_DIRECTION_ORDER,
  NPC_TALK_HOLD_MS,
  NPC_WALK_SPEED,
  animalDirectionFromVector,
  contractSpawnBatch,
  levelProfileFor,
  parseVariantId,
  rigIdForAnimal,
  rollSpawnCount,
  runSpeedFor,
  spawnSignature,
  type AnimalVariantConfig,
  type HuntingConfig,
  type HuntingContractConfig,
  type HuntingLevelProfile,
  type HuntShotHitPayload,
  type HuntShotPayload,
  type PlayerHuntingRecord,
} from '../shared/hunting/HuntingShapes.js';
import { runDistanceBetween, runFrameAt } from '../shared/hunting/HuntingMotion.js';
import { CRAFTING_WORLD_MAP, type MapAnchor } from '../shared/hunting/craftingWorldMapData.js';
import { getCraftingWorldGeometry } from '../shared/hunting/HuntingMapGeometry.js';
import { rectanglesIntersect, type LocalRectangle } from '../shared/combat/CharacterCombatShapes.js';
import { parseWeaponRef } from '../shared/characters/PlayerCharacterShapes.js';
import { getWeaponVariantProjectile, resolveWeaponLevelStats } from '../shared/combat/WeaponShapes.js';
import { BIGCHESS_ARROW_FAMILY_ID } from '../shared/bigchess/BigChessShapes.js';
import { getWeaponFamiliesCached } from '../rigs/weaponFamilyRepository.js';
import { getRigCached } from '../rigs/rigConfigRepository.js';
import { getCharacterConfig } from '../combat/characterConfigService.js';
import { targetHurtboxUnion } from '../combat/combatResolver.js';
import { progressService } from '../progress/progressService.js';
import { addCrowns } from '../bigchess/bigChessRepository.js';
import { getHuntingConfigCached } from './huntingConfigRepository.js';
import { getPlayerHunting, updateIfActiveMatches } from './playerHuntingRepository.js';

type AiMode = 'rooted' | 'return' | 'wander' | 'alert' | 'chase' | 'attack' | 'retreat' | 'dodge';
type Gait = 'walk' | 'run';
interface RuntimeAnimal {
  state: AnimalState;
  variant: AnimalVariantConfig;
  mode: AiMode;
  targetSessionId: string;
  lastAttackerSessionId: string;
  targetX: number;
  targetY: number;
  pauseUntil: number;
  reactAt: number;
  nextAttackAt: number;
  /** Shooters: earliest time of the next projectile. */
  nextShotAt: number;
  hitSwings: Set<string>;
  ambient: boolean;
  treeAnchor?: string;
  treeAnchorX?: number;
  treeAnchorY?: number;
  regenStartedAt: number;
  regenStartHp: number;
  /** ms since the current run started (-1 = not running); drives the leap bursts of HuntingMotion. */
  runElapsedMs: number;
  /** Gait chosen while chasing (hysteresis around profile.runDistance). */
  chaseGait: Gait;
  /** Last known position/velocity of the chased player (per decision). */
  targetTrack: { sessionId: string; x: number; y: number; at: number; vx: number; vy: number } | null;
  retreatUntil: number;
  retreatCooldownUntil: number;
  dodgeUntil: number;
  nextDodgeAt: number;
  /** -1 / 0 / 1: circling side while flanking, re-rolled every couple of seconds. */
  flankSide: number;
  flankUntil: number;
}
/** Below this player speed (px/s) the target counts as standing still (animal may stalk instead of running). */
const TARGET_MOVING_SPEED = 25;
/** Live animal projectile — a straight ground-level line, simulated per tick until it hits a player or runs out of range. */
interface Shot {
  id: string;
  animalId: string;
  animalName: string;
  damage: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  /** Px still to travel (the range was already cut at the first wall when the shot was fired). */
  remaining: number;
}
/** Shots cannot fly through walls, water, map borders or into the safe zone — same predicate the animals use to walk. */
const SHOT_TRACE_STEP = 8;
/** The animal stops this far from the player (px) instead of walking into it. */
const STANDOFF_FACTOR = 0.75;

export interface HuntingHost {
  state: WorldState;
  region: string;
  clock: {
    setTimeout(fn: () => void, ms: number): { clear?: () => void };
    setInterval(fn: () => void, ms: number): { clear?: () => void };
  };
  clients: Client[];
  broadcast(event: string, payload: unknown): void;
  isDead(sessionId: string): boolean;
  damagePlayer(sessionId: string, damage: number, attackerName: string): number | null;
  lastSwing(sessionId: string): { movement: string; at: number; until: number } | null;
}

const MAX_ANIMALS = 200;
const FAR_AI_DISTANCE = 1400;
/** Contract animals (re)spawn at anchors at least this far (px) from their owner when possible. */
const CONTRACT_SPAWN_MIN_DISTANCE = 900;
const ARROW_WINDOW_MS = 3000;
const randomBetween = (a: number, b: number): number => a + Math.random() * (b - a);

export class HuntingManager {
  private config: HuntingConfig;
  private readonly geometry = getCraftingWorldGeometry();
  private readonly runtime = new Map<string, RuntimeAnimal>();
  private readonly records = new Map<string, PlayerHuntingRecord>();
  private readonly tableMissing = new Map<string, boolean>();
  private readonly mutationSeq = new Map<string, number>();
  private readonly recordQueues = new Map<string, Promise<void>>();
  private readonly intervals = new Set<{ clear?: () => void }>();
  private readonly timers = new Map<string, Set<{ clear?: () => void }>>();
  private readonly consumedShots = new Map<string, number>();
  /** Live animal projectiles by id. */
  private readonly shots = new Map<string, Shot>();
  private readonly pendingAmbient = new Map<string, number>();
  private readonly ambientDesired = new Map<string, number>();
  /** 'random' populations are rolled once per room and only re-rolled when the spawn settings change. */
  private readonly ambientRolls = new Map<string, { signature: string; count: number }>();
  private npcTarget: { x: number; y: number } | null = null;
  private npcPauseUntil = 0;
  private npcTalkUntil = 0;
  private idCounter = 0;
  private lastDecisionAt = 0;
  private destroyed = false;

  private constructor(private readonly host: HuntingHost, config: HuntingConfig) {
    this.config = config;
  }

  static async create(host: HuntingHost): Promise<HuntingManager | null> {
    const config = await getHuntingConfigCached();
    if (!config.general.enabled) return null;
    const manager = new HuntingManager(host, config);
    manager.reconcileAmbient();
    manager.spawnNpc();
    manager.intervals.add(host.clock.setInterval(() => void manager.reloadConfig(), 30_000));
    manager.intervals.add(host.clock.setInterval(() => void manager.expireContracts(), 1000));
    return manager;
  }

  private schedule(key: string, ms: number, callback: () => void): void {
    let handle: { clear?: () => void };
    handle = this.host.clock.setTimeout(() => {
      const group = this.timers.get(key);
      group?.delete(handle);
      if (group?.size === 0) this.timers.delete(key);
      callback();
    }, ms);
    let group = this.timers.get(key);
    if (!group) { group = new Set(); this.timers.set(key, group); }
    group.add(handle);
  }

  private cancelTimers(key: string): void {
    const group = this.timers.get(key);
    if (!group) return;
    for (const timer of group) timer.clear?.();
    this.timers.delete(key);
  }

  async reloadConfig(): Promise<void> {
    if (this.destroyed) return;
    const config = await getHuntingConfigCached();
    if (this.destroyed) return;
    this.config = config;
    if (!config.general.enabled) {
      for (const id of [...this.runtime.keys()]) this.removeAnimal(id);
      this.shots.clear(); // ticks stop while disabled — a frozen shot must not land when hunting is re-enabled
      this.host.state.npcs.delete(NPC_BARBARIAN_ID);
      return;
    }
    this.reconcileAmbient();
    this.spawnNpc();
    // contracts stranded by a disable/enable cycle or a failed spawn (full room, no free anchor) heal here
    for (const owner of this.records.keys()) this.topUpContract(owner, 'batch');
  }

  private reconcileAmbient(): void {
    const desired = new Map<string, number>();
    for (const [variantId, variant] of Object.entries(this.config.variants)) desired.set(variantId, this.desiredCount(variantId, variant));
    for (const variantId of [...this.ambientRolls.keys()]) if (!desired.has(variantId)) this.ambientRolls.delete(variantId);
    this.ambientDesired.clear();
    for (const [variantId, count] of desired) this.ambientDesired.set(variantId, count);
    for (const animal of this.runtime.values()) {
      const next = this.config.variants[animal.state.variantId];
      if (next) {
        animal.variant = next;
        animal.state.name = next.name;
        animal.state.maxHp = next.hp;
        animal.state.hp = Math.min(animal.state.hp, next.hp);
        animal.state.level = next.level;
      }
    }
    for (const [variantId, count] of desired) {
      const existing = [...this.runtime.values()].filter((a) => a.ambient && a.state.variantId === variantId && !a.state.dead);
      for (const extra of existing.slice(count)) this.removeAnimal(extra.state.id);
      const pending = this.pendingAmbient.get(variantId) ?? 0;
      for (let i = existing.length + pending; i < count; i++) this.spawnAnimal(variantId, '', true);
    }
    for (const animal of [...this.runtime.values()]) {
      if (animal.ambient && !desired.has(animal.state.variantId)) this.removeAnimal(animal.state.id);
    }
  }

  /** Population wanted for a variant: exact for 'fixed'; 'random' keeps its first roll until mode/min/max change. */
  private desiredCount(variantId: string, variant: AnimalVariantConfig): number {
    const signature = spawnSignature(variant);
    const previous = this.ambientRolls.get(variantId);
    if (previous && previous.signature === signature) return previous.count;
    const count = rollSpawnCount(variant);
    this.ambientRolls.set(variantId, { signature, count });
    return count;
  }

  private anchorPoint(anchors: readonly MapAnchor[], npc = false, usedName?: Set<string>, awayFrom?: { x: number; y: number }): { x: number; y: number; name: string } | null {
    let candidates = usedName ? anchors.filter((a) => !usedName.has(a.name)) : [...anchors];
    if (awayFrom) {
      // contract refills appear "somewhere else": prefer anchors out of the owner's sight
      const far = candidates.filter((a) => Math.hypot(a.x - awayFrom.x, a.y - awayFrom.y) >= CONTRACT_SPAWN_MIN_DISTANCE);
      if (far.length) candidates = far;
    }
    for (let i = 0; i < 30 && candidates.length; i++) {
      const anchor = candidates[Math.floor(Math.random() * candidates.length)];
      const x = anchor.x + randomBetween(-40, 40), y = anchor.y + randomBetween(-40, 40);
      if (npc ? this.geometry.isWalkableForNpc(x, y) : this.geometry.isWalkableForAnimal(x, y)) return { x, y, name: anchor.name };
    }
    return null;
  }

  private spawnAnimal(variantId: string, owner = '', ambient = false, awayFrom?: { x: number; y: number }): RuntimeAnimal | null {
    if (this.runtime.size >= MAX_ANIMALS) return null;
    const variant = this.config.variants[variantId];
    const parsed = parseVariantId(variantId);
    if (!variant || !parsed) return null;
    const isTree = parsed.animalKey === MONSTER_TREE_ANIMAL_KEY;
    const anchors = isTree ? CRAFTING_WORLD_MAP.monsterTreeAnchors
      : parsed.category === 'residents' ? CRAFTING_WORLD_MAP.residentAnchors : CRAFTING_WORLD_MAP.huntAnchors;
    const used = isTree ? new Set([...this.runtime.values()].map((a) => a.treeAnchor).filter((x): x is string => !!x)) : undefined;
    const point = this.anchorPoint(anchors, false, used, awayFrom);
    if (!point) return null;
    const id = `animal-${Date.now().toString(36)}-${++this.idCounter}`;
    const state = new AnimalState();
    Object.assign(state, {
      id, variantId, name: variant.name, x: point.x, y: point.y, dir: 0,
      anim: 'idle', hp: variant.hp, maxHp: variant.hp, level: variant.level,
      dead: false, contractOwner: owner, frame: 0,
    });
    const rt: RuntimeAnimal = {
      state, variant, mode: isTree ? 'rooted' : 'wander', targetSessionId: '',
      lastAttackerSessionId: '', targetX: point.x, targetY: point.y,
      pauseUntil: Date.now() + randomBetween(1000, 4000), reactAt: 0,
      nextAttackAt: 0, nextShotAt: 0, hitSwings: new Set(), ambient, treeAnchor: isTree ? point.name : undefined,
      treeAnchorX: isTree ? point.x : undefined, treeAnchorY: isTree ? point.y : undefined,
      regenStartedAt: 0, regenStartHp: variant.hp,
      runElapsedMs: -1, chaseGait: 'run', targetTrack: null, retreatUntil: 0, retreatCooldownUntil: 0,
      dodgeUntil: 0, nextDodgeAt: 0, flankSide: 0, flankUntil: 0,
    };
    this.runtime.set(id, rt);
    this.host.state.animals.set(id, state);
    return rt;
  }

  private removeAnimal(id: string): void {
    this.cancelTimers(`animal:${id}`);
    this.cancelTimers(`fade:${id}`);
    for (const shot of this.shots.values()) if (shot.animalId === id) this.shots.delete(shot.id);
    this.runtime.delete(id);
    this.host.state.animals.delete(id);
  }

  private spawnNpc(): void {
    if (this.host.state.npcs.has(NPC_BARBARIAN_ID)) return;
    const z = this.geometry.safeZone;
    let x = z.x + z.width / 2, y = z.y + z.height / 2;
    if (!this.geometry.isWalkableForNpc(x, y)) {
      const point = this.anchorPoint([{ name: 'center', x, y }], true);
      if (point) ({ x, y } = point);
    }
    const npc = new NpcState();
    Object.assign(npc, { id: NPC_BARBARIAN_ID, x, y, dir: 0, isMoving: false });
    this.host.state.npcs.set(npc.id, npc);
  }

  tick(dtMs: number): void {
    if (this.destroyed || !this.config.general.enabled) return;
    const now = Date.now();
    const decide = now - this.lastDecisionAt >= 100;
    if (decide) this.lastDecisionAt = now;
    for (const animal of this.runtime.values()) {
      if (animal.state.dead) continue;
      const near = this.nearestPlayer(animal.state.x, animal.state.y, FAR_AI_DISTANCE);
      if (!near && !animal.targetSessionId) {
        this.regen(animal, dtMs, now);
        continue;
      }
      if (decide) this.decide(animal, now);
      this.moveAnimal(animal, dtMs, now);
    }
    this.moveShots(dtMs);
    this.moveNpc(dtMs / 1000, now);
  }

  private nearestPlayer(x: number, y: number, max = Infinity): [string, PlayerState, number] | null {
    let found: [string, PlayerState, number] | null = null;
    this.host.state.players.forEach((p, sid) => {
      if (p.currentBoardId || p.hp <= 0 || this.host.isDead(sid)) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= max && (!found || d < found[2])) found = [sid, p, d];
    });
    return found;
  }

  private profileFor(animal: RuntimeAnimal): HuntingLevelProfile { return levelProfileFor(this.config, animal.variant); }

  private face(animal: RuntimeAnimal, dx: number, dy: number): void {
    if (Math.abs(dx) + Math.abs(dy) > 0.5) animal.state.dir = ANIMAL_DIRECTIONS.indexOf(animalDirectionFromVector(dx, dy));
  }

  /** Velocity estimate (px/s, lightly smoothed) of the chased player from its position at the previous decision. */
  private trackTarget(animal: RuntimeAnimal, target: PlayerState, now: number): { vx: number; vy: number; speed: number } {
    const track = animal.targetTrack;
    let vx = 0, vy = 0;
    if (track && track.sessionId === animal.targetSessionId && now > track.at && now - track.at < 1000) {
      const dt = (now - track.at) / 1000;
      vx = track.vx * 0.4 + ((target.x - track.x) / dt) * 0.6;
      vy = track.vy * 0.4 + ((target.y - track.y) / dt) * 0.6;
    }
    animal.targetTrack = { sessionId: animal.targetSessionId, x: target.x, y: target.y, at: now, vx, vy };
    return { vx, vy, speed: Math.hypot(vx, vy) };
  }

  private acquireTarget(animal: RuntimeAnimal, sessionId: string, target: PlayerState, now: number, profile: HuntingLevelProfile): void {
    animal.targetSessionId = sessionId;
    animal.targetTrack = null;
    animal.reactAt = now + profile.reactionMs;
    animal.mode = 'alert';
    animal.chaseGait = Math.hypot(target.x - animal.state.x, target.y - animal.state.y) > profile.runDistance ? 'run' : 'walk';
    this.face(animal, target.x - animal.state.x, target.y - animal.state.y);
  }

  /** Picks a walkable point away from the player (straight away first, then angled). */
  private fleeFrom(animal: RuntimeAnimal, target: PlayerState): void {
    const away = Math.atan2(animal.state.y - target.y, animal.state.x - target.x);
    const walkable = (px: number, py: number) => this.geometry.isWalkableForAnimal(px, py);
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
      const tx = animal.state.x + Math.cos(away + turn) * 160, ty = animal.state.y + Math.sin(away + turn) * 160;
      if (this.geometry.segmentWalkable(animal.state.x, animal.state.y, tx, ty, walkable)) {
        animal.targetX = tx; animal.targetY = ty;
        return;
      }
    }
    animal.targetX = animal.state.x; animal.targetY = animal.state.y;
  }

  private decide(animal: RuntimeAnimal, now: number): void {
    const parsed = parseVariantId(animal.state.variantId);
    const profile = this.profileFor(animal);
    const isTree = parsed?.animalKey === MONSTER_TREE_ANIMAL_KEY;
    let target = animal.targetSessionId ? this.host.state.players.get(animal.targetSessionId) : undefined;
    if (target && (target.currentBoardId || target.hp <= 0 || this.host.isDead(animal.targetSessionId))) target = undefined;
    if (target && Math.hypot(target.x - animal.state.x, target.y - animal.state.y) > animal.variant.combatBreakDistance * profile.persistence) target = undefined;
    if (!target) {
      animal.targetSessionId = '';
      animal.targetTrack = null;
      if (isTree) {
        const atAnchor = Math.hypot((animal.treeAnchorX ?? animal.state.x) - animal.state.x, (animal.treeAnchorY ?? animal.state.y) - animal.state.y) < 8;
        animal.mode = atAnchor ? 'rooted' : 'return';
        animal.targetX = animal.treeAnchorX ?? animal.state.x;
        animal.targetY = animal.treeAnchorY ?? animal.state.y;
        this.regen(animal, 100, now);
        return;
      }
      const nearest = this.nearestPlayer(animal.state.x, animal.state.y, parsed?.category === 'hunts' ? ANIMAL_HUNT_AGGRO_RADIUS : animal.variant.radius);
      if (nearest && (parsed?.category === 'hunts' || animal.variant.reaction === 'radius')) {
        this.acquireTarget(animal, nearest[0], nearest[1], now, profile);
        target = nearest[1];
      }
    }
    if (!target) {
      if (!isTree && animal.mode !== 'wander') {
        animal.mode = 'wander';
        animal.targetX = animal.state.x; animal.targetY = animal.state.y;
        animal.pauseUntil = now + randomBetween(500, 1500);
      }
      this.regen(animal, 100, now);
      return;
    }
    // ── retreat (only below the level's hp ratio, bounded in time, with a cooldown so it does not flee forever)
    const hpRatio = animal.state.hp / animal.state.maxHp;
    if (animal.mode !== 'retreat' && profile.retreatHpRatio > 0 && hpRatio < profile.retreatHpRatio && now >= animal.retreatCooldownUntil) {
      animal.mode = 'retreat';
      animal.retreatUntil = now + profile.retreatMaxMs;
    }
    if (animal.mode === 'retreat') {
      animal.state.hp = Math.min(animal.state.maxHp, animal.state.hp + animal.state.maxHp * profile.retreatHealPerSecond * 0.1);
      if (animal.state.hp / animal.state.maxHp >= profile.reengageHpRatio || now >= animal.retreatUntil) {
        animal.mode = 'chase';
        animal.retreatCooldownUntil = now + 6000;
        animal.chaseGait = 'run';
      } else {
        this.fleeFrom(animal, target);
        return;
      }
    }
    if (now < animal.reactAt) return;
    if (animal.mode === 'attack') return;
    const motion = this.trackTarget(animal, target, now);
    const dx = target.x - animal.state.x, dy = target.y - animal.state.y;
    const distance = Math.hypot(dx, dy);
    const inRange = distance <= ANIMAL_BITE_RANGE + 4;
    // ── bite
    if (inRange && now >= animal.nextAttackAt && Math.random() <= profile.aggression) {
      animal.mode = 'attack';
      animal.state.anim = 'attack';
      this.face(animal, dx, dy);
      animal.nextAttackAt = now + profile.attackCooldownMs;
      const hitDelay = (ANIMAL_ATTACK_HIT_FRAMES[0] / ANIMAL_ANIMATION_FPS.attack) * 1000;
      this.schedule(`animal:${animal.state.id}`, hitDelay, () => void this.bite(animal));
      this.schedule(`animal:${animal.state.id}`, ANIMAL_ATTACK_DURATION_MS, () => {
        if (!animal.state.dead && animal.mode === 'attack') animal.mode = 'chase';
      });
      return;
    }
    // ── shot (shooters only): target out of bite range but inside the level's shoot range — same attack
    //    animation, the projectile leaves on the hit frame and flies a straight line towards the player
    if (animal.variant.canShoot && animal.mode !== 'dodge' && !inRange && distance <= profile.shootRange && now >= animal.nextShotAt && Math.random() <= profile.shootChance) {
      animal.mode = 'attack';
      animal.state.anim = 'attack';
      this.face(animal, dx, dy);
      animal.nextShotAt = now + profile.shootCooldownMs;
      const releaseDelay = (ANIMAL_ATTACK_HIT_FRAMES[0] / ANIMAL_ANIMATION_FPS.attack) * 1000;
      this.schedule(`animal:${animal.state.id}`, releaseDelay, () => this.shoot(animal, profile));
      this.schedule(`animal:${animal.state.id}`, ANIMAL_ATTACK_DURATION_MS, () => {
        if (!animal.state.dead && animal.mode === 'attack') animal.mode = 'chase';
      });
      return;
    }
    // ── dodge: leap sideways when the player starts a swing nearby
    if (animal.mode === 'dodge') {
      if (now < animal.dodgeUntil) return;
      animal.mode = 'chase';
    }
    const swing = this.host.lastSwing(animal.targetSessionId);
    if (swing && now - swing.at < 250 && distance < 130 && now >= animal.nextDodgeAt && Math.random() < profile.dodgeChance) {
      const len = Math.max(1, distance), side = Math.random() < 0.5 ? -1 : 1, jump = randomBetween(50, 90);
      const tx = animal.state.x + (-dy / len) * jump * side, ty = animal.state.y + (dx / len) * jump * side;
      if (this.geometry.segmentWalkable(animal.state.x, animal.state.y, tx, ty, (px, py) => this.geometry.isWalkableForAnimal(px, py))) {
        animal.mode = 'dodge';
        animal.targetX = tx; animal.targetY = ty;
        animal.dodgeUntil = now + 400;
        animal.nextDodgeAt = now + 1200;
        return;
      }
    }
    // ── chase: run when the target moves or is far, stalk (walk) a standing target that is close — with hysteresis
    animal.mode = 'chase';
    const targetMoving = motion.speed > TARGET_MOVING_SPEED;
    if (targetMoving || distance > profile.runDistance) animal.chaseGait = 'run';
    else if (distance < profile.runDistance * 0.6) animal.chaseGait = 'walk';
    if (now >= animal.flankUntil) {
      animal.flankSide = Math.random() < profile.flankChance ? (Math.random() < 0.5 ? -1 : 1) : 0;
      animal.flankUntil = now + randomBetween(1200, 2200);
    }
    const standoff = ANIMAL_BITE_RANGE * STANDOFF_FACTOR;
    if (inRange) {
      // waiting for the cooldown / aggression roll: hold ground facing the player, or circle when flanking
      this.face(animal, dx, dy);
      if (animal.flankSide) {
        const angle = Math.atan2(-dy, -dx) + 0.45 * animal.flankSide;
        animal.targetX = target.x + Math.cos(angle) * standoff;
        animal.targetY = target.y + Math.sin(angle) * standoff;
      } else {
        animal.targetX = animal.state.x; animal.targetY = animal.state.y;
      }
      return;
    }
    // lead a moving target a little and stop at bite distance instead of on top of the player
    const lead = targetMoving ? 0.3 : 0;
    const px = target.x + motion.vx * lead, py = target.y + motion.vy * lead;
    let angle = Math.atan2(animal.state.y - py, animal.state.x - px);
    if (animal.flankSide && distance > 90) angle += 0.6 * animal.flankSide;
    animal.targetX = px + Math.cos(angle) * standoff;
    animal.targetY = py + Math.sin(angle) * standoff;
  }

  private regen(animal: RuntimeAnimal, dtMs: number, now: number): void {
    if (animal.state.hp >= animal.state.maxHp) return;
    if (animal.variant.hpRegenSeconds === 0) {
      animal.state.hp = animal.state.maxHp;
      return;
    }
    if (!animal.regenStartedAt) {
      animal.regenStartedAt = now;
      animal.regenStartHp = animal.state.hp;
    }
    animal.state.hp = Math.min(animal.state.maxHp, animal.state.hp + animal.state.maxHp * dtMs / (animal.variant.hpRegenSeconds * 1000));
  }

  private gaitFor(animal: RuntimeAnimal): Gait {
    switch (animal.mode) {
      case 'wander': case 'return': return 'walk';
      case 'retreat': case 'dodge': return 'run';
      default: return animal.chaseGait;
    }
  }

  private stopRunning(animal: RuntimeAnimal, anim: 'idle' | 'attack' = 'idle'): void {
    animal.runElapsedMs = -1;
    if (anim === 'idle') animal.state.anim = 'idle';
  }

  private moveAnimal(animal: RuntimeAnimal, dtMs: number, now: number): void {
    if (animal.mode === 'rooted' || animal.mode === 'alert' || animal.mode === 'attack') {
      this.stopRunning(animal, animal.mode === 'attack' ? 'attack' : 'idle');
      return;
    }
    if (animal.mode === 'wander' && (now < animal.pauseUntil || Math.hypot(animal.targetX - animal.state.x, animal.targetY - animal.state.y) < 12)) {
      this.stopRunning(animal);
      if (now >= animal.pauseUntil) {
        const angle = Math.random() * Math.PI * 2, distance = randomBetween(150, 600);
        const x = animal.state.x + Math.cos(angle) * distance, y = animal.state.y + Math.sin(angle) * distance;
        if (this.geometry.segmentWalkable(animal.state.x, animal.state.y, x, y, (px, py) => this.geometry.isWalkableForAnimal(px, py))) {
          animal.targetX = x; animal.targetY = y;
        }
        animal.pauseUntil = now + randomBetween(1000, 4000);
      }
      return;
    }
    const dx = animal.targetX - animal.state.x, dy = animal.targetY - animal.state.y;
    const len = Math.hypot(dx, dy);
    if (len < 8 && animal.mode === 'return') {
      animal.state.x = animal.treeAnchorX ?? animal.state.x;
      animal.state.y = animal.treeAnchorY ?? animal.state.y;
      animal.mode = 'rooted';
      this.stopRunning(animal);
      return;
    }
    if (len < 1) {
      this.stopRunning(animal);
      return;
    }
    const gait = this.gaitFor(animal);
    const runSpeed = runSpeedFor(animal.variant);
    let step: number;
    if (gait === 'run') {
      // leap: (almost) still while gathered, the whole stride while airborne — average speed stays runSpeed;
      // the frame shown by the client is the phase of this same clock (HuntingMotion)
      if (animal.runElapsedMs < 0) animal.runElapsedMs = 0;
      step = runDistanceBetween(animal.runElapsedMs, animal.runElapsedMs + dtMs, runSpeed, animal.variant.runFps);
      animal.runElapsedMs += dtMs;
      // the snapshot carries the phase of the NEXT interval: the client shows a snapshot's pose while it
      // interpolates from that snapshot's position towards the following one
      animal.state.frame = runFrameAt(animal.runElapsedMs, animal.variant.runFps);
    } else {
      animal.runElapsedMs = -1;
      const factor = animal.mode === 'wander' || animal.mode === 'return' ? ANIMAL_WANDER_SPEED_FACTOR : ANIMAL_APPROACH_SPEED_FACTOR;
      step = runSpeed * factor * (dtMs / 1000);
    }
    step = Math.min(len, step);
    const nx = animal.state.x + dx / len * step, ny = animal.state.y + dy / len * step;
    const walkable = (x: number, y: number) => this.geometry.isWalkableForAnimal(x, y);
    if (this.geometry.segmentWalkable(animal.state.x, animal.state.y, nx, ny, walkable, 8)) {
      animal.state.x = nx; animal.state.y = ny;
    } else if (this.geometry.segmentWalkable(animal.state.x, animal.state.y, nx, animal.state.y, walkable, 8)) {
      animal.state.x = nx;
    } else if (this.geometry.segmentWalkable(animal.state.x, animal.state.y, animal.state.x, ny, walkable, 8)) {
      animal.state.y = ny;
    } else {
      animal.pauseUntil = 0;
      if (animal.mode !== 'return') {
        animal.targetX = animal.state.x;
        animal.targetY = animal.state.y;
      }
      this.stopRunning(animal);
      return;
    }
    this.face(animal, dx, dy);
    animal.state.anim = gait;
  }

  private async bite(animal: RuntimeAnimal): Promise<void> {
    if (animal.state.dead) return;
    const player = this.host.state.players.get(animal.targetSessionId);
    if (!player || player.currentBoardId || this.host.isDead(animal.targetSessionId)) return;
    const parsed = parseVariantId(animal.state.variantId);
    if (!parsed) return;
    const rig = await getRigCached(rigIdForAnimal(parsed.category, parsed.animal));
    const playerConfig = player.characterId ? await getCharacterConfig(player.characterId) : null;
    if (animal.state.dead || this.host.state.players.get(animal.targetSessionId) !== player) return;
    const frames = rig?.animationConfigs.attack?.directions[ANIMAL_DIRECTIONS[animal.state.dir]]?.frames ?? {};
    const local = Object.values(frames).flatMap((f) => f.hitbox.enabled ? f.hitbox.rectangles : []);
    const hitboxes = (local.length ? local : [ANIMAL_DEFAULT_HITBOX]).map((r) => this.worldRect(r, animal.state.x, animal.state.y));
    const localPlayerHurt = playerConfig ? targetHurtboxUnion(playerConfig, player) : [];
    const playerHurt = localPlayerHurt.length
      ? localPlayerHurt.map((r) => this.worldRect(r, player.x, player.y))
      : [{ x: player.x - 18, y: player.y - 48, width: 36, height: 48 }];
    if (hitboxes.some((r) => playerHurt.some((p) => rectanglesIntersect(r, p))) || Math.hypot(player.x - animal.state.x, player.y - animal.state.y) <= ANIMAL_BITE_RANGE + 16) {
      this.host.damagePlayer(animal.targetSessionId, animal.variant.damage, animal.variant.name);
    }
  }

  /** Fires the projectile at the attack's hit frame: aims at the target's current position, range cut at the first wall. */
  private shoot(animal: RuntimeAnimal, profile: HuntingLevelProfile): void {
    if (animal.state.dead) return;
    const player = this.host.state.players.get(animal.targetSessionId);
    if (!player || player.currentBoardId || this.host.isDead(animal.targetSessionId)) return;
    if (this.geometry.inSafeZone(player.x, player.y)) return;
    const aimX = player.x - animal.state.x, aimY = player.y - animal.state.y;
    const length = Math.hypot(aimX, aimY);
    if (length < 1) return;
    const dx = aimX / length, dy = aimY / length;
    const x = animal.state.x + dx * ANIMAL_SHOT_MUZZLE_PX, y = animal.state.y + dy * ANIMAL_SHOT_MUZZLE_PX;
    // walk the line ahead of time so the client can replay the exact same segment without any collision code
    let range = 0;
    while (range < profile.shootRange) {
      const next = Math.min(profile.shootRange, range + SHOT_TRACE_STEP);
      if (!this.geometry.isWalkableForAnimal(x + dx * next, y + dy * next, 0)) break;
      range = next;
    }
    if (range <= 0) return;
    const shot: Shot = {
      id: `shot-${Date.now().toString(36)}-${++this.idCounter}`, animalId: animal.state.id, animalName: animal.variant.name, damage: animal.variant.damage,
      x, y, dx, dy, speed: profile.shootSpeed, remaining: range,
    };
    this.shots.set(shot.id, shot);
    const payload: HuntShotPayload = { id: shot.id, animalId: animal.state.id, x, y, dx, dy, speed: shot.speed, range };
    this.host.broadcast(HUNT_MSG.shot, payload);
  }

  /** Advances every live shot; the first player whose hurtbox it crosses takes the animal's damage. */
  private moveShots(dtMs: number): void {
    if (!this.shots.size) return;
    for (const shot of [...this.shots.values()]) {
      const step = Math.min(shot.remaining, shot.speed * (dtMs / 1000));
      const hit = this.shotHit(shot, step);
      shot.x += shot.dx * step;
      shot.y += shot.dy * step;
      shot.remaining -= step;
      if (hit) {
        this.shots.delete(shot.id);
        this.host.damagePlayer(hit.sessionId, shot.damage, shot.animalName);
        const payload: HuntShotHitPayload = { id: shot.id, x: hit.x, y: hit.y, targetSessionId: hit.sessionId };
        this.host.broadcast(HUNT_MSG.shotHit, payload);
      } else if (shot.remaining <= 0.01) {
        this.shots.delete(shot.id);
      }
    }
  }

  /** First player crossed by the shot along the next `step` px (sampled every few px, so fast shots cannot skip a body). */
  private shotHit(shot: Shot, step: number): { sessionId: string; x: number; y: number } | null {
    const samples = Math.max(1, Math.ceil(step / SHOT_TRACE_STEP));
    for (let i = 1; i <= samples; i++) {
      const px = shot.x + shot.dx * step * (i / samples), py = shot.y + shot.dy * step * (i / samples);
      let found = null as { sessionId: string; x: number; y: number } | null;
      this.host.state.players.forEach((player, sessionId) => {
        if (found || player.currentBoardId || player.hp <= 0 || this.host.isDead(sessionId)) return;
        if (this.geometry.inSafeZone(player.x, player.y)) return; // the shot stops at the border; a body leaning over it is still safe
        // ground-level point against the player's standing hurtbox (feet at y, body above), grown by the shot radius —
        // the same fallback rectangle the bite uses (composed characters carry no per-character hurtbox config)
        const inX = Math.abs(px - player.x) <= 18 + ANIMAL_SHOT_RADIUS;
        const inY = py >= player.y - 48 - ANIMAL_SHOT_RADIUS && py <= player.y + ANIMAL_SHOT_RADIUS;
        if (inX && inY) found = { sessionId, x: px, y: py };
      });
      if (found) return found;
    }
    return null;
  }

  onSwingFrame(sessionId: string, rects: LocalRectangle[], swingId: number): void {
    for (const animal of this.runtime.values()) {
      if (animal.state.dead || animal.hitSwings.has(`${sessionId}:${swingId}`)) continue;
      void this.testMeleeHit(animal, sessionId, rects, swingId);
    }
  }

  private async testMeleeHit(animal: RuntimeAnimal, sessionId: string, rects: LocalRectangle[], swingId: number): Promise<void> {
    const parsed = parseVariantId(animal.state.variantId);
    if (!parsed) return;
    const rig = await getRigCached(rigIdForAnimal(parsed.category, parsed.animal));
    if (animal.state.dead) return;
    const anim = rig?.animationConfigs[animal.state.anim] ?? rig?.animationConfigs.idle;
    const frames = anim?.directions[ANIMAL_DIRECTIONS[animal.state.dir]]?.frames ?? {};
    const local = Object.values(frames).flatMap((f) => f.hurtbox.enabled ? f.hurtbox.rectangles : []);
    const hurt = (local.length ? local : [ANIMAL_DEFAULT_HURTBOX]).map((r) => this.worldRect(r, animal.state.x, animal.state.y));
    if (!rects.some((a) => hurt.some((b) => rectanglesIntersect(a, b)))) return;
    const key = `${sessionId}:${swingId}`;
    if (animal.hitSwings.has(key)) return;
    animal.hitSwings.add(key);
    await this.applyPlayerHit(animal, sessionId);
  }

  private worldRect(rect: { x: number; y: number; width: number; height: number }, x: number, y: number): LocalRectangle {
    return { x: x + rect.x, y: y + rect.y, width: rect.width, height: rect.height };
  }

  async arrowHit(client: Client, data: unknown): Promise<void> {
    const body = data as { requestId?: unknown; animalId?: unknown };
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const animal = typeof body.animalId === 'string' ? this.runtime.get(body.animalId) : undefined;
    const swing = this.host.lastSwing(client.sessionId);
    const player = this.host.state.players.get(client.sessionId);
    if (!animal || animal.state.dead || !player || !swing || swing.movement !== 'shoot' || Date.now() - swing.at > ARROW_WINDOW_MS) {
      return this.result(client, requestId, false, 'Flecha inválida ou fora de tempo');
    }
    if (this.consumedShots.get(client.sessionId) === swing.at) {
      return this.result(client, requestId, false, 'Esta flecha já atingiu um animal');
    }
    this.consumedShots.set(client.sessionId, swing.at);
    const key = `${client.sessionId}:${swing.at}`;
    if (animal.hitSwings.has(key)) {
      this.consumedShots.delete(client.sessionId);
      return this.result(client, requestId, false, 'Animal já atingido neste disparo');
    }
    animal.hitSwings.add(key);
    const weapon = parseWeaponRef(player.equippedWeapon);
    if (!weapon || weapon.category !== 'weapon') {
      animal.hitSwings.delete(key);
      this.consumedShots.delete(client.sessionId);
      return this.result(client, requestId, false, 'Só arma principal ou mão');
    }
    const families = await getWeaponFamiliesCached();
    if (animal.state.dead || this.host.state.players.get(client.sessionId) !== player) return;
    // The server has no generator-manifest pairing helper. Require projectile
    // metadata both on the shooter family and on the canonical arrow family.
    const variantId = weapon.variantId ?? 'default';
    const shooterProjectile = getWeaponVariantProjectile(families[weapon.familyId] ?? null, variantId);
    const projectile = getWeaponVariantProjectile(families[BIGCHESS_ARROW_FAMILY_ID] ?? null, variantId);
    if (!shooterProjectile || !projectile) {
      animal.hitSwings.delete(key);
      this.consumedShots.delete(client.sessionId);
      return this.result(client, requestId, false, 'A arma equipada não dispara projéteis');
    }
    const range = projectile.rangePx;
    if (Math.hypot(player.x - animal.state.x, player.y - animal.state.y) > range) {
      animal.hitSwings.delete(key);
      this.consumedShots.delete(client.sessionId);
      return this.result(client, requestId, false, 'Longe demais');
    }
    const ok = await this.applyPlayerHit(animal, client.sessionId, true);
    if (!ok && this.consumedShots.get(client.sessionId) === swing.at) this.consumedShots.delete(client.sessionId);
    this.result(client, requestId, ok, ok ? undefined : 'Só arma principal ou mão');
  }

  private async damageFor(player: PlayerState, shoot = false): Promise<number | null> {
    const weapon = parseWeaponRef(player.equippedWeapon);
    if (!weapon) return this.config.general.handDamage;
    if (weapon.category === 'crafttools') return null;
    const families = await getWeaponFamiliesCached();
    const variantId = weapon.variantId ?? 'default';
    const weaponDamage = resolveWeaponLevelStats(families[weapon.familyId] ?? null, variantId, 1).damage;
    if (!shoot) return weaponDamage;
    return resolveWeaponLevelStats(families[BIGCHESS_ARROW_FAMILY_ID] ?? null, variantId, 1, weaponDamage).damage;
  }

  private async applyPlayerHit(animal: RuntimeAnimal, sessionId: string, shoot = false): Promise<boolean> {
    const player = this.host.state.players.get(sessionId);
    if (!player || animal.state.dead) return false;
    const damage = await this.damageFor(player, shoot);
    if (this.host.state.players.get(sessionId) !== player || animal.state.dead || damage === null || damage <= 0) return false;
    animal.lastAttackerSessionId = sessionId;
    if (animal.targetSessionId !== sessionId || animal.mode === 'wander' || animal.mode === 'rooted' || animal.mode === 'return') {
      this.acquireTarget(animal, sessionId, player, Date.now(), this.profileFor(animal));
    }
    animal.state.hp = Math.max(0, animal.state.hp - Math.round(damage));
    this.host.broadcast(HUNT_MSG.animalHit, { animalId: animal.state.id, damage, hp: animal.state.hp, bySessionId: sessionId });
    if (animal.state.hp <= 0) await this.killAnimal(animal, sessionId);
    return true;
  }

  private async killAnimal(animal: RuntimeAnimal, killerSessionId: string): Promise<void> {
    if (animal.state.dead) return;
    animal.state.dead = true;
    animal.state.anim = 'idle';
    const killer = this.host.state.players.get(killerSessionId);
    if (killer && animal.variant.xpEnabled) void progressService.grantSkillXp(killer.id, 'hunting', animal.variant.xp);
    if (killer) this.client(killerSessionId)?.send(HUNT_MSG.event, { type: 'kill', message: `${animal.variant.name} abatido`, xp: animal.variant.xp, animalName: animal.variant.name });
    if (animal.state.contractOwner) await this.onContractKill(animal, killer?.id ?? '');
    const parsed = parseVariantId(animal.state.variantId);
    const cooldown = parsed?.category === 'hunts' ? this.config.general.huntsRespawnSeconds : animal.variant.respawnCooldownSeconds;
    const variantId = animal.state.variantId, ambient = animal.ambient;
    this.schedule(`fade:${animal.state.id}`, 1500, () => this.removeAnimal(animal.state.id));
    if (ambient) {
      this.pendingAmbient.set(variantId, (this.pendingAmbient.get(variantId) ?? 0) + 1);
      this.schedule(`ambient:${variantId}`, cooldown * 1000, () => {
        const pending = Math.max(0, (this.pendingAmbient.get(variantId) ?? 1) - 1);
        if (pending) this.pendingAmbient.set(variantId, pending);
        else this.pendingAmbient.delete(variantId);
        const alive = [...this.runtime.values()].filter((a) => a.ambient && !a.state.dead && a.state.variantId === variantId).length;
        if (!this.destroyed && this.config.general.enabled && this.config.variants[variantId] && this.runtime.size < MAX_ANIMALS &&
          alive < (this.ambientDesired.get(variantId) ?? 0)) this.spawnAnimal(variantId, '', true);
      });
    }
  }

  private client(sessionId: string): Client | undefined { return this.host.clients.find((c) => c.sessionId === sessionId); }
  private sessionForUser(userId: string): string | null {
    let found: string | null = null;
    this.host.state.players.forEach((p, sid) => { if (p.id === userId) found = sid; });
    return found;
  }
  private result(client: Client, requestId: string, ok: boolean, error?: string): void {
    client.send(HUNT_MSG.requestResult, { requestId, ok, ...(error ? { error } : {}) });
  }

  async onJoin(client: Client): Promise<void> {
    const player = this.host.state.players.get(client.sessionId);
    if (!player) return;
    const loaded = await getPlayerHunting(player.id);
    if (this.host.state.players.get(client.sessionId) !== player) return;
    this.records.set(player.id, loaded.record);
    this.tableMissing.set(player.id, loaded.tableMissing);
    const active = loaded.record.active;
    if (active && active.deadline < Date.now()) {
      await this.cancelContract(player, 'expired', '', client);
      return;
    }
    this.sendState(client, loaded.record);
    this.topUpContract(player.id, 'batch');
  }

  onLeave(sessionId: string, userId: string): void {
    this.consumedShots.delete(sessionId);
    this.cancelTimers(`contract:${userId}`);
    for (const animal of [...this.runtime.values()]) if (animal.state.contractOwner === userId) this.removeAnimal(animal.state.id);
  }

  async npcTalk(client: Client): Promise<void> {
    const player = this.host.state.players.get(client.sessionId);
    if (!player) return;
    // Reserve the hold before loading persistence so rapid talks cannot move the NPC.
    this.npcTalkUntil = Date.now() + NPC_TALK_HOLD_MS;
    const npc = this.host.state.npcs.get(NPC_BARBARIAN_ID);
    if (npc) { npc.isMoving = false; npc.dir = 0; }
    const record = this.records.get(player.id) ?? (await getPlayerHunting(player.id)).record;
    if (this.host.state.players.get(client.sessionId) !== player) return;
    this.records.set(player.id, record);
    const now = Date.now();
    client.send(HUNT_MSG.contracts, {
      now, active: this.activeView(record),
      tableMissing: this.tableMissing.get(player.id) ?? false,
      contracts: this.config.contracts.filter((c) => c.enabled).map((c) => ({
        ...c, animalName: this.config.variants[c.variantId]?.name ?? c.variantId,
        availability: record.active?.contractId === c.id ? 'active'
          : record.active ? 'busy' : (record.locks[c.id] ?? 0) > now ? 'locked' : 'available',
        ...((record.locks[c.id] ?? 0) > now ? { lockedUntil: record.locks[c.id] } : {}),
      })),
    });
  }

  async accept(client: Client, data: unknown): Promise<void> {
    const body = data as { requestId?: unknown; contractId?: unknown };
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const contract = typeof body.contractId === 'string' ? this.config.contracts.find((c) => c.id === body.contractId && c.enabled) : undefined;
    const player = this.host.state.players.get(client.sessionId);
    if (!player || !contract || !this.nearNpc(player)) return this.result(client, requestId, false, 'Contrato inválido ou longe do bárbaro');
    const seq = (this.mutationSeq.get(player.id) ?? 0) + 1;
    this.mutationSeq.set(player.id, seq);
    const record = this.records.get(player.id) ?? (await getPlayerHunting(player.id)).record;
    if (this.mutationSeq.get(player.id) !== seq || this.host.state.players.get(client.sessionId) !== player) return;
    if (record.active || (record.locks[contract.id] ?? 0) > Date.now()) return this.result(client, requestId, false, 'Contrato indisponível');
    const next: PlayerHuntingRecord = { active: {
      contractId: contract.id, variantId: contract.variantId, quantity: contract.quantity, killed: 0,
      acceptedAt: Date.now(), deadline: Date.now() + contract.timeLimitMinutes * 60_000, region: this.host.region,
    }, locks: { ...record.locks } };
    const saved = await updateIfActiveMatches(player.id, null, next);
    if (!saved.ok) return this.result(client, requestId, false, saved.error ?? 'Falha ao salvar contrato');
    if (!saved.matched) {
      this.sendState(client, await this.reloadPlayerRecord(player.id));
      return this.result(client, requestId, false, 'Contrato já processado');
    }
    this.records.set(player.id, next);
    this.tableMissing.set(player.id, saved.tableMissing);
    this.topUpContract(player.id, 'batch');
    this.sendState(client, next);
    this.result(client, requestId, true);
  }

  async claim(client: Client, data: unknown): Promise<void> {
    const requestId = typeof (data as { requestId?: unknown })?.requestId === 'string' ? (data as { requestId: string }).requestId : '';
    const player = this.host.state.players.get(client.sessionId);
    const record = player ? this.records.get(player.id) : undefined;
    const active = record?.active;
    const contract = active ? this.config.contracts.find((c) => c.id === active.contractId) : undefined;
    if (!player || !record || !active || !contract) return this.result(client, requestId, false, 'Contrato ainda não pode ser resgatado');
    if (active.deadline < Date.now()) {
      await this.cancelContract(player, 'expired', '', client);
      return this.result(client, requestId, false, 'Contrato expirado');
    }
    if (active.killed < active.quantity || !this.nearNpc(player)) return this.result(client, requestId, false, 'Contrato ainda não pode ser resgatado');
    const next: PlayerHuntingRecord = { active: null, locks: { ...record.locks, [contract.id]: Date.now() + contract.cooldownHours * 3600_000 } };
    const saved = await updateIfActiveMatches(player.id, active.contractId, next);
    if (!saved.ok) return this.result(client, requestId, false, saved.error ?? 'Falha ao salvar contrato');
    if (!saved.matched) {
      this.sendState(client, await this.reloadPlayerRecord(player.id));
      return this.result(client, requestId, false, 'Contrato já processado');
    }
    this.records.set(player.id, next);
    await progressService.grantSkillXp(player.id, 'hunting', contract.xpReward);
    const wallet = await addCrowns(player.id, contract.crownsReward);
    if (wallet.ok) client.send('wallet_update', { crowns: wallet.crowns });
    client.send(HUNT_MSG.event, { type: 'claimed', message: 'Recompensa recebida', xp: contract.xpReward, crowns: contract.crownsReward });
    this.sendState(client, next); this.result(client, requestId, true);
  }

  async abandon(client: Client, data: unknown): Promise<void> {
    const requestId = typeof (data as { requestId?: unknown })?.requestId === 'string' ? (data as { requestId: string }).requestId : '';
    const player = this.host.state.players.get(client.sessionId);
    if (!player) return;
    await this.cancelContract(player, 'abandoned', requestId, client);
  }

  onPlayerDied(sessionId: string): void {
    const player = this.host.state.players.get(sessionId);
    if (player) void this.cancelContract(player, 'cancelled_death', '', this.client(sessionId));
  }

  private async cancelContract(player: PlayerState, type: 'abandoned' | 'expired' | 'cancelled_death', requestId = '', client?: Client): Promise<void> {
    const record = this.records.get(player.id), active = record?.active;
    if (!record || !active) return client && this.result(client, requestId, false, 'Nenhum contrato ativo');
    // a failed/abandoned contract is NOT locked: the reopen cooldown only starts when the reward is claimed
    const next: PlayerHuntingRecord = { active: null, locks: { ...record.locks } };
    const saved = await updateIfActiveMatches(player.id, active.contractId, next);
    if (!saved.ok) return client && this.result(client, requestId, false, saved.error ?? 'Falha ao salvar contrato');
    if (!saved.matched) {
      const current = await this.reloadPlayerRecord(player.id);
      if (client) this.sendState(client, current);
      return client && this.result(client, requestId, false, 'Contrato já processado');
    }
    this.records.set(player.id, next);
    for (const animal of [...this.runtime.values()]) if (animal.state.contractOwner === player.id) this.removeAnimal(animal.state.id);
    const reason = type === 'expired' ? 'Prazo do contrato esgotado' : type === 'abandoned' ? 'Contrato abandonado' : 'Contrato cancelado pela morte';
    client?.send(HUNT_MSG.event, { type, message: `${reason} — fale com o bárbaro para aceitá-lo de novo` });
    if (client) { this.sendState(client, next); if (requestId) this.result(client, requestId, true); }
  }

  private async expireContracts(): Promise<void> {
    const now = Date.now();
    for (const [userId, record] of this.records) {
      if (!record.active || record.active.deadline > now) continue;
      const sid = this.sessionForUser(userId), player = sid ? this.host.state.players.get(sid) : undefined;
      if (player) void this.cancelContract(player, 'expired', '', this.client(sid!));
    }
  }

  private async onContractKill(animal: RuntimeAnimal, killerId: string): Promise<void> {
    const owner = animal.state.contractOwner;
    const current = this.records.get(owner)?.active;
    if (!current || current.variantId !== animal.state.variantId || current.deadline < Date.now()) {
      const sid = this.sessionForUser(owner), player = sid ? this.host.state.players.get(sid) : undefined;
      if (player && current?.deadline && current.deadline < Date.now()) void this.cancelContract(player, 'expired', '', this.client(sid!));
      return;
    }
    if (killerId !== owner) {
      // stolen kill: the owner's quota is untouched, so the animal is replaced (back to the batch size) in 5 s
      this.schedule(`contract:${owner}`, 5000, () => this.topUpContract(owner, 'replace'));
      return;
    }
    const previous = this.recordQueues.get(owner) ?? Promise.resolve();
    const queued = previous.then(() => this.applyContractKill(owner, animal.state.variantId));
    this.recordQueues.set(owner, queued);
    await queued.finally(() => {
      if (this.recordQueues.get(owner) !== queued) return;
      this.recordQueues.delete(owner);
      // only once every queued kill is persisted (simultaneous kills would otherwise size the batch from stale progress)
      this.topUpContract(owner, 'batch');
    });
  }

  private async applyContractKill(owner: string, variantId: string): Promise<void> {
    const snapshot = this.records.get(owner)?.active;
    if (!snapshot || snapshot.variantId !== variantId) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const record = this.records.get(owner);
      const active = record?.active;
      // same activation only: a cancelled, claimed or re-accepted contract never receives this kill
      if (!record || !active || active.contractId !== snapshot.contractId || active.acceptedAt !== snapshot.acceptedAt) return;
      const next: PlayerHuntingRecord = { active: { ...active, killed: Math.min(active.quantity, active.killed + 1) }, locks: { ...record.locks } };
      // CAS on activation + progress: a stale snapshot can neither lose a kill nor resurrect the contract
      const saved = await updateIfActiveMatches(owner, active.contractId, next, { acceptedAt: active.acceptedAt, killed: active.killed });
      if (!saved.ok) return;
      if (!saved.matched) { await this.reloadPlayerRecord(owner); continue; }
      this.records.set(owner, next);
      const sid = this.sessionForUser(owner), client = sid ? this.client(sid) : undefined;
      const complete = next.active!.killed >= next.active!.quantity;
      client?.send(HUNT_MSG.event, { type: complete ? 'completed' : 'progress', message: complete ? 'Contrato completo' : 'Progresso atualizado', killed: next.active!.killed, quantity: next.active!.quantity });
      if (client) this.sendState(client, next);
      return;
    }
  }

  /**
   * Spawns contract animals for a CONNECTED owner, at anchors away from them. The batch size comes
   * from contractSpawnBatch (initial share of the quota, then `refillBatch` at a time, capped by what
   * is left to kill). Mode 'batch' (accept, join, config reload, after the owner's kills are persisted)
   * spawns only when none is alive — the next batch appears once every spawned animal is dead. Mode
   * 'replace' (an animal stolen by another player) fills the batch back up to its size.
   */
  private topUpContract(owner: string, mode: 'batch' | 'replace'): void {
    const active = this.records.get(owner)?.active;
    if (this.destroyed || !this.config.general.enabled || !active || active.region !== this.host.region || active.deadline < Date.now()) return;
    if (!this.config.variants[active.variantId]) return;
    // a kill still being persisted tops up itself once it lands (sizing from stale progress would overshoot the quota)
    if (this.recordQueues.has(owner)) return;
    const sid = this.sessionForUser(owner), player = sid ? this.host.state.players.get(sid) : undefined;
    if (!player) return; // the owner's animals leave the room with them (onLeave)
    const alive = [...this.runtime.values()].filter((a) => !a.state.dead && a.state.contractOwner === owner).length;
    if (mode === 'batch' && alive > 0) return;
    const contract = this.config.contracts.find((c) => c.id === active.contractId);
    const batch = contractSpawnBatch(
      { initialPercent: contract?.initialPercent ?? DEFAULT_CONTRACT_INITIAL_PERCENT, refillBatch: contract?.refillBatch ?? DEFAULT_CONTRACT_REFILL_BATCH },
      active,
    );
    for (let i = alive; i < batch; i++) if (!this.spawnAnimal(active.variantId, owner, false, { x: player.x, y: player.y })) break;
  }

  private async reloadPlayerRecord(userId: string): Promise<PlayerHuntingRecord> {
    const loaded = await getPlayerHunting(userId);
    this.records.set(userId, loaded.record);
    this.tableMissing.set(userId, loaded.tableMissing);
    return loaded.record;
  }

  private activeView(record: PlayerHuntingRecord) {
    const a = record.active;
    if (!a) return null;
    const c = this.config.contracts.find((x) => x.id === a.contractId);
    return {
      contractId: a.contractId, variantId: a.variantId,
      animalName: this.config.variants[a.variantId]?.name ?? a.variantId,
      quantity: a.quantity, killed: a.killed, acceptedAt: a.acceptedAt, deadline: a.deadline,
      xpReward: c?.xpReward ?? 0, crownsReward: c?.crownsReward ?? 0, complete: a.killed >= a.quantity,
    };
  }
  private sendState(client: Client, record: PlayerHuntingRecord): void {
    client.send(HUNT_MSG.state, { active: this.activeView(record), now: Date.now() });
  }
  private nearNpc(player: PlayerState): boolean {
    const npc = this.host.state.npcs.get(NPC_BARBARIAN_ID);
    return !!npc && Math.hypot(player.x - npc.x, player.y - npc.y) <= this.config.general.npcInteractRadius;
  }

  private moveNpc(dt: number, now: number): void {
    const npc = this.host.state.npcs.get(NPC_BARBARIAN_ID);
    if (!npc) return;
    if (now < this.npcTalkUntil || now < this.npcPauseUntil) { npc.isMoving = false; if (now < this.npcTalkUntil) npc.dir = 0; return; }
    if (!this.npcTarget || Math.hypot(this.npcTarget.x - npc.x, this.npcTarget.y - npc.y) < 6) {
      const z = this.geometry.safeZone;
      for (let i = 0; i < 20; i++) {
        const x = randomBetween(z.x + 24, z.x + z.width - 24), y = randomBetween(z.y + 24, z.y + z.height - 24);
        if (this.geometry.segmentWalkable(npc.x, npc.y, x, y, (px, py) => this.geometry.isWalkableForNpc(px, py))) {
          this.npcTarget = { x, y }; break;
        }
      }
      this.npcPauseUntil = now + randomBetween(2000, 6000);
      npc.isMoving = false;
      return;
    }
    const dx = this.npcTarget.x - npc.x, dy = this.npcTarget.y - npc.y, len = Math.max(1, Math.hypot(dx, dy));
    const step = Math.min(len, NPC_WALK_SPEED * dt), nx = npc.x + dx / len * step, ny = npc.y + dy / len * step;
    const walkable = (x: number, y: number) => this.geometry.isWalkableForNpc(x, y);
    if (this.geometry.segmentWalkable(npc.x, npc.y, nx, ny, walkable, 8)) {
      npc.x = nx; npc.y = ny;
    } else if (this.geometry.segmentWalkable(npc.x, npc.y, nx, npc.y, walkable, 8)) {
      npc.x = nx;
    } else if (this.geometry.segmentWalkable(npc.x, npc.y, npc.x, ny, walkable, 8)) {
      npc.y = ny;
    } else {
      this.npcTarget = null; npc.isMoving = false; return;
    }
    npc.isMoving = true;
    const dir = animalDirectionFromVector(dx, dy);
    npc.dir = NPC_DIRECTION_ORDER.indexOf(dir);
  }

  destroy(): void {
    this.destroyed = true;
    for (const interval of this.intervals) interval.clear?.();
    this.intervals.clear();
    for (const group of this.timers.values()) for (const timer of group) timer.clear?.();
    this.timers.clear();
    this.pendingAmbient.clear();
    this.consumedShots.clear();
    this.shots.clear();
    this.runtime.clear();
    this.host.state.animals.clear();
    this.host.state.npcs.clear();
  }
}