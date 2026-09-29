import {
  BATTLE_BEST_OF_PUZZLE_MS,
  BATTLE_COUNTDOWN_MS,
  BATTLE_MODE_INFO,
  BATTLE_PREFETCH,
  BATTLE_ROUND_RESULT_MS,
  BATTLE_STREAK_RATING_STEP,
  PUZZLE_BAND_INFO,
} from './PuzzleShapes.js';
import type { BattleMode, PuzzleBand, BattlePlayerView, BattlePhase, BattleEndReason } from './PuzzleShapes.js';

export interface BattlePlayerInit { id: string; name: string }

export type BattleEngineEvent =
  | { type: 'puzzle_assigned'; playerId: string; index: number }
  | { type: 'puzzle_over'; playerId: string; index: number; reason: 'wrong' | 'opponent_first' | 'opponent_wrong' | 'timeout' }
  | { type: 'finished'; winnerId: string; reason: BattleEndReason }
  | { type: 'changed' };

interface Player {
  id: string;
  name: string;
  color: 'w' | 'b';
  index: number;
  solved: number;
  failed: number;
  lives?: number;
  points?: number;
  penaltyMs: number;
  assignedAt: number;
  solveTimeMs: number;
  done: boolean;
  offline: boolean;
}

export class BattleEngine {
  readonly mode: BattleMode;
  readonly band: PuzzleBand;
  phase: BattlePhase = 'countdown';
  startsAt: number;
  endsAt?: number;

  private readonly players: [Player, Player];
  private readonly bestOfTotal?: number;
  private deadlineAt?: number;
  private roundResult?: { index: number; winnerId: string; reason: 'solved' | 'wrong' | 'timeout'; until: number };
  private result?: { winnerId: string; reason: BattleEndReason };
  private finishedAt?: number;

  constructor(opts: { mode: BattleMode; band: PuzzleBand; players: [BattlePlayerInit, BattlePlayerInit]; now: number }) {
    if (opts.players[0].id === opts.players[1].id) throw new Error('Jogadores da batalha precisam ter IDs distintos');
    this.mode = opts.mode;
    this.band = opts.band;
    this.startsAt = opts.now + BATTLE_COUNTDOWN_MS;
    const info = BATTLE_MODE_INFO[this.mode];
    this.bestOfTotal = info.bestOf;
    if (info.durationMs) this.endsAt = this.startsAt + info.durationMs;
    if (this.mode === 'pressure') this.endsAt = this.startsAt + 15 * 60_000; // teto de segurança
    this.players = opts.players.map(({ id, name }) => ({
      id, name, color: 'w', index: 0, solved: 0, failed: 0,
      lives: info.lives, points: info.bestOf ? 0 : undefined,
      penaltyMs: 0, assignedAt: this.startsAt, solveTimeMs: 0,
      done: false, offline: false,
    })) as [Player, Player];
  }

  private player(id: string): Player {
    const player = this.players.find((p) => p.id === id);
    if (!player) throw new Error(`Jogador não pertence à batalha: ${id}`);
    return player;
  }

  private other(player: Player): Player {
    return this.players[0] === player ? this.players[1] : this.players[0];
  }

  private clock(player: Player, now: number): number {
    return Math.max(0, BATTLE_MODE_INFO.pressure.clockMs! - Math.max(0, now - this.startsAt) - player.penaltyMs);
  }

  private compare(field: (p: Player) => number): string {
    const difference = field(this.players[0]) - field(this.players[1]);
    return difference > 0 ? this.players[0].id : difference < 0 ? this.players[1].id : '';
  }

  private finish(winnerId: string, reason: BattleEndReason, now: number): BattleEngineEvent[] {
    this.phase = 'finished';
    this.finishedAt = now;
    this.result = { winnerId, reason };
    return [{ type: 'finished', winnerId, reason }, { type: 'changed' }];
  }

  private timeWinner(now: number): string {
    if (this.mode === 'survival') {
      return this.compare((p) => p.lives ?? 0)
        || this.compare((p) => p.solved)
        || this.compare((p) => -p.solveTimeMs);
    }
    if (this.mode === 'pressure') return this.compare((p) => this.clock(p, now));
    return this.compare((p) => p.solved);
  }

