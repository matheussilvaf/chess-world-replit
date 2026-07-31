/**
 * Server-authoritative combat resolution.
 *
 * The client only sends an attack *intent* ({ movement, direction }). The
 * server validates it, schedules the attack timeline at 12 fps with
 * clock.setTimeout, and at every frame that has hitboxes rect-intersects the
 * attacker's hitboxes against every other player's hurtbox union.
 *
 * Documented approximation: the server cannot know the exact visual frame a
 * remote client is rendering, so the target's damageable area is the union of
 * its hurtboxes for the pose it is most likely in (walk when isMoving, else
 * idle — see targetHurtboxUnion).
 */
import type { Client, Room } from '@colyseus/core';
import type { WorldState } from '../schemas/WorldState.js';
import type { PlayerState } from '../schemas/PlayerState.js';
import {
  DIRECTION_ROWS_8,
  getActiveHitboxRects,
  hitboxFrameIndices,
  localShapeToWorldCoordinates,
  rectanglesIntersect,
  unionHurtboxRects,
  type CharacterConfigV1,
  type LocalRectangle,
  DEFAULT_MAX_HP,
  assetDamage,
  assetDamageEnabled,
} from '../shared/combat/CharacterCombatShapes.js';
import { getCharacterConfig } from './characterConfigService.js';

const FPS = 12;
const ATTACK_MOVEMENTS = new Set(['attack', 'walk-attack', 'run-attack']);
const DIRECTIONS = new Set<string>(DIRECTION_ROWS_8);
const CHARACTER_ID_RE = /^character\d{2,4}$/;
const COOLDOWN_PAD_MS = 200;

export interface AttackIntent {
  movement: string;
  direction: string;
  characterId?: string;
}

export class CombatResolver {
  private cooldownUntil = new Map<string, number>();

  constructor(private room: Room<WorldState>) {}

  /** Free per-session bookkeeping when a client leaves. */
  clearSession(sessionId: string): void {
    this.cooldownUntil.delete(sessionId);
  }

  async handleAttack(client: Client, data: unknown): Promise<void> {
    const attacker = this.room.state.players.get(client.sessionId);
    if (!attacker) return;
    if (attacker.currentBoardId) return; // seated players don't fight

    const intent = (data ?? {}) as Partial<AttackIntent>;
    const movement = typeof intent.movement === 'string' ? intent.movement : '';
    const direction = typeof intent.direction === 'string' ? intent.direction : '';
    if (!ATTACK_MOVEMENTS.has(movement) || !DIRECTIONS.has(direction)) return;

    const now = Date.now();
    if (now < (this.cooldownUntil.get(client.sessionId) ?? 0)) return;

    // Server state is authoritative for who you are; fall back to the
    // (format-validated) intent id only when set_character hasn't landed yet.
    const characterId =
      (CHARACTER_ID_RE.test(attacker.characterId) && attacker.characterId) ||
      (typeof intent.characterId === 'string' && CHARACTER_ID_RE.test(intent.characterId) && intent.characterId) ||
      '';
    if (!characterId) return;

    // Reserve the cooldown synchronously BEFORE any await — otherwise a burst
    // of attack messages arriving while the config loads all passes the check
    // above and stacks swings.
    this.cooldownUntil.set(client.sessionId, now + (4 / FPS) * 1000 + COOLDOWN_PAD_MS);

    const config = await getCharacterConfig(characterId);

    // Cooldown from the attack asset length when known (fallback: 4 frames).
    const assetKey = config ? findAssetKey(config, movement) : null;
    const columns = config && assetKey ? config.assets[assetKey].columns : 4;
    const durationMs = (columns / FPS) * 1000;
    this.cooldownUntil.set(client.sessionId, now + durationMs + COOLDOWN_PAD_MS);

    // Everyone sees the swing animation, even without combat boxes configured.
    this.room.broadcast('player_attack', {
      sessionId: client.sessionId,
      movement,
      direction,
    });

    // "Ativas no jogo" off = this character's boxes exist for editing/debug
    // but are inert in gameplay: no damage dealt.
    if (!config || !config.combatBoxesEnabled || !assetKey) return;

    // Per-movement damage: the swing always animates for everyone, but only
    // movements with "dano ativo" (and damage > 0) schedule hit resolution.
    const attackAsset = config.assets[assetKey];
    const damage = assetDamageEnabled(attackAsset) ? assetDamage(attackAsset) : 0;
    if (damage <= 0) return;

    const frames = hitboxFrameIndices(config, assetKey, direction);
    if (frames.length === 0) return;

    const hitTargets = new Set<string>(); // at most one hit per target per swing
    for (const frameIdx of frames) {
      const delayMs = (frameIdx / FPS) * 1000;
      this.room.clock.setTimeout(() => {
        void this.resolveFrame(client.sessionId, config, assetKey, direction, frameIdx, hitTargets, damage).catch(
          (e) => console.warn('[combat] frame resolution failed:', e instanceof Error ? e.message : e),
        );
      }, delayMs);
    }
  }

