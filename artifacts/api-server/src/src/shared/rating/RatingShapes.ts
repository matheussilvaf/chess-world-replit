/**
 * Rating (Glicko-2) + Gambits — formato da configuração única do admin
 * (/admin/rating-gambits) e das mensagens sala → cliente. Compartilhado
 * servidor ↔ cliente; regras de negócio puras (sem I/O) vivem aqui para o
 * painel validar igual ao servidor.
 */
import { GLICKO2_DEFAULT_FLOOR, GLICKO2_DEFAULT_MAX_RD, GLICKO2_DEFAULT_TAU } from './Glicko2.js';

export const RATING_CONFIG_ID = 'default';

export interface RatingRulesConfig {
  /** Constante do sistema τ. */
  tau: number;
  /** Piso do rating. */
  floor: number;
  /** Estado inicial de todo jogador. */
  initialRating: number;
  initialRatingDeviation: number;
  initialVolatility: number;
  /** Provisório enquanto partidas avaliadas < provisionalGames OU RD > provisionalRd. */
  provisionalGames: number;
  provisionalRd: number;
  /** Período de inatividade (dias) — a cada período sem jogar o RD sobe, até maxRatingDeviation. */
  inactivityPeriodDays: number;
  maxRatingDeviation: number;
}

/** Motivos de fim com regra de lances mínimos (os demais — mate, afogamento, material — nunca têm mínimo). */
export type MinMovesReason = 'resign' | 'timeout' | 'draw' | 'repetition';
export const MIN_MOVES_REASONS: readonly MinMovesReason[] = ['resign', 'timeout', 'draw', 'repetition'];

/** A quem a regra se aplica num resultado decisivo (empate: sempre aos dois). */
export type MinMovesAppliesTo = 'loss' | 'win' | 'both';
export const MIN_MOVES_APPLIES_TO: readonly MinMovesAppliesTo[] = ['loss', 'win', 'both'];

export interface MinMovesRule {
  /** Lances completos (brancas + pretas) mínimos para a partida render gambits; 0 = sem mínimo. */
  minMoves: number;
  appliesTo: MinMovesAppliesTo;
}

export type MinMovesRules = Record<MinMovesReason, MinMovesRule>;

export interface GambitRulesConfig {
  /** Vitória numa partida — praça ou torneio (partida de torneio vale o mesmo que a da praça). */
  win: number;
  /** Empate (praça ou torneio). */
  draw: number;
  /** Derrota (praça ou torneio). */
  loss: number;
  /** Bônus do campeão (1º da classificação final) de um torneio concluído, além dos gambits das partidas. */
  tournamentChampion: number;
  /** Quantas partidas contra o MESMO adversário rendem gambits por dia. */
  opponentDailyLimit: number;
  /** Máximo de gambits ganhos por dia (null = infinito). */
  dailyCap: number | null;
  /** Deslocamento do "dia" em horas em relação ao UTC (−3 = Brasília). */
  dayOffsetHours: number;
  /** Lances mínimos por motivo de fim para a partida valer gambits (rating não é afetado). */
  minMoves: MinMovesRules;
}

export interface RatingGambitsConfig {
  rating: RatingRulesConfig;
  gambits: GambitRulesConfig;
}

export const DEFAULT_RATING_GAMBITS_CONFIG: RatingGambitsConfig = {
  rating: {
    tau: GLICKO2_DEFAULT_TAU,
    floor: GLICKO2_DEFAULT_FLOOR,
    initialRating: 1200,
    initialRatingDeviation: 350,
    initialVolatility: 0.06,
    provisionalGames: 10,
    provisionalRd: 110,
    inactivityPeriodDays: 1,
    maxRatingDeviation: GLICKO2_DEFAULT_MAX_RD,
  },
  gambits: {
    win: 3,
    draw: 2,
    loss: 1,
    tournamentChampion: 10,
    opponentDailyLimit: 1,
    dailyCap: null,
    dayOffsetHours: -3,
    minMoves: {
      resign: { minMoves: 10, appliesTo: 'both' },
      timeout: { minMoves: 10, appliesTo: 'both' },
      draw: { minMoves: 10, appliesTo: 'both' },
      repetition: { minMoves: 10, appliesTo: 'both' },
    },
  },
};

