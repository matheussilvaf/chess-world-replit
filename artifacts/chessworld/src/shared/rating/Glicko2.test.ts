import { describe, expect, it } from 'vitest';
import {
  calculateGlicko2Period,
  calculateGlicko2Rating,
  inflateRatingDeviation,
  isProvisionalRating,
  ratingPeriodsSince,
} from './Glicko2';
import {
  DEFAULT_RATING_GAMBITS_CONFIG,
  applyGambitLimits,
  decideMatchSettlement,
  gambitDayStart,
  parseRatingGambitsConfig,
  pliesFromFen,
} from './RatingShapes';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Glicko-2 (Glickman, example.pdf)', () => {
  it('reproduz o exemplo canônico: 1500/200/0.06 vs 1400(30) W, 1550(100) L, 1700(300) L', () => {
    const out = calculateGlicko2Period(
      { rating: 1500, ratingDeviation: 200, volatility: 0.06 },
      [
        { opponent: { rating: 1400, ratingDeviation: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, ratingDeviation: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, ratingDeviation: 300, volatility: 0.06 }, score: 0 },
      ],
      { tau: 0.5 },
    );
    // O paper arredonda os intermediários (g, E, v…) e publica 1464.06; a conta
    // em precisão total dá 1464.0507 — a diferença é < 0.01 ponto de rating.
    expect(Math.abs(out.rating - 1464.06)).toBeLessThan(0.01);
    expect(out.ratingDeviation).toBeCloseTo(151.52, 2);
    expect(out.volatility).toBeCloseTo(0.05999, 4);
    expect(out.ratingDelta).toBeCloseTo(out.rating - 1500, 6);
  });

  it('uma partida = um período com um único resultado', () => {
    const player = { rating: 1200, ratingDeviation: 350, volatility: 0.06 };
    const opponent = { rating: 1200, ratingDeviation: 350, volatility: 0.06 };
    const win = calculateGlicko2Rating({ player, opponent, score: 1 });
    const loss = calculateGlicko2Rating({ player, opponent, score: 0 });
    const draw = calculateGlicko2Rating({ player, opponent, score: 0.5 });
    expect(win.rating).toBeGreaterThan(1200);
    expect(loss.rating).toBeLessThan(1200);
    expect(draw.rating).toBeCloseTo(1200, 6);
    // Simetria: iguais antes → o ganho de um é a perda do outro.
    expect(win.ratingDelta).toBeCloseTo(-loss.ratingDelta, 6);
    // Toda partida reduz a incerteza.
    expect(win.ratingDeviation).toBeLessThan(350);
    expect(draw.ratingDeviation).toBeLessThan(350);
  });

  it('ganhar de um mais forte rende mais que ganhar de um mais fraco', () => {
    const player = { rating: 1500, ratingDeviation: 100, volatility: 0.06 };
    const vsStrong = calculateGlicko2Rating({ player, opponent: { rating: 1900, ratingDeviation: 60, volatility: 0.06 }, score: 1 });
    const vsWeak = calculateGlicko2Rating({ player, opponent: { rating: 1100, ratingDeviation: 60, volatility: 0.06 }, score: 1 });
    expect(vsStrong.ratingDelta).toBeGreaterThan(vsWeak.ratingDelta);
    expect(vsWeak.ratingDelta).toBeGreaterThan(0);
    // Perder para o fraco dói mais que perder para o forte.
    const loseStrong = calculateGlicko2Rating({ player, opponent: { rating: 1900, ratingDeviation: 60, volatility: 0.06 }, score: 0 });
    const loseWeak = calculateGlicko2Rating({ player, opponent: { rating: 1100, ratingDeviation: 60, volatility: 0.06 }, score: 0 });
    expect(loseWeak.ratingDelta).toBeLessThan(loseStrong.ratingDelta);
  });

  it('aplica o piso do rating e mede o delta contra o piso', () => {
    const out = calculateGlicko2Rating(
      // Perder de um igual com RD 350 derruba ~175 pontos → bate no piso.
      { player: { rating: 110, ratingDeviation: 350, volatility: 0.06 }, opponent: { rating: 110, ratingDeviation: 30, volatility: 0.06 }, score: 0 },
      { floor: 100 },
    );
    expect(out.rating).toBe(100);
    expect(out.ratingDelta).toBe(-10);
  });

  it('não tem teto: um rating alto continua subindo', () => {
    const out = calculateGlicko2Rating({
      player: { rating: 3400, ratingDeviation: 60, volatility: 0.06 },
      opponent: { rating: 3400, ratingDeviation: 60, volatility: 0.06 },
      score: 1,
    });
    expect(out.rating).toBeGreaterThan(3400);
  });

  it('período sem partidas só infla o RD (limitado ao máximo)', () => {
    const idle = calculateGlicko2Period({ rating: 1500, ratingDeviation: 200, volatility: 0.06 }, []);
    expect(idle.rating).toBe(1500);
    expect(idle.ratingDeviation).toBeGreaterThan(200);
    expect(idle.volatility).toBe(0.06);
    expect(inflateRatingDeviation(50, 0.06, 1)).toBeGreaterThan(50);
    expect(inflateRatingDeviation(50, 0.06, 0)).toBe(50);
    expect(inflateRatingDeviation(340, 0.06, 10_000)).toBe(350);
    expect(inflateRatingDeviation(50, 0.06, 1)).toBeLessThan(inflateRatingDeviation(50, 0.06, 5));
  });

  it('conta períodos inteiros de inatividade', () => {
    const now = Date.UTC(2026, 8, 14, 12);
    expect(ratingPeriodsSince(null, now, 1)).toBe(0);
    expect(ratingPeriodsSince(new Date(now - 3 * 86_400_000 - 1000).toISOString(), now, 1)).toBe(3);
    expect(ratingPeriodsSince(new Date(now - 12 * 3_600_000).toISOString(), now, 1)).toBe(0);
    expect(ratingPeriodsSince(new Date(now + 1000).toISOString(), now, 1)).toBe(0);
  });

  it('rating provisório: poucas partidas OU RD alto', () => {
    const t = { provisionalGames: 10, provisionalRd: 110 };
    expect(isProvisionalRating({ ratedGamesPlayed: 0, ratingDeviation: 350 }, t)).toBe(true);
    expect(isProvisionalRating({ ratedGamesPlayed: 12, ratingDeviation: 120 }, t)).toBe(true);
    expect(isProvisionalRating({ ratedGamesPlayed: 5, ratingDeviation: 80 }, t)).toBe(true);
    expect(isProvisionalRating({ ratedGamesPlayed: 10, ratingDeviation: 110 }, t)).toBe(false);
  });

  it('rejeita entradas não finitas', () => {
    expect(() => calculateGlicko2Rating({
      player: { rating: Number.NaN, ratingDeviation: 350, volatility: 0.06 },
      opponent: { rating: 1200, ratingDeviation: 350, volatility: 0.06 },
      score: 1,
    })).toThrow(/glicko2/);
  });
});

