/**
 * Acesso service-role às linhas de rating/gambits do `profiles`, ao histórico
 * `chess_rating_history` e ao ledger `gambit_awards`.
 *
 * Regras da casa: PostgREST não lança — todo read/write devolve `{ error }` e
 * o chamador decide. Coluna/tabela ausente (migração ainda não rodada) vira
 * `schemaMissing: true` para o serviço degradar sem quebrar a partida.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';
import {
  DEFAULT_RATING_GAMBITS_CONFIG,
  type GambitAwardReason,
  type MatchKind,
  type PlayerMatchOutcome,
  type PlayerRatingRow,
} from '../shared/rating/RatingShapes.js';

/** Postgres "column does not exist" (migração do rating ainda não rodou). */
export const isColumnMissing = (code: string | undefined, message?: string): boolean =>
  code === '42703' || (code === 'PGRST204' && /column/i.test(message ?? ''));

/** Violação de UNIQUE — a trava de idempotência do histórico/ledger. */
export const isUniqueViolation = (code: string | undefined): boolean => code === '23505';

export const RATING_PROFILE_COLUMNS =
  'user_id, username, rating, wins, losses, draws, games_played, chess_rating, chess_rating_deviation, chess_rating_volatility, chess_rated_games_played, chess_peak_rating, chess_last_rated_at, gambits';

type RawProfile = {
  user_id: string;
  username: string | null;
  rating: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  games_played: number | null;
  chess_rating: number | null;
  chess_rating_deviation: number | null;
  chess_rating_volatility: number | null;
  chess_rated_games_played: number | null;
  chess_peak_rating: number | null;
  chess_last_rated_at: string | null;
  gambits: number | null;
};

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export function mapRatingProfile(raw: RawProfile): PlayerRatingRow {
  const d = DEFAULT_RATING_GAMBITS_CONFIG.rating;
  const rating = num(raw.chess_rating, d.initialRating);
  return {
    userId: raw.user_id,
    username: raw.username ?? 'Jogador',
    rating,
    ratingDeviation: num(raw.chess_rating_deviation, d.initialRatingDeviation),
    volatility: num(raw.chess_rating_volatility, d.initialVolatility),
    ratedGamesPlayed: num(raw.chess_rated_games_played, 0),
    peakRating: num(raw.chess_peak_rating, rating),
    lastRatedAt: raw.chess_last_rated_at ?? null,
    gambits: num(raw.gambits, 0),
    wins: num(raw.wins, 0),
    losses: num(raw.losses, 0),
    draws: num(raw.draws, 0),
    gamesPlayed: num(raw.games_played, 0),
  };
}

export interface RatingProfilesResult {
  profiles: Map<string, PlayerRatingRow>;
  schemaMissing: boolean;
  error: string | null;
}

function requireClient(): { client: SupabaseClient | null; error: string | null } {
  const client = getServiceClient();
  return client ? { client, error: null } : { client: null, error: PERSISTENCE_UNAVAILABLE };
}

export async function getRatingProfiles(userIds: readonly string[]): Promise<RatingProfilesResult> {
  const { client, error: unavailable } = requireClient();
  const profiles = new Map<string, PlayerRatingRow>();
  if (!client) return { profiles, schemaMissing: false, error: unavailable };
  if (userIds.length === 0) return { profiles, schemaMissing: false, error: null };
  const { data, error } = await client.from('profiles').select(RATING_PROFILE_COLUMNS).in('user_id', [...userIds]);
  if (error) {
    if (isColumnMissing(error.code, error.message)) return { profiles, schemaMissing: true, error: null };
    return { profiles, schemaMissing: false, error: error.message };
  }
  for (const raw of (data ?? []) as RawProfile[]) profiles.set(raw.user_id, mapRatingProfile(raw));
  return { profiles, schemaMissing: false, error: null };
}

/** Fallback pré-migração: o `rating` inteiro legado do perfil. */
export async function getLegacyRating(userId: string): Promise<number | null> {
  const { client } = requireClient();
  if (!client) return null;
  const { data, error } = await client.from('profiles').select('rating').eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  const value = (data as { rating: number | null }).rating;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------- histórico

export interface RatingHistoryInsert {
  playerId: string;
  matchId: string;
  opponentId: string;
  result: PlayerMatchOutcome;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  rdBefore: number;
  rdAfter: number;
  volatilityAfter: number;
  opponentRatingBefore: number;
  matchKind: MatchKind;
}

export interface WriteOutcome {
  ok: boolean;
  /** UNIQUE violado = este par (partida, jogador) já foi aplicado antes. */
  duplicate: boolean;
  schemaMissing: boolean;
  error: string | null;
}

const writeError = (error: { code?: string; message: string }): WriteOutcome => ({
  ok: false,
  duplicate: isUniqueViolation(error.code),
  schemaMissing: isTableMissing(error.code) || isColumnMissing(error.code, error.message),
  error: isUniqueViolation(error.code) ? null : error.message,
});

export async function insertRatingHistory(rows: readonly RatingHistoryInsert[]): Promise<WriteOutcome> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ok: false, duplicate: false, schemaMissing: false, error: unavailable };
  const payload = rows.map((row) => ({
    player_id: row.playerId,
    match_id: row.matchId,
    opponent_id: row.opponentId,
    result: row.result,
    rating_before: row.ratingBefore,
    rating_after: row.ratingAfter,
    rating_delta: row.ratingDelta,
    rd_before: row.rdBefore,
    rd_after: row.rdAfter,
    volatility_after: row.volatilityAfter,
    opponent_rating_before: row.opponentRatingBefore,
    match_kind: row.matchKind,
  }));
  const { error } = await client.from('chess_rating_history').insert(payload);
  if (error) return writeError(error);
  return { ok: true, duplicate: false, schemaMissing: false, error: null };
}