  start(now: number): BattleEngineEvent[] {
    if (this.phase !== 'countdown' || now < this.startsAt) return [];
    this.phase = 'running';
    if (this.bestOfTotal) this.deadlineAt = this.startsAt + BATTLE_BEST_OF_PUZZLE_MS;
    return [
      ...this.players.map((p): BattleEngineEvent => ({ type: 'puzzle_assigned', playerId: p.id, index: p.index })),
      { type: 'changed' },
    ];
  }

  private advance(player: Player, now: number): BattleEngineEvent {
    player.index += 1;
    player.assignedAt = now;
    return { type: 'puzzle_assigned', playerId: player.id, index: player.index };
  }

  private nextBestOf(now: number): BattleEngineEvent[] {
    this.roundResult = undefined;
    const remaining = this.bestOfTotal! - this.players[0].index - 1;
    const winner = this.compare((p) => p.points ?? 0);
    const leader = this.players.find((p) => p.id === winner);
    if (remaining <= 0) return this.finish(winner, 'all_puzzles', now);
    if (leader && (leader.points! >= Math.floor(this.bestOfTotal! / 2) + 1
      || leader.points! > (this.other(leader).points ?? 0) + remaining)) {
      return this.finish(winner, 'score', now);
    }
    this.deadlineAt = now + BATTLE_BEST_OF_PUZZLE_MS;
    return [...this.players.map((p) => {
      p.done = false;
      return this.advance(p, now);
    }), { type: 'changed' }];
  }

  private endBestOfRound(winnerId: string, reason: 'solved' | 'wrong' | 'timeout', now: number, events: BattleEngineEvent[]): BattleEngineEvent[] {
    this.players.forEach((p) => { p.done = true; });
    this.roundResult = { index: this.players[0].index, winnerId, reason, until: now + BATTLE_ROUND_RESULT_MS };
    return [...events, { type: 'changed' }];
  }

  /** `index` = puzzle que o lance mira; se os prazos aplicados pelo `tick` já avançaram a rodada, o lance é descartado. */
  playerMove(playerId: string, evaluation: { ok: boolean; solved: boolean }, now: number, index?: number): BattleEngineEvent[] {
    const target = index ?? this.player(playerId).index;
    const timed = this.tick(now);
    if (this.phase !== 'running') return timed;
    const player = this.player(playerId);
    if (player.index !== target) return timed;
    if (player.done || (this.bestOfTotal && player.index >= this.bestOfTotal)) return timed;
    if (evaluation.ok && !evaluation.solved) return timed;
    const opponent = this.other(player);
    const events: BattleEngineEvent[] = [...timed];
    if (evaluation.ok) {
      player.solved += 1;
      player.solveTimeMs += Math.max(0, now - player.assignedAt);
      if (this.bestOfTotal) {
        player.points! += 1;
        if (!opponent.done) events.push({ type: 'puzzle_over', playerId: opponent.id, index: opponent.index, reason: 'opponent_first' });
        return this.endBestOfRound(player.id, 'solved', now, events);
      }
      if (this.mode === 'pressure') {
        opponent.penaltyMs += BATTLE_MODE_INFO.pressure.penaltyMs!;
        if (this.clock(opponent, now) <= 0) {
          opponent.done = true;
          return [...events, ...this.finish(player.id, 'clock', now)];
        }
      }
    } else {
      player.failed += 1;
      events.push({ type: 'puzzle_over', playerId, index: player.index, reason: 'wrong' });
      if (this.bestOfTotal) {
        opponent.points! += 1;
        events.push({ type: 'puzzle_over', playerId: opponent.id, index: opponent.index, reason: 'opponent_wrong' });
        return this.endBestOfRound(opponent.id, 'wrong', now, events);
      }
      if (this.mode === 'streak') {
        player.done = true;
        if (opponent.done) return [...events, ...this.finish(this.compare((p) => p.solved), 'both_done', now)];
        if (opponent.solved > player.solved) return [...events, ...this.finish(opponent.id, 'score', now)];
        return [...events, { type: 'changed' }];
      }
      if (this.mode === 'survival') {
        player.lives! -= 1;
        if (player.lives === 0) {
          player.done = true;
          return [...events, ...this.finish(opponent.id, 'lives', now)];
        }
      }
    }
    if (this.mode === 'streak' && opponent.done && player.solved > opponent.solved) {
      return [...events, ...this.finish(player.id, 'score', now)];
    }
    return [...events, this.advance(player, now), { type: 'changed' }];
  }