describe('decideMatchSettlement', () => {
  const base = { whitePlayerId: 'w', blackPlayerId: 'b', fen: START_FEN };

  it('xeque-mate, desistência e tempo = vitória/derrota', () => {
    for (const result of ['checkmate', 'resign', 'timeout']) {
      expect(decideMatchSettlement({ ...base, result, winnerId: 'w' })).toEqual({ rated: true, white: 'win', black: 'loss' });
      expect(decideMatchSettlement({ ...base, result, winnerId: 'b' })).toEqual({ rated: true, white: 'loss', black: 'win' });
    }
  });

  it('empates de todos os tipos', () => {
    for (const result of ['draw', 'stalemate', 'repetition', 'insufficient']) {
      expect(decideMatchSettlement({ ...base, result, winnerId: '' })).toEqual({ rated: true, white: 'draw', black: 'draw' });
    }
  });

  it('abortada (abandono com < 2 lances) e dupla desistência não valem', () => {
    expect(decideMatchSettlement({ ...base, result: 'abandon', winnerId: 'w' })).toEqual({ rated: false, reason: 'aborted' });
    expect(decideMatchSettlement({ ...base, result: 'abandon', winnerId: '' })).toEqual({ rated: false, reason: 'double_forfeit' });
    // Abandono com jogo em andamento = derrota de quem saiu.
    const midgame = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(decideMatchSettlement({ ...base, fen: midgame, result: 'abandon', winnerId: 'b' })).toEqual({ rated: true, white: 'loss', black: 'win' });
  });

  it('anônimos (amistoso) e resultados desconhecidos não valem', () => {
    expect(decideMatchSettlement({ ...base, whitePlayerId: 'anon:x', result: 'checkmate', winnerId: 'b' })).toEqual({ rated: false, reason: 'anonymous' });
    expect(decideMatchSettlement({ ...base, result: '', winnerId: '' })).toEqual({ rated: false, reason: 'unknown_result' });
    expect(decideMatchSettlement({ ...base, result: 'checkmate', winnerId: 'zzz' })).toEqual({ rated: false, reason: 'unknown_result' });
  });

  it('pliesFromFen', () => {
    expect(pliesFromFen(START_FEN)).toBe(0);
    expect(pliesFromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(1);
    expect(pliesFromFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')).toBe(2);
    expect(pliesFromFen('lixo')).toBe(0);
  });
});

describe('gambits', () => {
  const rules = DEFAULT_RATING_GAMBITS_CONFIG.gambits;

  it('padrões pedidos: 3 / 2 / 1 / 10, 1 vez por adversário, sem teto', () => {
    expect(rules.plazaWin).toBe(3);
    expect(rules.draw).toBe(2);
    expect(rules.loss).toBe(1);
    expect(rules.tournamentWin).toBe(10);
    expect(rules.opponentDailyLimit).toBe(1);
    expect(rules.dailyCap).toBeNull();
  });

  it('limite por adversário e teto diário', () => {
    expect(applyGambitLimits(3, { gamesAgainstOpponentToday: 0, gambitsEarnedToday: 0 }, rules)).toEqual({ amount: 3, reason: 'awarded' });
    expect(applyGambitLimits(3, { gamesAgainstOpponentToday: 1, gambitsEarnedToday: 0 }, rules)).toEqual({ amount: 0, reason: 'opponent_limit' });
    const capped = { ...rules, dailyCap: 5 };
    expect(applyGambitLimits(3, { gamesAgainstOpponentToday: 0, gambitsEarnedToday: 3 }, capped)).toEqual({ amount: 2, reason: 'daily_cap' });
    expect(applyGambitLimits(3, { gamesAgainstOpponentToday: 0, gambitsEarnedToday: 5 }, capped)).toEqual({ amount: 0, reason: 'daily_cap' });
    expect(applyGambitLimits(0, { gamesAgainstOpponentToday: 0, gambitsEarnedToday: 0 }, rules)).toEqual({ amount: 0, reason: 'zero' });
  });

  it('dia de gambits respeita o deslocamento de fuso', () => {
    // 01:00 UTC de 14/09 com offset −3 h ainda é o dia 13/09 (que virou às 03:00 UTC).
    const t = Date.UTC(2026, 8, 14, 1);
    expect(gambitDayStart(t, -3)).toBe(Date.UTC(2026, 8, 13, 3));
    expect(gambitDayStart(Date.UTC(2026, 8, 14, 4), -3)).toBe(Date.UTC(2026, 8, 14, 3));
    expect(gambitDayStart(t, 0)).toBe(Date.UTC(2026, 8, 14, 0));
  });

  it('parse aceita dailyCap nulo/vazio e rejeita fora do range', () => {
    const ok = parseRatingGambitsConfig({ ...DEFAULT_RATING_GAMBITS_CONFIG, gambits: { ...rules, dailyCap: '' } });
    expect(ok.ok).toBe(true);
    expect(ok.config.gambits.dailyCap).toBeNull();
    const bad = parseRatingGambitsConfig({ ...DEFAULT_RATING_GAMBITS_CONFIG, rating: { ...DEFAULT_RATING_GAMBITS_CONFIG.rating, tau: 5 } });
    expect(bad.ok).toBe(false);
  });
});