export interface RatingHistoryRow {
  matchId: string;
  playerId: string;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  rdAfter: number;
}

export async function listRatingHistoryForMatches(matchIds: readonly string[]): Promise<{ rows: RatingHistoryRow[]; schemaMissing: boolean; error: string | null }> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { rows: [], schemaMissing: false, error: unavailable };
  if (matchIds.length === 0) return { rows: [], schemaMissing: false, error: null };
  const { data, error } = await client
    .from('chess_rating_history')
    .select('match_id, player_id, rating_before, rating_after, rating_delta, rd_after')
    .in('match_id', [...matchIds]);
  if (error) {
    if (isTableMissing(error.code)) return { rows: [], schemaMissing: true, error: null };
    return { rows: [], schemaMissing: false, error: error.message };
  }
  const rows = ((data ?? []) as Array<{ match_id: string; player_id: string; rating_before: number; rating_after: number; rating_delta: number; rd_after: number }>)
    .map((r) => ({ matchId: r.match_id, playerId: r.player_id, ratingBefore: r.rating_before, ratingAfter: r.rating_after, ratingDelta: r.rating_delta, rdAfter: r.rd_after }));
  return { rows, schemaMissing: false, error: null };
}

// ------------------------------------------------------------------- perfil

export interface RatingProfileUpdate {
  rating: number;
  ratingDeviation: number;
  volatility: number;
  ratedGamesPlayed: number;
  peakRating: number;
  lastRatedAt: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
}

/**
 * Grava o novo estado de rating. CAS em `chess_rated_games_played` (o valor
 * lido antes do cálculo): se ninguém mexeu, aplica; se 0 linhas, o chamador
 * decide (a partida em si já é única por jogador, então isso é só proteção).
 */
export async function updateRatingProfile(
  userId: string,
  expectedRatedGames: number | null,
  next: RatingProfileUpdate,
): Promise<{ ok: boolean; applied: boolean; schemaMissing: boolean; error: string | null }> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ok: false, applied: false, schemaMissing: false, error: unavailable };
  let query = client
    .from('profiles')
    .update({
      rating: Math.round(next.rating),
      chess_rating: next.rating,
      chess_rating_deviation: next.ratingDeviation,
      chess_rating_volatility: next.volatility,
      chess_rated_games_played: next.ratedGamesPlayed,
      chess_peak_rating: next.peakRating,
      chess_last_rated_at: next.lastRatedAt,
      wins: next.wins,
      losses: next.losses,
      draws: next.draws,
      games_played: next.gamesPlayed,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (expectedRatedGames !== null) query = query.eq('chess_rated_games_played', expectedRatedGames);
  const { data, error } = await query.select('user_id');
  if (error) {
    return { ok: false, applied: false, schemaMissing: isColumnMissing(error.code, error.message), error: error.message };
  }
  return { ok: true, applied: (data ?? []).length > 0, schemaMissing: false, error: null };
}

/** Reset em massa ao estado inicial (botão do admin / pós-migração). */
export async function resetAllRatings(initial: { rating: number; ratingDeviation: number; volatility: number }): Promise<{ ok: boolean; count: number; schemaMissing: boolean; error: string | null }> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ok: false, count: 0, schemaMissing: false, error: unavailable };
  const { data, error } = await client
    .from('profiles')
    .update({
      rating: Math.round(initial.rating),
      chess_rating: initial.rating,
      chess_rating_deviation: initial.ratingDeviation,
      chess_rating_volatility: initial.volatility,
      chess_rated_games_played: 0,
      chess_peak_rating: initial.rating,
      chess_last_rated_at: null,
      updated_at: new Date().toISOString(),
    })
    .not('user_id', 'is', null)
    .select('user_id');
  if (error) return { ok: false, count: 0, schemaMissing: isColumnMissing(error.code, error.message), error: error.message };
  return { ok: true, count: (data ?? []).length, schemaMissing: false, error: null };
}

/** Sonda se a migração já rodou (coluna chess_rating existe). */
export async function ratingSchemaReady(): Promise<{ ready: boolean; error: string | null }> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ready: false, error: unavailable };
  const { error } = await client.from('profiles').select('chess_rating').limit(1);
  if (!error) return { ready: true, error: null };
  if (isColumnMissing(error.code, error.message)) return { ready: false, error: null };
  return { ready: false, error: error.message };
}