export const RATING_RANGES = {
  tau: { min: 0.2, max: 1.2 },
  floor: { min: 0, max: 3000 },
  initialRating: { min: 100, max: 3000 },
  initialRatingDeviation: { min: 30, max: 350 },
  initialVolatility: { min: 0.01, max: 0.2 },
  provisionalGames: { min: 0, max: 100 },
  provisionalRd: { min: 30, max: 350 },
  inactivityPeriodDays: { min: 0.5, max: 365 },
  maxRatingDeviation: { min: 100, max: 350 },
  gambitAmount: { min: 0, max: 10_000 },
  opponentDailyLimit: { min: 0, max: 1000 },
  dailyCap: { min: 1, max: 1_000_000 },
  dayOffsetHours: { min: -12, max: 14 },
  minMoves: { min: 0, max: 200 },
} as const;

export interface RatingConfigParse {
  ok: boolean;
  config: RatingGambitsConfig;
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  range: { min: number; max: number },
  errors: string[],
  label: string,
  integer = false,
): number {
  const raw = source[key];
  if (raw === undefined) return fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < range.min || value > range.max || (integer && !Number.isInteger(value))) {
    errors.push(`${label}: ${integer ? 'inteiro' : 'número'} entre ${range.min} e ${range.max}`);
    return fallback;
  }
  return value;
}

