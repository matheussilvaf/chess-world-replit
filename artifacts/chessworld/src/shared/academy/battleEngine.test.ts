import { describe, expect, it } from 'vitest';
import { BattleEngine } from './battleEngine.js';
import { BATTLE_PREFETCH, BATTLE_BEST_OF_PUZZLE_MS, BATTLE_MODE_INFO } from './PuzzleShapes.js';
import type { BattleMode } from './PuzzleShapes.js';

const start = 3000;
function battle(mode: BattleMode): BattleEngine {
  const game = new BattleEngine({
    mode, band: 'beginner', players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }], now: 0,
  });
  expect(game.start(start - 1)).toEqual([]);
  expect(game.start(start)).toEqual([
    { type: 'puzzle_assigned', playerId: 'a', index: 0 },
    { type: 'puzzle_assigned', playerId: 'b', index: 0 },
    { type: 'changed' },
  ]);
  expect(game.start(start)).toEqual([]);
  return game;
}
const win = { ok: true, solved: true };
const wrong = { ok: false, solved: false };
function result(game: BattleEngine) {
  return game.view('a', start).result;
}

describe('BattleEngine', () => {
  it('Corrida: avança os índices independentes, registra tempos e termina em empate', () => {
    const game = battle('race');
    expect(game.playerMove('a', { ok: true, solved: false }, start + 100)).toEqual([]);
    expect(game.playerMove('a', win, start + 500)).toContainEqual({ type: 'puzzle_assigned', playerId: 'a', index: 1 });
    expect(game.playerMove('b', win, start + 700)).toContainEqual({ type: 'puzzle_assigned', playerId: 'b', index: 1 });
    expect(game.highestNeededIndex()).toBe(1 + BATTLE_PREFETCH);
    expect(game.playerMove('a', wrong, start + 900)).toContainEqual({ type: 'puzzle_over', playerId: 'a', index: 1, reason: 'wrong' });
    expect(game.stats().a).toMatchObject({ solved: 1, failed: 1, solveTimeMs: 500 });
    expect(game.tick(start + BATTLE_MODE_INFO.race.durationMs!)).toContainEqual({ type: 'finished', winnerId: '', reason: 'time' });
    expect(game.playerMove('b', win, 999999)).toEqual([]);
  });

  it('Corrida: vence quem acertou mais, com relógio expirado antes de um lance tardio', () => {
    const game = battle('race');
    game.playerMove('a', win, start + 1);
    expect(game.playerMove('b', win, game.endsAt!)).toContainEqual({ type: 'finished', winnerId: 'a', reason: 'time' });
    expect(game.stats().b.solved).toBe(0);
  });

  it('Sequência: cresce o rating, erro encerra a vez, e pode ganhar por ultrapassar', () => {
    const game = battle('streak');
    expect(game.targetRatingForIndex(0)).toEqual({ min: 600, max: 650 });
    expect(game.targetRatingForIndex(1)).toEqual({ min: 650, max: 700 });
    expect(game.targetRatingForIndex(100)).toEqual({ min: 3000, max: 3000 });
    game.playerMove('a', win, start + 1);
    game.playerMove('a', wrong, start + 2);
    expect(game.view('a', start).me.done).toBe(true);
    expect(game.playerMove('a', win, start + 3)).toEqual([]);
    game.playerMove('b', win, start + 4);
    expect(game.playerMove('b', win, start + 5)).toContainEqual({ type: 'finished', winnerId: 'b', reason: 'score' });
  });

  it('Sequência: ambos erram com empate e teto de tempo', () => {
    const game = battle('streak');
    game.playerMove('a', wrong, start);
    expect(game.playerMove('b', wrong, start)).toContainEqual({ type: 'finished', winnerId: '', reason: 'both_done' });
    const timed = battle('streak');
    expect(timed.tick(timed.endsAt!)).toContainEqual({ type: 'finished', winnerId: '', reason: 'time' });
  });

  it.each(['best_of_5', 'best_of_10', 'best_of_15'] as const)('%s: pontos, avanço conjunto e encerramento por maioria', (mode) => {
    const game = battle(mode);
    const target = Math.floor(BATTLE_MODE_INFO[mode].bestOf! / 2) + 1;
    for (let index = 0; index < target; index++) {
      const events = game.playerMove('a', win, start + index + 1);
      expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'b', index, reason: 'opponent_first' });
      if (index < target - 1) {
        expect(events).toContainEqual({ type: 'puzzle_assigned', playerId: 'a', index: index + 1 });
        expect(events).toContainEqual({ type: 'puzzle_assigned', playerId: 'b', index: index + 1 });
      }
    }
    expect(result(game)).toEqual({ winnerId: 'a', reason: 'score' });
    expect(game.stats().a.points).toBe(target);
  });

  it('Melhor de N: erros e prazo sem ponto; no último puzzle termina empatado', () => {
    const game = battle('best_of_5');
    expect(game.playerMove('a', wrong, start + 1)).toContainEqual({ type: 'puzzle_over', playerId: 'a', index: 0, reason: 'wrong' });
    expect(game.playerMove('b', wrong, start + 2)).toContainEqual({ type: 'puzzle_assigned', playerId: 'b', index: 1 });
    expect(game.view('a', start).bestOf).toEqual({ total: 5, current: 1, deadlineAt: start + 2 + BATTLE_BEST_OF_PUZZLE_MS });
    for (let index = 1; index < 5; index++) {
      const deadline = game.view('a', start).bestOf!.deadlineAt;
      const events = game.tick(deadline);
      expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'a', index, reason: 'timeout' });
      expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'b', index, reason: 'timeout' });
    }
    expect(result(game)).toEqual({ winnerId: '', reason: 'all_puzzles' });
    expect(game.stats().a).toMatchObject({ failed: 1, points: 0 });
  });

  it('Melhor de N: líder inalcançável encerra antes da maioria', () => {
    const game = battle('best_of_5');
    game.playerMove('a', win, start + 1);
    game.playerMove('a', win, start + 2);
    game.playerMove('b', wrong, start + 3);
    game.playerMove('a', wrong, start + 4);
    game.playerMove('b', wrong, start + 5);
    expect(game.playerMove('a', wrong, start + 6)).toContainEqual({ type: 'finished', winnerId: 'a', reason: 'score' });
  });

  it('Melhor de N: lance que chega depois do prazo não pontua na rodada seguinte', () => {
    const game = battle('best_of_5');
    const late = start + BATTLE_BEST_OF_PUZZLE_MS + 5;
    const events = game.playerMove('a', win, late, 0);
    expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'a', index: 0, reason: 'timeout' });
    expect(events).toContainEqual({ type: 'puzzle_assigned', playerId: 'a', index: 1 });
    expect(game.stats().a.solved).toBe(0);
    expect(game.stats().a.points).toBe(0);
    expect(game.currentIndex('a')).toBe(1);
    // Índice obsoleto explícito também é descartado, mesmo sem prazo vencido.
    expect(game.playerMove('a', win, late + 1, 0)).toEqual([]);
    expect(game.stats().a.solved).toBe(0);
  });

  it('Survival: perde ao zerar vidas', () => {
    const game = battle('survival');
    for (let i = 0; i < 2; i++) game.playerMove('a', wrong, start + i);
    expect(game.playerMove('a', wrong, start + 2)).toContainEqual({ type: 'finished', winnerId: 'b', reason: 'lives' });
    expect(game.stats().a.lives).toBe(0);
  });

  it('Survival: desempata por vidas, acertos e menor tempo; igualdade empata', () => {
    const lives = battle('survival');
    lives.playerMove('a', win, start + 1);
    lives.playerMove('b', wrong, start + 2);
    lives.tick(lives.endsAt!);
    expect(result(lives)?.winnerId).toBe('a');
    const solved = battle('survival');
    solved.playerMove('b', win, start + 1);
    solved.tick(solved.endsAt!);
    expect(result(solved)?.winnerId).toBe('b');
    const faster = battle('survival');
    faster.playerMove('a', win, start + 100);
    faster.playerMove('b', win, start + 200);
    faster.tick(faster.endsAt!);
    expect(result(faster)?.winnerId).toBe('a');
    const draw = battle('survival');
    draw.tick(draw.endsAt!);
    expect(result(draw)?.winnerId).toBe('');
  });

  it('Pressão: desconta do adversário, congela no encerramento e vence ao zerar', () => {
    const game = battle('pressure');
    expect(game.view('a', start + 1000).opponent.clockMs).toBe(119000);
    for (let i = 0; i < 11; i++) game.playerMove('a', win, start + i + 1);
    expect(game.view('a', start + 11).opponent.clockMs).toBe(9989);
    expect(game.playerMove('a', win, start + 12)).toContainEqual({ type: 'finished', winnerId: 'a', reason: 'clock' });
    expect(game.view('a', start + 200000).opponent.clockMs).toBe(0);
    const expired = battle('pressure');
    expect(expired.tick(start + 120000)).toContainEqual({ type: 'finished', winnerId: '', reason: 'clock' });
  });

  it('Desistência, aborto, offline e snapshot invertido', () => {
    const game = battle('race');
    game.setOffline('a', true);
    expect(game.view('b', start).opponent).toMatchObject({ playerId: 'a', name: 'Ana', offline: true });
    expect(game.forfeit('a', start + 1)).toContainEqual({ type: 'finished', winnerId: 'b', reason: 'forfeit' });
    expect(game.abort(start + 2)).toEqual([]);
    const aborted = battle('pressure');
    expect(aborted.abort(start + 1)).toContainEqual({ type: 'finished', winnerId: '', reason: 'aborted' });
  });
});