// ------------------------------------------------------------------ gambits

export interface GambitAwardInsert {
  playerId: string;
  matchId: string;
  opponentId: string;
  amount: number;
  kind: MatchKind;
  reason: GambitAwardReason;
}

export async function insertGambitAward(row: GambitAwardInsert): Promise<WriteOutcome> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ok: false, duplicate: false, schemaMissing: false, error: unavailable };
  const { error } = await client.from('gambit_awards').insert({
    player_id: row.playerId,
    match_id: row.matchId,
    opponent_id: row.opponentId,
    amount: row.amount,
    kind: row.kind,
    reason: row.reason,
  });
  if (error) return writeError(error);
  return { ok: true, duplicate: false, schemaMissing: false, error: null };
}

export interface GambitDayStats {
  /** Partidas contra este adversário que já renderam (ou tentaram render) gambits hoje. */
  gamesAgainstOpponentToday: number;
  /** Total de gambits ganhos hoje. */
  gambitsEarnedToday: number;
}

export async function getGambitDayStats(
  playerId: string,
  opponentId: string,
  dayStartIso: string,
): Promise<{ stats: GambitDayStats; schemaMissing: boolean; error: string | null }> {
  const empty: GambitDayStats = { gamesAgainstOpponentToday: 0, gambitsEarnedToday: 0 };
  const { client, error: unavailable } = requireClient();
  if (!client) return { stats: empty, schemaMissing: false, error: unavailable };
  const { data, error } = await client
    .from('gambit_awards')
    .select('opponent_id, amount')
    .eq('player_id', playerId)
    .gte('created_at', dayStartIso);
  if (error) {
    if (isTableMissing(error.code)) return { stats: empty, schemaMissing: true, error: null };
    return { stats: empty, schemaMissing: false, error: error.message };
  }
  const stats: GambitDayStats = { gamesAgainstOpponentToday: 0, gambitsEarnedToday: 0 };
  for (const row of (data ?? []) as Array<{ opponent_id: string; amount: number }>) {
    stats.gambitsEarnedToday += num(row.amount, 0);
    // Só partidas que renderam gambits ocupam a "vaga" diária do adversário —
    // uma partida barrada pelo teto diário não deve consumir a vaga.
    if (row.opponent_id === opponentId && num(row.amount, 0) > 0) stats.gamesAgainstOpponentToday += 1;
  }
  return { stats, schemaMissing: false, error: null };
}

export interface GambitBalanceChange {
  ok: boolean;
  balance: number;
  /** Saldo insuficiente para o débito pedido. */
  insufficient: boolean;
  schemaMissing: boolean;
  error: string | null;
}

async function readGambits(client: SupabaseClient, userId: string): Promise<{ balance: number | null; schemaMissing: boolean; error: string | null }> {
  const { data, error } = await client.from('profiles').select('gambits').eq('user_id', userId).maybeSingle();
  if (error) return { balance: null, schemaMissing: isColumnMissing(error.code, error.message), error: error.message };
  if (!data) return { balance: null, schemaMissing: false, error: 'Perfil não encontrado' };
  return { balance: num((data as { gambits: number | null }).gambits, 0), schemaMissing: false, error: null };
}

/**
 * Soma `delta` (positivo = prêmio, negativo = débito) ao saldo com CAS no valor
 * lido (`.eq('gambits', atual)`) e até 3 tentativas — craft e fim de partida
 * podem mexer no mesmo saldo ao mesmo tempo. Débito nunca deixa saldo < 0.
 */
export async function changeGambits(userId: string, delta: number): Promise<GambitBalanceChange> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ok: false, balance: 0, insufficient: false, schemaMissing: false, error: unavailable };
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readGambits(client, userId);
    if (current.balance === null) return { ok: false, balance: 0, insufficient: false, schemaMissing: current.schemaMissing, error: current.error };
    if (delta === 0) return { ok: true, balance: current.balance, insufficient: false, schemaMissing: false, error: null };
    const next = current.balance + delta;
    if (next < 0) return { ok: false, balance: current.balance, insufficient: true, schemaMissing: false, error: null };
    const { data, error } = await client
      .from('profiles')
      .update({ gambits: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('gambits', current.balance)
      .select('gambits');
    if (error) return { ok: false, balance: current.balance, insufficient: false, schemaMissing: isColumnMissing(error.code, error.message), error: error.message };
    if ((data ?? []).length > 0) return { ok: true, balance: next, insufficient: false, schemaMissing: false, error: null };
    lastError = 'Saldo de gambits mudou durante a operação';
  }
  return { ok: false, balance: 0, insufficient: false, schemaMissing: false, error: lastError };
}

export async function getGambitBalance(userId: string): Promise<{ balance: number; schemaMissing: boolean; error: string | null }> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { balance: 0, schemaMissing: false, error: unavailable };
  const current = await readGambits(client, userId);
  return { balance: current.balance ?? 0, schemaMissing: current.schemaMissing, error: current.error };
}