  private async resolveFrame(
    attackerSessionId: string,
    config: CharacterConfigV1,
    assetKey: string,
    direction: string,
    frameIdx: number,
    hitTargets: Set<string>,
    damage: number,
  ): Promise<void> {
    const attacker = this.room.state.players.get(attackerSessionId);
    if (!attacker) return; // attacker left mid-swing
    if (attacker.currentBoardId) return; // sat down mid-swing — no damage from a chair

    const hitLocal = getActiveHitboxRects(config, assetKey, direction, frameIdx);
    if (hitLocal.length === 0) return;
    // attacker.x/y is the sprite origin's world position
    const hitWorld = hitLocal.map((r) => localShapeToWorldCoordinates(r, attacker.x, attacker.y));

    const entries: Array<[string, PlayerState]> = [];
    this.room.state.players.forEach((p, sid) => entries.push([sid, p]));

    for (const [sessionId, target] of entries) {
      if (sessionId === attackerSessionId) continue;
      if (hitTargets.has(sessionId)) continue;
      if (target.currentBoardId) continue; // seated players are safe
      if (!CHARACTER_ID_RE.test(target.characterId)) continue; // character unknown yet

      const targetCfg = await getCharacterConfig(target.characterId);
      // Boxes disabled = also can't be hit (symmetric with dealing damage).
      if (!targetCfg || !targetCfg.combatBoxesEnabled) continue;

      const hurtLocal = targetHurtboxUnion(targetCfg, target);
      if (hurtLocal.length === 0) continue;
      const hurtWorld = hurtLocal.map((r) => localShapeToWorldCoordinates(r, target.x, target.y));

      const hit = hitWorld.some((hb) => hurtWorld.some((tb) => rectanglesIntersect(hb, tb)));
      if (!hit) continue;

      hitTargets.add(sessionId);
      const targetMaxHp = Math.max(1, target.maxHp || DEFAULT_MAX_HP);
      target.hp = Math.max(0, target.hp - damage);
      this.room.broadcast('combat_hit', {
        attackerSessionId,
        attackerName: attacker.username,
        targetSessionId: sessionId,
        targetName: target.username,
        damage,
        targetHp: target.hp,
        targetMaxHp,
      });
      if (target.hp <= 0) {
        target.hp = targetMaxHp; // instant "respawn" placeholder — no death state yet
        this.room.broadcast('combat_ko', {
          targetSessionId: sessionId,
          targetName: target.username,
          attackerName: attacker.username,
        });
      }
    }
  }
}

/** First asset of a movement, e.g. 'attack' → 'attack/attack-4dir.png'. */
function findAssetKey(config: CharacterConfigV1, movement: string): string | null {
  const prefix = `${movement}/`;
  for (const key of Object.keys(config.assets)) {
    if (key.startsWith(prefix)) return key;
  }
  return null;
}

/**
 * Union of the target's hurtboxes for its most likely pose: walk→run→idle when
 * moving, idle→walk→run when standing. Diagonal directions degrade to their
 * horizontal component for 4-direction sheets, then to 'down'.
 */
function targetHurtboxUnion(cfg: CharacterConfigV1, target: PlayerState): LocalRectangle[] {
  const movements = target.isMoving ? ['walk', 'run', 'idle'] : ['idle', 'walk', 'run'];
  const dir = DIRECTIONS.has(target.direction) ? target.direction : 'down';
  const fallbacks = [dir];
  if (dir.includes('-')) fallbacks.push(dir.split('-')[1]); // 'down-left' → 'left'
  if (!fallbacks.includes('down')) fallbacks.push('down');

  for (const mv of movements) {
    const key = findAssetKey(cfg, mv);
    if (!key) continue;
    for (const d of fallbacks) {
      const rects = unionHurtboxRects(cfg, key, d);
      if (rects.length > 0) return rects;
    }
  }
  return [];
}
