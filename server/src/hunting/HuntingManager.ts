import type { Client } from '@colyseus/core';
import type { WorldState } from '../schemas/WorldState.js';
import type { PlayerState } from '../schemas/PlayerState.js';
import { AnimalState } from '../schemas/AnimalState.js';
import { NpcState } from '../schemas/NpcState.js';
import {
  ANIMAL_ATTACK_DURATION_MS,
  ANIMAL_ATTACK_HIT_FRAMES,
  ANIMAL_BITE_RANGE,
  ANIMAL_DEFAULT_HITBOX,
  ANIMAL_DEFAULT_HURTBOX,
  ANIMAL_DIRECTIONS,
  ANIMAL_WANDER_SPEED_FACTOR,
  HUNTING_LEVEL_PROFILES,
  HUNT_MSG,
  MONSTER_TREE_ANIMAL_KEY,
  NPC_BARBARIAN_ID,
  NPC_DIRECTION_ORDER,
  NPC_TALK_HOLD_MS,
  NPC_WALK_SPEED,
  animalDirectionFromVector,
  parseVariantId,
  rigIdForAnimal,
  rollSpawnCount,
  runSpeedFor,
  type AnimalVariantConfig,
  type HuntingConfig,
  type HuntingContractConfig,
  type PlayerHuntingRecord,
} from '../shared/hunting/HuntingShapes.js';
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
import { getPlayerHunting, updateIfActiveMatches, upsertPlayerHunting } from './playerHuntingRepository.js';

