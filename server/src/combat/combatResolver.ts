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
  ATTACK_COOLDOWN_PAD_MS as COOLDOWN_PAD_MS,
  COMBAT_RESPAWN_MS,
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
import { COMPOSED_SHEET } from '../shared/characters/PlayerCharacterShapes.js';

const FPS = 12;
const ATTACK_MOVEMENTS = new Set(['attack', 'walk-attack', 'run-attack', 'shoot']);
const DIRECTIONS = new Set<string>(DIRECTION_ROWS_8);
const CHARACTER_ID_RE = /^character\d{2,4}$/;

export interface AttackIntent {
  movement: string;
  direction: string;
  characterId?: string;
}

/**
 * Ganchos opcionais para quem cuida de energia/XP (WorldRoom → progressService).
 * Todos são chamados DEPOIS do estado/broadcast já estarem consistentes.
 */
export interface CombatHooks {
  /** `attacker` acertou `target` (um golpe que conectou). */
  onHit?: (attacker: PlayerState, target: PlayerState) => void;
  /** `target` morreu; `attacker` é null quando a causa não é outro jogador (fome). */
  onKill?: (attacker: PlayerState | null, target: PlayerState) => void;
  /** `target` reviveu (HP cheio). */
  onRevive?: (target: PlayerState) => void;
}

export class CombatResolver {
  private cooldownUntil = new Map<string, number>();
  /** Sessions currently dead (KO'd): timestamp when the server revives them. */
  private deadUntil = new Map<string, number>();

  constructor(private room: Room<WorldState>, private hooks: CombatHooks = {}) {}

  /**
   * Morte por causa externa ao combate (fome): mesmo estado de cadáver,
   * mesmo `player_died`/revive dos KOs. Ignorado se já estiver morto/sentado.
   */
  killPlayer(sessionId: string, causeName: string): boolean {
    const target = this.room.state.players.get(sessionId);
    if (!target || this.isDead(sessionId)) return false;
    target.hp = 0; // o HP sincroniza pelo schema; não há `combat_hit` (ninguém golpeou)
    this.killTarget(sessionId, target, null, causeName);
    return true;
  }

  /** Estado de morte + timer de revive (compartilhado por KO em combate e fome). */
  private killTarget(sessionId: string, target: PlayerState, attacker: PlayerState | null, attackerName: string): void {
    const reviveAt = Date.now() + COMBAT_RESPAWN_MS;
    this.deadUntil.set(sessionId, reviveAt);
    this.room.broadcast('player_died', {
      targetSessionId: sessionId,
      targetName: target.username,
      attackerName,
      respawnMs: COMBAT_RESPAWN_MS,
    });
    this.hooks.onKill?.(attacker, target);
    this.room.clock.setTimeout(() => {
      // Stale-timer guard: only the timer of the CURRENT death revives.
      if (this.deadUntil.get(sessionId) !== reviveAt) return;
      this.deadUntil.delete(sessionId);
      const still = this.room.state.players.get(sessionId);
      if (!still) return; // left while dead
      still.hp = Math.max(1, still.maxHp || DEFAULT_MAX_HP);
      this.room.broadcast('player_revived', { sessionId, hp: still.hp });
      this.hooks.onRevive?.(still);
    }, COMBAT_RESPAWN_MS);
  }

  /** True while a player is KO'd — dead players can't attack, be hit or move. */
  isDead(sessionId: string): boolean {
    return Date.now() < (this.deadUntil.get(sessionId) ?? 0);
  }

  /** Free per-session bookkeeping when a client leaves. */
  clearSession(sessionId: string): void {
    this.cooldownUntil.delete(sessionId);
    this.deadUntil.delete(sessionId);
  }

  async handleAttack(client: Client, data: unknown): Promise<void> {
    const attacker = this.room.state.players.get(client.sessionId);
    if (!attacker) return;
    if (attacker.currentBoardId) return; // seated players don't fight
    if (this.isDead(client.sessionId)) return; // dead players don't attack

    const intent = (data ?? {}) as Partial<AttackIntent>;
    const movement = typeof intent.movement === 'string' ? intent.movement : '';
    const direction = typeof intent.direction === 'string' ? intent.direction : '';
    if (!ATTACK_MOVEMENTS.has(movement) || !DIRECTIONS.has(direction)) return;

    const now = Date.now();
    if (now < (this.cooldownUntil.get(client.sessionId) ?? 0)) return;

    // Server state is authoritative for who you are. (O fallback antigo pelo
    // characterId do intent morreu junto com o set_character: aceitar o id
    // vindo do cliente seria deixar qualquer um "vestir" um rig com dano.)
    const characterId = (CHARACTER_ID_RE.test(attacker.characterId) && attacker.characterId) || '';
    if (!characterId) {
      // Personagem composto (aparência do gerador): o swing anima para todos
      // com cooldown pelo tamanho do ataque do pack — SEM dano nesta fase
      // (dano continua exclusivo dos rigs legados, spec do round).
      if (!attacker.appearance) return; // sem personagem criado → nada a animar
      // 'shoot' (arco, knock-and-bow) tem a própria duração; demais usam o ataque.
      const frames = movement === 'shoot' ? COMPOSED_SHEET.shootFrames : COMPOSED_SHEET.attackFrames;
      const durationMs = (frames.length / FPS) * 1000;
      this.cooldownUntil.set(client.sessionId, now + durationMs + COOLDOWN_PAD_MS);
      this.room.broadcast('player_attack', {
        sessionId: client.sessionId,
        movement,
        direction,
      });
      return;
    }

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
    if (this.isDead(attackerSessionId)) return; // died mid-swing — corpses deal no damage

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
      if (this.isDead(sessionId) || target.hp <= 0) continue; // already dead — no double-KO
      if (!CHARACTER_ID_RE.test(target.characterId)) continue; // character unknown yet

      const targetCfg = await getCharacterConfig(target.characterId);
      // Boxes disabled = also can't be hit (symmetric with dealing damage).
      if (!targetCfg || !targetCfg.combatBoxesEnabled) continue;

      // Revalidate after the await: while the config loaded, a PARALLEL
      // attacker's frame may have KO'd this target, or players may have
      // seated/left. Without this, two lethal frames double-kill (duplicate
      // player_died broadcasts + duplicate revive timers).
      if (!this.room.state.players.has(sessionId)) continue; // target left
      if (target.currentBoardId) continue; // sat down — seated players are safe
      if (this.isDead(sessionId) || target.hp <= 0) continue; // already down
      if (this.isDead(attackerSessionId) || attacker.currentBoardId) return; // attacker died/sat

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
      this.hooks.onHit?.(attacker, target);
      if (target.hp <= 0) {
        // Death state: corpse for COMBAT_RESPAWN_MS, then revive at full HP.
        this.killTarget(sessionId, target, attacker, attacker.username);
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