/** Normaliza/valida o documento de config; campos ausentes recebem os defaults. */
export function parseRatingGambitsConfig(value: unknown): RatingConfigParse {
  const errors: string[] = [];
  const d = DEFAULT_RATING_GAMBITS_CONFIG;
  if (!isRecord(value)) return { ok: false, config: clone(d), errors: ['config: objeto esperado'] };
  const r = isRecord(value.rating) ? value.rating : {};
  const gm = isRecord(value.gambits) ? value.gambits : {};
  const rating: RatingRulesConfig = {
    tau: num(r, 'tau', d.rating.tau, RATING_RANGES.tau, errors, 'rating.tau'),
    floor: num(r, 'floor', d.rating.floor, RATING_RANGES.floor, errors, 'rating.floor', true),
    initialRating: num(r, 'initialRating', d.rating.initialRating, RATING_RANGES.initialRating, errors, 'rating.initialRating', true),
    initialRatingDeviation: num(r, 'initialRatingDeviation', d.rating.initialRatingDeviation, RATING_RANGES.initialRatingDeviation, errors, 'rating.initialRatingDeviation'),
    initialVolatility: num(r, 'initialVolatility', d.rating.initialVolatility, RATING_RANGES.initialVolatility, errors, 'rating.initialVolatility'),
    provisionalGames: num(r, 'provisionalGames', d.rating.provisionalGames, RATING_RANGES.provisionalGames, errors, 'rating.provisionalGames', true),
    provisionalRd: num(r, 'provisionalRd', d.rating.provisionalRd, RATING_RANGES.provisionalRd, errors, 'rating.provisionalRd'),
    inactivityPeriodDays: num(r, 'inactivityPeriodDays', d.rating.inactivityPeriodDays, RATING_RANGES.inactivityPeriodDays, errors, 'rating.inactivityPeriodDays'),
    maxRatingDeviation: num(r, 'maxRatingDeviation', d.rating.maxRatingDeviation, RATING_RANGES.maxRatingDeviation, errors, 'rating.maxRatingDeviation'),
  };
  if (rating.initialRatingDeviation > rating.maxRatingDeviation) errors.push('rating.initialRatingDeviation: não pode passar de maxRatingDeviation');
  if (rating.floor > rating.initialRating) errors.push('rating.floor: não pode passar do rating inicial');
  let dailyCap: number | null = d.gambits.dailyCap;
  if (gm.dailyCap !== undefined) {
    if (gm.dailyCap === null || gm.dailyCap === '') dailyCap = null;
    else dailyCap = num(gm, 'dailyCap', 0, RATING_RANGES.dailyCap, errors, 'gambits.dailyCap', true) || null;
  }
  // Documentos antigos: `plazaWin` (hoje vale para praça E torneio) e `tournamentWin`
  // (que era por partida e passou a ser o bônus do campeão).
  const winKey = gm.win !== undefined ? 'win' : 'plazaWin';
  const championKey = gm.tournamentChampion !== undefined ? 'tournamentChampion' : 'tournamentWin';
  const minMovesSource = isRecord(gm.minMoves) ? gm.minMoves : {};
  const minMoves = {} as MinMovesRules;
  for (const reason of MIN_MOVES_REASONS) {
    const fallback = d.gambits.minMoves[reason];
    const rule = isRecord(minMovesSource[reason]) ? (minMovesSource[reason] as Record<string, unknown>) : {};
    const appliesToRaw = rule.appliesTo;
    let appliesTo: MinMovesAppliesTo = fallback.appliesTo;
    if (appliesToRaw !== undefined) {
      if (typeof appliesToRaw === 'string' && (MIN_MOVES_APPLIES_TO as readonly string[]).includes(appliesToRaw)) appliesTo = appliesToRaw as MinMovesAppliesTo;
      else errors.push(`gambits.minMoves.${reason}.appliesTo: loss, win ou both`);
    }
    minMoves[reason] = {
      minMoves: num(rule, 'minMoves', fallback.minMoves, RATING_RANGES.minMoves, errors, `gambits.minMoves.${reason}.minMoves`, true),
      appliesTo,
    };
  }
  const gambits: GambitRulesConfig = {
    win: num(gm, winKey, d.gambits.win, RATING_RANGES.gambitAmount, errors, 'gambits.win', true),
    draw: num(gm, 'draw', d.gambits.draw, RATING_RANGES.gambitAmount, errors, 'gambits.draw', true),
    loss: num(gm, 'loss', d.gambits.loss, RATING_RANGES.gambitAmount, errors, 'gambits.loss', true),
    tournamentChampion: num(gm, championKey, d.gambits.tournamentChampion, RATING_RANGES.gambitAmount, errors, 'gambits.tournamentChampion', true),
    opponentDailyLimit: num(gm, 'opponentDailyLimit', d.gambits.opponentDailyLimit, RATING_RANGES.opponentDailyLimit, errors, 'gambits.opponentDailyLimit', true),
    dailyCap,
    dayOffsetHours: num(gm, 'dayOffsetHours', d.gambits.dayOffsetHours, RATING_RANGES.dayOffsetHours, errors, 'gambits.dayOffsetHours'),
    minMoves,
  };
  return { ok: errors.length === 0, config: { rating, gambits }, errors };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ----------------------------------------------------------------- partidas

export type MatchKind = 'plaza' | 'tournament';

/** Resultado do ponto de vista de UM jogador. */
export type PlayerMatchOutcome = 'win' | 'draw' | 'loss';

/** Resultados da sala que valem partida (não abortada): tudo menos amistoso/abortado. */
export const DECISIVE_RESULTS = new Set(['checkmate', 'resign', 'timeout', 'abandon']);
export const DRAW_RESULTS = new Set(['draw', 'stalemate', 'repetition', 'insufficient']);

/**
 * Plies jogados a partir do FEN (o `pgn` some do estado em alguns caminhos de
 * fim; o FEN sempre está lá). Partida abortada = abandono com < 2 plies.
 */
export function pliesFromFen(fen: string): number {
  const parts = (fen || '').trim().split(/\s+/);
  const turn = parts[1] === 'b' ? 1 : 0;
  const fullmove = Number(parts[5]);
  if (!Number.isFinite(fullmove) || fullmove < 1) return turn;
  return (fullmove - 1) * 2 + turn;
}

export const ABORT_MAX_PLIES = 2;

export interface MatchSettlementInput {
  result: string;
  winnerId: string;
  whitePlayerId: string;
  blackPlayerId: string;
  fen: string;
}

export type MatchSettlementDecision =
  | { rated: true; white: PlayerMatchOutcome; black: PlayerMatchOutcome }
  | { rated: false; reason: 'aborted' | 'double_forfeit' | 'unknown_result' | 'anonymous' };

/** Decide se a partida vale rating/gambits e o resultado de cada lado. */
export function decideMatchSettlement(match: MatchSettlementInput): MatchSettlementDecision {
  if (isAnonymousPlayerId(match.whitePlayerId) || isAnonymousPlayerId(match.blackPlayerId)) return { rated: false, reason: 'anonymous' };
  if (DRAW_RESULTS.has(match.result)) return { rated: true, white: 'draw', black: 'draw' };
  if (!DECISIVE_RESULTS.has(match.result)) return { rated: false, reason: 'unknown_result' };
  if (match.result === 'abandon') {
    if (!match.winnerId) return { rated: false, reason: 'double_forfeit' };
    if (pliesFromFen(match.fen) < ABORT_MAX_PLIES) return { rated: false, reason: 'aborted' };
  }
  if (match.winnerId === match.whitePlayerId) return { rated: true, white: 'win', black: 'loss' };
  if (match.winnerId === match.blackPlayerId) return { rated: true, white: 'loss', black: 'win' };
  return { rated: false, reason: 'unknown_result' };
}

export function isAnonymousPlayerId(id: string): boolean {
  return !id || id.startsWith('anon:');
}

export function outcomeScore(outcome: PlayerMatchOutcome): 0 | 0.5 | 1 {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
}

// ------------------------------------------------------------------ gambits

/** Gambits "cheios" que um resultado rende antes dos limites diários (praça e torneio valem igual). */
export function baseGambitsFor(outcome: PlayerMatchOutcome, rules: GambitRulesConfig): number {
  if (outcome === 'win') return rules.win;
  if (outcome === 'draw') return rules.draw;
  return rules.loss;
}

/** Motivo de fim da sala → regra de lances mínimos (abandono = desistência; os demais não têm mínimo). */
export function minMovesReasonFor(result: string): MinMovesReason | null {
  switch (result) {
    case 'resign':
    case 'abandon':
      return 'resign';
    case 'timeout':
      return 'timeout';
    case 'draw':
      return 'draw';
    case 'repetition':
      return 'repetition';
    default:
      return null;
  }
}

/** Lances completos (brancas + pretas) a partir dos plies jogados. */
export function completedMovesFromPlies(plies: number): number {
  return Math.floor(Math.max(0, plies) / 2);
}

/**
 * A regra de lances mínimos bloqueia os gambits DESTE jogador? Só olha o
 * motivo de fim, os lances completos e a quem a regra se aplica; empate
 * (acordo/repetição) sempre vale para os dois lados.
 */
export function blockedByMinMoves(result: string, outcome: PlayerMatchOutcome, plies: number, rules: MinMovesRules): boolean {
  const reason = minMovesReasonFor(result);
  if (!reason) return false;
  const rule = rules[reason];
  if (!rule || rule.minMoves <= 0) return false;
  if (completedMovesFromPlies(plies) >= rule.minMoves) return false;
  if (outcome === 'draw' || rule.appliesTo === 'both') return true;
  return rule.appliesTo === outcome;
}

/** Início (epoch ms, UTC) do "dia de gambits" que contém `now`. */
export function gambitDayStart(now: number, dayOffsetHours: number): number {
  const offsetMs = dayOffsetHours * 3_600_000;
  return Math.floor((now + offsetMs) / 86_400_000) * 86_400_000 - offsetMs;
}

export type GambitAwardReason = 'awarded' | 'opponent_limit' | 'daily_cap' | 'min_moves' | 'zero';

/** Aplica limite por adversário e teto diário a um prêmio base. */
export function applyGambitLimits(
  base: number,
  context: { gamesAgainstOpponentToday: number; gambitsEarnedToday: number },
  rules: GambitRulesConfig,
): { amount: number; reason: GambitAwardReason } {
  if (base <= 0) return { amount: 0, reason: 'zero' };
  if (context.gamesAgainstOpponentToday >= rules.opponentDailyLimit) return { amount: 0, reason: 'opponent_limit' };
  if (rules.dailyCap !== null) {
    const room = rules.dailyCap - context.gambitsEarnedToday;
    if (room <= 0) return { amount: 0, reason: 'daily_cap' };
    if (base > room) return { amount: room, reason: 'daily_cap' };
  }
  return { amount: base, reason: 'awarded' };
}

// ---------------------------------------------------------------- mensagens

/** `chess_rating_update` — sala → os dois jogadores, depois de `match_finished`. */
export interface RatingUpdatePlayer {
  playerId: string;
  username: string;
  outcome: PlayerMatchOutcome;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  ratingDeviationAfter: number;
  provisional: boolean;
  gambitsAwarded: number;
  gambitsReason: GambitAwardReason;
  gambitsTotal: number;
}

export interface ChessRatingUpdateMessage {
  matchId: string;
  kind: MatchKind;
  rated: boolean;
  /** Presente quando `rated: false`. */
  reason?: string;
  players: RatingUpdatePlayer[];
}

/** Colunas de rating no `profiles` (todas com default — o código funciona antes da migração). */
export interface PlayerRatingRow {
  userId: string;
  username: string;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  ratedGamesPlayed: number;
  peakRating: number;
  lastRatedAt: string | null;
  gambits: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
}

export function roundRating(value: number): number {
  return Math.round(value * 100) / 100;
}