type AiMode = 'rooted' | 'return' | 'wander' | 'alert' | 'chase' | 'attack' | 'retreat';
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
  hitSwings: Set<string>;
  ambient: boolean;
  treeAnchor?: string;
  treeAnchorX?: number;
  treeAnchorY?: number;
  regenStartedAt: number;
  regenStartHp: number;
}

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
  private readonly pendingAmbient = new Map<string, number>();
  private readonly ambientDesired = new Map<string, number>();
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
      this.host.state.npcs.delete(NPC_BARBARIAN_ID);
      return;
    }
    this.reconcileAmbient();
    this.spawnNpc();
  }

  private reconcileAmbient(): void {
    const desired = new Map<string, number>();
    for (const [variantId, variant] of Object.entries(this.config.variants)) desired.set(variantId, rollSpawnCount(variant));
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

  private anchorPoint(anchors: readonly MapAnchor[], npc = false, usedName?: Set<string>): { x: number; y: number; name: string } | null {
    const candidates = usedName ? anchors.filter((a) => !usedName.has(a.name)) : [...anchors];
    for (let i = 0; i < 30 && candidates.length; i++) {
      const anchor = candidates[Math.floor(Math.random() * candidates.length)];
      const x = anchor.x + randomBetween(-40, 40), y = anchor.y + randomBetween(-40, 40);
      if (npc ? this.geometry.isWalkableForNpc(x, y) : this.geometry.isWalkableForAnimal(x, y)) return { x, y, name: anchor.name };
    }
    return null;
  }

  private spawnAnimal(variantId: string, owner = '', ambient = false): RuntimeAnimal | null {
    if (this.runtime.size >= MAX_ANIMALS) return null;
    const variant = this.config.variants[variantId];
    const parsed = parseVariantId(variantId);
    if (!variant || !parsed) return null;
    const isTree = parsed.animalKey === MONSTER_TREE_ANIMAL_KEY;
    const anchors = isTree ? CRAFTING_WORLD_MAP.monsterTreeAnchors
      : parsed.category === 'residents' ? CRAFTING_WORLD_MAP.residentAnchors : CRAFTING_WORLD_MAP.huntAnchors;
    const used = isTree ? new Set([...this.runtime.values()].map((a) => a.treeAnchor).filter((x): x is string => !!x)) : undefined;
    const point = this.anchorPoint(anchors, false, used);
    if (!point) return null;
    const id = `animal-${Date.now().toString(36)}-${++this.idCounter}`;
    const state = new AnimalState();
    Object.assign(state, {
      id, variantId, name: variant.name, x: point.x, y: point.y, dir: 0,
      anim: 'idle', hp: variant.hp, maxHp: variant.hp, level: variant.level,
      dead: false, contractOwner: owner,
    });
    const rt: RuntimeAnimal = {
      state, variant, mode: isTree ? 'rooted' : 'wander', targetSessionId: '',
      lastAttackerSessionId: '', targetX: point.x, targetY: point.y,
      pauseUntil: Date.now() + randomBetween(1000, 4000), reactAt: 0,
      nextAttackAt: 0, hitSwings: new Set(), ambient, treeAnchor: isTree ? point.name : undefined,
      treeAnchorX: isTree ? point.x : undefined, treeAnchorY: isTree ? point.y : undefined,
      regenStartedAt: 0, regenStartHp: variant.hp,
    };
    this.runtime.set(id, rt);
    this.host.state.animals.set(id, state);
    return rt;
  }

  private removeAnimal(id: string): void {
    this.cancelTimers(`animal:${id}`);
    this.cancelTimers(`fade:${id}`);
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
      this.moveAnimal(animal, dtMs / 1000, now);
    }
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

  private decide(animal: RuntimeAnimal, now: number): void {
    const parsed = parseVariantId(animal.state.variantId);
    const profile = HUNTING_LEVEL_PROFILES[animal.variant.level];
    let target = animal.targetSessionId ? this.host.state.players.get(animal.targetSessionId) : undefined;
    if (target && (target.currentBoardId || target.hp <= 0 || this.host.isDead(animal.targetSessionId))) target = undefined;
    if (target && Math.hypot(target.x - animal.state.x, target.y - animal.state.y) > animal.variant.combatBreakDistance * profile.persistence) target = undefined;
    if (!target) {
      animal.targetSessionId = '';
      if (parsed?.animalKey === MONSTER_TREE_ANIMAL_KEY) {
        const atAnchor = Math.hypot((animal.treeAnchorX ?? animal.state.x) - animal.state.x, (animal.treeAnchorY ?? animal.state.y) - animal.state.y) < 8;
        animal.mode = atAnchor ? 'rooted' : 'return';
        animal.targetX = animal.treeAnchorX ?? animal.state.x;
        animal.targetY = animal.treeAnchorY ?? animal.state.y;
        this.regen(animal, 100, now);
        return;
      }
      const nearest = this.nearestPlayer(animal.state.x, animal.state.y, parsed?.category === 'hunts' ? 260 : animal.variant.radius);
      if (nearest && (parsed?.category === 'hunts' || animal.variant.reaction === 'radius')) {
        animal.targetSessionId = nearest[0];
        animal.reactAt = now + profile.reactionMs;
        animal.mode = 'alert';
        target = nearest[1];
      }
    }
    if (!target) {
      if (parsed?.animalKey !== MONSTER_TREE_ANIMAL_KEY) animal.mode = 'wander';
      this.regen(animal, 100, now);
      return;
    }
    if (animal.state.hp / animal.state.maxHp < profile.retreatHpRatio) animal.mode = 'retreat';
    if (animal.mode === 'retreat') {
      animal.state.hp = Math.min(animal.state.maxHp, animal.state.hp + animal.state.maxHp * 0.01);
      if (animal.state.hp / animal.state.maxHp >= profile.reengageHpRatio) animal.mode = 'chase';
      animal.targetX = animal.state.x - (target.x - animal.state.x);
      animal.targetY = animal.state.y - (target.y - animal.state.y);
      return;
    }
    if (now < animal.reactAt) return;
    const distance = Math.hypot(target.x - animal.state.x, target.y - animal.state.y);
    if (distance <= ANIMAL_BITE_RANGE && now >= animal.nextAttackAt && Math.random() <= profile.aggression) {
      animal.mode = 'attack';
      animal.state.anim = 'attack';
      animal.nextAttackAt = now + profile.attackCooldownMs;
      const hitDelay = (ANIMAL_ATTACK_HIT_FRAMES[0] / 10) * 1000;
      this.schedule(`animal:${animal.state.id}`, hitDelay, () => void this.bite(animal));
      this.schedule(`animal:${animal.state.id}`, ANIMAL_ATTACK_DURATION_MS, () => {
        if (!animal.state.dead && animal.mode === 'attack') animal.mode = 'chase';
      });
    } else if (animal.mode !== 'attack') {
      animal.mode = 'chase';
      const swing = this.host.lastSwing(animal.targetSessionId);
      if (swing && now - swing.at < 250 && Math.random() < profile.dodgeChance) {
        const dx = target.x - animal.state.x, dy = target.y - animal.state.y;
        const len = Math.max(1, Math.hypot(dx, dy)), side = Math.random() < .5 ? -1 : 1;
        animal.targetX = animal.state.x + (-dy / len) * randomBetween(40, 80) * side;
        animal.targetY = animal.state.y + (dx / len) * randomBetween(40, 80) * side;
      } else {
        if (Math.random() < profile.flankChance) {
          const angle = Math.atan2(target.y - animal.state.y, target.x - animal.state.x) + (Math.random() < .5 ? -.7 : .7);
          animal.targetX = target.x - Math.cos(angle) * ANIMAL_BITE_RANGE;
          animal.targetY = target.y - Math.sin(angle) * ANIMAL_BITE_RANGE;
        } else {
          animal.targetX = target.x;
          animal.targetY = target.y;
        }
      }
    }
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

  private moveAnimal(animal: RuntimeAnimal, dt: number, now: number): void {
    if (animal.mode === 'rooted' || animal.mode === 'alert' || animal.mode === 'attack') {
      if (animal.mode !== 'attack') animal.state.anim = 'idle';
      return;
    }
    if (animal.mode === 'wander' && (now < animal.pauseUntil || Math.hypot(animal.targetX - animal.state.x, animal.targetY - animal.state.y) < 12)) {
      animal.state.anim = 'idle';
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
      animal.state.anim = 'idle';
      return;
    }
    if (len < 1) return;
    const speed = runSpeedFor(animal.variant) * (animal.mode === 'wander' ? ANIMAL_WANDER_SPEED_FACTOR : 1);
    const step = Math.min(len, speed * dt), nx = animal.state.x + dx / len * step, ny = animal.state.y + dy / len * step;
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
    }
    animal.state.dir = ANIMAL_DIRECTIONS.indexOf(animalDirectionFromVector(dx, dy));
    animal.state.anim = animal.mode === 'wander' ? 'walk' : 'run';
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
    animal.targetSessionId = sessionId;
    animal.lastAttackerSessionId = sessionId;
    animal.mode = 'alert';
    animal.reactAt = Date.now() + HUNTING_LEVEL_PROFILES[animal.variant.level].reactionMs;
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
    if (active && active.region === this.host.region) this.ensureContractPopulation(player.id, active.variantId, active.quantity - active.killed);
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
    this.ensureContractPopulation(player.id, contract.variantId, contract.quantity);
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
    const contract = this.config.contracts.find((c) => c.id === active.contractId);
    const next: PlayerHuntingRecord = {
      active: null,
      locks: { ...record.locks, [active.contractId]: Date.now() + (contract?.cooldownHours ?? 0) * 3600_000 },
    };
    const saved = await updateIfActiveMatches(player.id, active.contractId, next);
    if (!saved.ok) return client && this.result(client, requestId, false, saved.error ?? 'Falha ao salvar contrato');
    if (!saved.matched) {
      const current = await this.reloadPlayerRecord(player.id);
      if (client) this.sendState(client, current);
      return client && this.result(client, requestId, false, 'Contrato já processado');
    }
    this.records.set(player.id, next);
    for (const animal of [...this.runtime.values()]) if (animal.state.contractOwner === player.id) this.removeAnimal(animal.state.id);
    client?.send(HUNT_MSG.event, { type, message: type === 'expired' ? 'Contrato expirado' : type === 'abandoned' ? 'Contrato abandonado' : 'Contrato cancelado pela morte' });
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
      const variantId = animal.state.variantId;
      this.schedule(`contract:${owner}`, 5000, () => {
        const active = this.records.get(owner)?.active;
        if (!this.destroyed && this.config.general.enabled && this.config.variants[variantId] && this.runtime.size < MAX_ANIMALS &&
          active?.variantId === variantId && active.region === this.host.region && active.deadline >= Date.now()) {
          this.spawnAnimal(variantId, owner);
        }
      });
      return;
    }
    const previous = this.recordQueues.get(owner) ?? Promise.resolve();
    const queued = previous.then(() => this.applyContractKill(owner, animal.state.variantId));
    this.recordQueues.set(owner, queued);
    await queued.finally(() => {
      if (this.recordQueues.get(owner) === queued) this.recordQueues.delete(owner);
    });
  }

  private async applyContractKill(owner: string, variantId: string): Promise<void> {
    const record = this.records.get(owner);
    if (!record?.active || record.active.variantId !== variantId) return;
    const next: PlayerHuntingRecord = { active: { ...record.active, killed: Math.min(record.active.quantity, record.active.killed + 1) }, locks: { ...record.locks } };
    const saved = await upsertPlayerHunting(owner, next);
    if (!saved.ok) return;
    this.records.set(owner, next);
    const sid = this.sessionForUser(owner), client = sid ? this.client(sid) : undefined;
    const complete = next.active!.killed >= next.active!.quantity;
    client?.send(HUNT_MSG.event, { type: complete ? 'completed' : 'progress', message: complete ? 'Contrato completo' : 'Progresso atualizado', killed: next.active!.killed, quantity: next.active!.quantity });
    if (client) this.sendState(client, next);
  }

  private ensureContractPopulation(owner: string, variantId: string, count: number): void {
    const existing = [...this.runtime.values()].filter((a) => !a.state.dead && a.state.contractOwner === owner).length;
    for (let i = existing; i < count; i++) this.spawnAnimal(variantId, owner);
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
    this.runtime.clear();
    this.host.state.animals.clear();
    this.host.state.npcs.clear();
  }
}