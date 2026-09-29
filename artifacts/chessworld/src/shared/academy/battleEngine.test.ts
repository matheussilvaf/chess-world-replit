import { describe, expect, it } from 'vitest';
import { BattleEngine } from './battleEngine.js';
import { BATTLE_PREFETCH, BATTLE_BEST_OF_PUZZLE_MS, BATTLE_MODE_INFO, BATTLE_ROUND_RESULT_MS, BATTLE_WRONG_COOLDOWN_MS, PUZZLE_WRONG_BLINK_MS } from './PuzzleShapes.js';
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
  it('mostra a cor própria de cada participante e atualiza no puzzle seguinte', () => {
    const game = battle('race');
    game.setPuzzleColor('a', 0, 'b');
    game.setPuzzleColor('b', 0, 'w');
    expect(game.view('a', start).me.color).toBe('b');
    expect(game.view('a', start).opponent.color).toBe('w');
    expect(game.view('b', start).me.color).toBe('w');
    game.playerMove('a', win, start + 100);
    game.setPuzzleColor('a', 0, 'w'); // sessão anterior não pode sobrescrever o próximo puzzle
    expect(game.view('a', start + 100).me.color).toBe('b');
    game.setPuzzleColor('a', 1, 'w');
    expect(game.view('a', start + 100).me.color).toBe('w');
  });
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

  it.each([['best_of_7', 4], ['best_of_15', 8], ['best_of_23', 12]] as const)('%s: pontos, avanço conjunto e encerramento por maioria', (mode, target) => {
    const game = battle(mode);
    expect(target).toBe(Math.floor(BATTLE_MODE_INFO[mode].bestOf! / 2) + 1);
    let now = start;
    for (let index = 0; index < target; index++) {
      now += 1;
      const events = game.playerMove('a', win, now);
      expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'b', index, reason: 'opponent_first' });
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'puzzle_assigned' }));
      expect(game.view('b', now).bestOf?.roundResult).toEqual({ index, winnerId: 'a', reason: 'solved', until: now + BATTLE_ROUND_RESULT_MS });
      expect(game.view('a', now).me.done).toBe(true);
      expect(game.playerMove('b', win, now + 1)).toEqual([]);
      expect(game.tick(now + BATTLE_ROUND_RESULT_MS - 1)).toEqual([]);
      now += BATTLE_ROUND_RESULT_MS;
      const advance = game.tick(now);
      if (index < target - 1) {
        expect(advance).toContainEqual({ type: 'puzzle_assigned', playerId: 'a', index: index + 1 });
        expect(advance).toContainEqual({ type: 'puzzle_assigned', playerId: 'b', index: index + 1 });
        expect(game.view('a', now).bestOf?.roundResult).toBeUndefined();
      } else {
        expect(advance).toContainEqual({ type: 'finished', winnerId: 'a', reason: 'score' });
      }
    }
    expect(result(game)).toEqual({ winnerId: 'a', reason: 'score' });
    expect(game.stats().a.points).toBe(target);
  });

  it('Melhor de N: erro reinicia o mesmo puzzle e bloqueia até o fim da espera, sem pontos', () => {
    const game = battle('best_of_7');
    const events = game.playerMove('a', wrong, start + 1);
    const cooldownUntil = start + 1 + PUZZLE_WRONG_BLINK_MS + BATTLE_WRONG_COOLDOWN_MS;
    expect(events).toEqual([{ type: 'puzzle_restart', playerId: 'a', index: 0, cooldownUntil }, { type: 'changed' }]);
    expect(game.view('a', start + 1).me.cooldownUntil).toBe(cooldownUntil);
    expect(game.view('b', start + 1).opponent.cooldownUntil).toBe(cooldownUntil);
    expect(game.view('a', start + 1).bestOf?.roundResult).toBeUndefined();
    expect(game.stats().b.points).toBe(0);
    expect(game.stats().a.failed).toBe(1);
    expect(game.playerMove('a', win, cooldownUntil - 1)).toEqual([]);
    expect(game.playerMove('a', win, cooldownUntil)).toContainEqual({ type: 'puzzle_over', playerId: 'b', index: 0, reason: 'opponent_first' });
    expect(game.view('a', cooldownUntil).me.cooldownUntil).toBe(0);
    game.tick(cooldownUntil + BATTLE_ROUND_RESULT_MS);
    expect(game.view('a', cooldownUntil + BATTLE_ROUND_RESULT_MS).me.cooldownUntil).toBe(0);
  });

  it('Melhor de N: adversário resolve durante o bloqueio e leva a rodada', () => {
    const game = battle('best_of_7');
    game.playerMove('a', wrong, start + 1);
    expect(game.playerMove('b', win, start + 2)).toContainEqual({ type: 'puzzle_over', playerId: 'a', index: 0, reason: 'opponent_first' });
    expect(game.view('a', start + 2).bestOf?.roundResult?.winnerId).toBe('b');
    expect(game.view('a', start + 2).me.cooldownUntil).toBe(0);
    expect(game.stats().b.points).toBe(1);
    game.tick(start + 2 + BATTLE_ROUND_RESULT_MS);
    expect(game.view('a', start + 2 + BATTLE_ROUND_RESULT_MS).me.cooldownUntil).toBe(0);
  });

  it('Melhor de N: o prazo encerra a rodada mesmo durante o bloqueio', () => {
    const game = battle('best_of_7');
    const deadline = start + BATTLE_BEST_OF_PUZZLE_MS;
    game.playerMove('a', wrong, deadline - 1);
    expect(game.tick(deadline)).toContainEqual({ type: 'puzzle_over', playerId: 'a', index: 0, reason: 'timeout' });
    expect(game.view('a', deadline).me.cooldownUntil).toBe(0);
    expect(game.view('a', deadline).bestOf?.roundResult?.reason).toBe('timeout');
  });

  it('Melhor de N: prazo sem ponto; último puzzle termina só depois da pausa', () => {
    const game = battle('best_of_7');
    for (let index = 0; index < 7; index++) {
      const deadline = game.view('a', start).bestOf!.deadlineAt;
      const events = game.tick(deadline);
      expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'a', index, reason: 'timeout' });
      expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'b', index, reason: 'timeout' });
      expect(game.view('a', deadline).bestOf?.roundResult).toEqual({ index, winnerId: '', reason: 'timeout', until: deadline + BATTLE_ROUND_RESULT_MS });
      expect(game.phase).toBe('running');
      const advance = game.tick(deadline + BATTLE_ROUND_RESULT_MS);
      if (index < 6) expect(advance).toContainEqual({ type: 'puzzle_assigned', playerId: 'a', index: index + 1 });
      else expect(advance).toContainEqual({ type: 'finished', winnerId: '', reason: 'all_puzzles' });
    }
    expect(result(game)).toEqual({ winnerId: '', reason: 'all_puzzles' });
    expect(game.stats().a).toMatchObject({ failed: 0, points: 0 });
  });

  it('Melhor de N: líder inalcançável encerra antes da maioria', () => {
    const game = battle('best_of_7');
    let now = start;
    for (let index = 0; index < 3; index++) {
      game.playerMove('a', win, ++now);
      now += BATTLE_ROUND_RESULT_MS;
      game.tick(now);
    }
    for (let index = 0; index < 2; index++) {
      now = game.view('a', now).bestOf!.deadlineAt;
      game.tick(now);
      expect(game.phase).toBe('running');
      now += BATTLE_ROUND_RESULT_MS;
      const advance = game.tick(now);
      if (index === 1) expect(advance).toContainEqual({ type: 'finished', winnerId: 'a', reason: 'score' });
    }
    expect(game.stats().a.points).toBe(3);
    expect(game.stats().b.points).toBe(0);
    expect(game.currentIndex('a')).toBe(4);
  });

  it('Melhor de N: desistir ou abortar durante o resultado é imediato', () => {
    const game = battle('best_of_7');
    game.playerMove('a', win, start + 1);
    expect(game.forfeit('a', start + 2)).toContainEqual({ type: 'finished', winnerId: 'b', reason: 'forfeit' });
    const aborted = battle('best_of_7');
    aborted.playerMove('a', wrong, start + 1);
    expect(aborted.abort(start + 2)).toContainEqual({ type: 'finished', winnerId: '', reason: 'aborted' });
  });

  it('Melhor de N: o último resultado só termina após a pausa', () => {
    const game = battle('best_of_7');
    let now = start;
    for (let index = 0; index < 6; index++) {
      game.playerMove(index % 2 ? 'b' : 'a', win, ++now);
      now += BATTLE_ROUND_RESULT_MS;
      game.tick(now);
    }
    expect(game.phase).toBe('running');
    game.playerMove('b', win, ++now);
    expect(game.tick(now + BATTLE_ROUND_RESULT_MS)).toContainEqual({ type: 'finished', winnerId: 'b', reason: 'all_puzzles' });
  });

  it('Melhor de N: lance que chega depois do prazo não pontua na rodada seguinte', () => {
    const game = battle('best_of_7');
    const late = start + BATTLE_BEST_OF_PUZZLE_MS + 5;
    const events = game.playerMove('a', win, late, 0);
    expect(events).toContainEqual({ type: 'puzzle_over', playerId: 'a', index: 0, reason: 'timeout' });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'puzzle_assigned' }));
    expect(game.stats().a.solved).toBe(0);
    expect(game.stats().a.points).toBe(0);
    expect(game.currentIndex('a')).toBe(0);
    // Índice obsoleto explícito também é descartado, mesmo sem prazo vencido.
    expect(game.playerMove('a', win, late + 1, 0)).toEqual([]);
    expect(game.stats().a.solved).toBe(0);
    expect(game.tick(start + BATTLE_BEST_OF_PUZZLE_MS + BATTLE_ROUND_RESULT_MS)).toContainEqual({ type: 'puzzle_assigned', playerId: 'a', index: 1 });
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