  tick(now: number): BattleEngineEvent[] {
    const events = this.start(now);
    if (this.phase !== 'running') return events;
    if (this.mode === 'pressure') {
      const expired = this.players.filter((p) => this.clock(p, now) <= 0);
      if (expired.length) {
        expired.forEach((p) => { p.done = true; });
        return [...events, ...this.finish(expired.length === 2 ? '' : this.other(expired[0]).id, 'clock', now)];
      }
    }
    if (this.endsAt !== undefined && now >= this.endsAt) {
      return [...events, ...this.finish(this.timeWinner(this.endsAt), 'time', this.endsAt)];
    }
    if (this.bestOfTotal && this.deadlineAt !== undefined) {
      if (this.roundResult) {
        if (now >= this.roundResult.until) events.push(...this.nextBestOf(this.roundResult.until));
        return events;
      }
      while (this.phase === 'running' && now >= this.deadlineAt) {
        const deadline = this.deadlineAt;
        for (const player of this.players) {
          if (!player.done) {
            player.done = true;
            events.push({ type: 'puzzle_over', playerId: player.id, index: player.index, reason: 'timeout' });
          }
        }
        events.push(...this.endBestOfRound('', 'timeout', deadline, []));
        if (now < this.roundResult!.until) break;
        events.push(...this.nextBestOf(this.roundResult!.until));
      }
    }
    return events;
  }

  forfeit(playerId: string, now: number): BattleEngineEvent[] {
    if (this.phase === 'finished') return [];
    const player = this.player(playerId);
    return this.finish(this.other(player).id, 'forfeit', now);
  }

  abort(now: number): BattleEngineEvent[] {
    if (this.phase === 'finished') return [];
    return this.finish('', 'aborted', now);
  }

  setOffline(playerId: string, offline: boolean): void {
    if (this.phase === 'finished') return;
    this.player(playerId).offline = offline;
  }

  currentIndex(playerId: string): number {
    return this.player(playerId).index;
  }

  /** Atualiza a cor somente se a sessão ainda for do puzzle atual. */
  setPuzzleColor(playerId: string, index: number, color: 'w' | 'b'): void {
    const player = this.player(playerId);
    if (player.index === index) player.color = color;
  }

  highestNeededIndex(): number {
    return Math.max(...this.players.map((p) => p.index)) + BATTLE_PREFETCH;
  }

  targetRatingForIndex(index: number): { min: number; max: number } {
    const { min, max } = PUZZLE_BAND_INFO[this.band];
    if (this.mode !== 'streak') return { min, max };
    const target = Math.min(3000, min + Math.max(0, index) * BATTLE_STREAK_RATING_STEP);
    return { min: target, max: Math.min(3000, target + BATTLE_STREAK_RATING_STEP) };
  }

  view(forPlayerId: string, now: number): {
    phase: BattlePhase; startsAt: number; endsAt?: number;
    bestOf?: { total: number; current: number; deadlineAt: number; roundResult?: { index: number; winnerId: string; reason: 'solved' | 'wrong' | 'timeout'; until: number } };
    me: BattlePlayerView; opponent: BattlePlayerView;
    result?: { winnerId: string; reason: BattleEndReason };
  } {
    const me = this.player(forPlayerId);
    const toView = (p: Player): BattlePlayerView => ({
      playerId: p.id, name: p.name, color: p.color, index: p.index, solved: p.solved, failed: p.failed,
      lives: p.lives, clockMs: this.mode === 'pressure'
        ? this.clock(p, this.phase === 'countdown' ? this.startsAt : this.phase === 'finished' ? this.finishedAt ?? now : now)
        : undefined,
      points: p.points, done: p.done, solveTimeMs: p.solveTimeMs, offline: p.offline,
    });
    return {
      phase: this.phase, startsAt: this.startsAt, endsAt: this.endsAt,
      bestOf: this.bestOfTotal ? { total: this.bestOfTotal, current: this.players[0].index, deadlineAt: this.deadlineAt ?? this.startsAt + BATTLE_BEST_OF_PUZZLE_MS, ...(this.roundResult ? { roundResult: this.roundResult } : {}) } : undefined,
      me: toView(me), opponent: toView(this.other(me)), result: this.result,
    };
  }

  stats(): Record<string, { solved: number; failed: number; lives?: number; points?: number; solveTimeMs: number }> {
    return Object.fromEntries(this.players.map((p) => [p.id, {
      solved: p.solved, failed: p.failed, lives: p.lives, points: p.points, solveTimeMs: p.solveTimeMs,
    }]));
  }
}