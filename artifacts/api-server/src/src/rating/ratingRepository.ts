/**
 * Acesso service-role às linhas de rating/gambits do `profiles`, ao histórico
 * `chess_rating_history` e ao ledger `gambit_awards`.
 *
 * A liquidação de uma partida (histórico + ledger + perfil dos dois jogadores)
 * é UMA chamada à função SQL `chessworld_settle_match` (transação única com
 * lock nos dois perfis) — ver `settleMatchAtomic`. Aqui fora só ficam leituras
 * e o CAS de saldo de gambits usado pelo craft.
 *
 * Regras da casa: PostgREST não lança — todo read/write devolve `{ error }` e
 * o chamador decide. Coluna/tabela/função ausente (migração ainda não rodada)
 * vira `schemaMissing: true` para o serviço degradar sem quebrar a partida.
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

/** PGRST202 = função fora do schema cache do PostgREST; 42883 = função inexistente no Postgres. */
export const isFunctionMissing = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883';

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

// ------------------------------------------------------------- liquidação

/** Um lado da liquidação: tudo que a função SQL grava/verifica para o jogador. */
export interface SettlePlayerWrite {
  playerId: string;
  opponentId: string;
  result: PlayerMatchOutcome;
  /** CAS: `chess_rated_games_played` lido antes do cálculo. */
  expectedRatedGames: number;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  rdBefore: number;
  rdAfter: number;
  volatilityAfter: number;
  opponentRatingBefore: number;
  gambitsAmount: number;
  gambitsReason: GambitAwardReason;
  /** Início do "dia" de gambits (ISO) e o que o ledger mostrava nele (CAS). */
  dayStartIso: string;
  expectedOpponentGamesToday: number;
  expectedEarnedToday: number;
}

export type SettleStatus = 'applied' | 'already_settled' | 'conflict' | 'profile_missing';

export interface SettleAtomicResult {
  ok: boolean;
  status: SettleStatus | null;
  /** Saldo de gambits pós-liquidação por jogador (só em `applied`). */
  gambits: Map<string, number>;
  schemaMissing: boolean;
  error: string | null;
}

/**
 * `chessworld_settle_match`: trava os dois perfis (ordem fixa), confere que
 * a partida ainda não foi liquidada e que o estado pré-partida usado no
 * cálculo continua valendo (contador de partidas avaliadas + ledger do dia),
 * e grava histórico + ledger + perfil dos dois numa transação só.
 * `conflict` = alguém mexeu num dos perfis nesse meio-tempo: recalcular e
 * chamar de novo. Função ausente = migração pendente (`schemaMissing`).
 */
export async function settleMatchAtomic(
  matchId: string,
  kind: MatchKind,
  settledAtIso: string,
  players: readonly [SettlePlayerWrite, SettlePlayerWrite],
): Promise<SettleAtomicResult> {
  const { client, error: unavailable } = requireClient();
  const none = new Map<string, number>();
  if (!client) return { ok: false, status: null, gambits: none, schemaMissing: false, error: unavailable };
  const payload = players.map((p) => ({
    player_id: p.playerId,
    opponent_id: p.opponentId,
    result: p.result,
    expected_rated_games: p.expectedRatedGames,
    rating_before: p.ratingBefore,
    rating_after: p.ratingAfter,
    rating_delta: p.ratingDelta,
    rd_before: p.rdBefore,
    rd_after: p.rdAfter,
    volatility_after: p.volatilityAfter,
    opponent_rating_before: p.opponentRatingBefore,
    gambits_amount: p.gambitsAmount,
    gambits_reason: p.gambitsReason,
    day_start: p.dayStartIso,
    expected_opponent_games_today: p.expectedOpponentGamesToday,
    expected_earned_today: p.expectedEarnedToday,
  }));
  const { data, error } = await client.rpc('chessworld_settle_match', {
    p_match_id: matchId,
    p_kind: kind,
    p_settled_at: settledAtIso,
    p_players: payload,
  });
  if (error) {
    const schemaMissing = isFunctionMissing(error.code) || isTableMissing(error.code) || isColumnMissing(error.code, error.message);
    return { ok: false, status: null, gambits: none, schemaMissing, error: schemaMissing ? null : error.message };
  }
  const body = (data ?? null) as { status?: unknown; gambits?: Record<string, unknown> } | null;
  const status = body?.status;
  if (status !== 'applied' && status !== 'already_settled' && status !== 'conflict' && status !== 'profile_missing') {
    return { ok: false, status: null, gambits: none, schemaMissing: false, error: `Resposta inválida de chessworld_settle_match: ${JSON.stringify(body)}` };
  }
  const gambits = new Map<string, number>();
  for (const [playerId, balance] of Object.entries(body?.gambits ?? {})) gambits.set(playerId, num(balance, 0));
  return { ok: status === 'applied', status, gambits, schemaMissing: false, error: null };
}

export type AwardStatus = 'applied' | 'already_awarded' | 'profile_missing';

export interface AwardGambitsResult {
  ok: boolean;
  status: AwardStatus | null;
  /** Quanto foi creditado de fato (teto diário pode reduzir) e o saldo resultante — só em `applied`. */
  amount: number;
  reason: GambitAwardReason | null;
  balance: number | null;
  schemaMissing: boolean;
  error: string | null;
}

/**
 * `chessworld_award_gambits`: prêmio avulso (sem adversário) — ledger + saldo
 * numa transação, idempotente por (matchId, playerId). O teto diário é
 * aplicado dentro da função com o perfil travado.
 */
export async function awardGambitsAtomic(input: {
  matchId: string;
  playerId: string;
  amount: number;
  kind: string;
  dayStartIso: string;
  dailyCap: number | null;
  awardedAtIso: string;
}): Promise<AwardGambitsResult> {
  const { client, error: unavailable } = requireClient();
  const fail = (error: string | null, schemaMissing = false): AwardGambitsResult =>
    ({ ok: false, status: null, amount: 0, reason: null, balance: null, schemaMissing, error });
  if (!client) return fail(unavailable);
  const { data, error } = await client.rpc('chessworld_award_gambits', {
    p_match_id: input.matchId,
    p_player_id: input.playerId,
    p_amount: input.amount,
    p_kind: input.kind,
    p_day_start: input.dayStartIso,
    p_daily_cap: input.dailyCap,
    p_awarded_at: input.awardedAtIso,
  });
  if (error) {
    const schemaMissing = isFunctionMissing(error.code) || isTableMissing(error.code) || isColumnMissing(error.code, error.message);
    return fail(schemaMissing ? null : error.message, schemaMissing);
  }
  const body = (data ?? null) as { status?: unknown; amount?: unknown; reason?: unknown; gambits?: unknown } | null;
  const status = body?.status;
  if (status !== 'applied' && status !== 'already_awarded' && status !== 'profile_missing') {
    return fail(`Resposta inválida de chessworld_award_gambits: ${JSON.stringify(body)}`);
  }
  const reason = body?.reason;
  return {
    ok: status === 'applied',
    status,
    amount: status === 'applied' ? num(body?.amount, 0) : 0,
    reason: reason === 'awarded' || reason === 'daily_cap' || reason === 'zero' ? reason : null,
    balance: status === 'applied' ? num(body?.gambits, 0) : null,
    schemaMissing: false,
    error: null,
  };
}

// ---------------------------------------------------------------- histórico

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

/**
 * Sonda se a migração já rodou: coluna `chess_rating` E a função
 * `chessworld_settle_match` (chamada com payload vazio: a função existe se
 * responder com a própria exceção de validação, P0001).
 */
export interface RatingSchemaStatus {
  /** Tudo pronto (colunas, liquidação e bônus de campeão). */
  ready: boolean;
  /** Colunas + função de liquidação prontas: as partidas são avaliadas mesmo que o resto falte. */
  coreReady: boolean;
  error: string | null;
}

export async function ratingSchemaReady(): Promise<RatingSchemaStatus> {
  const { client, error: unavailable } = requireClient();
  if (!client) return { ready: false, coreReady: false, error: unavailable };
  const { error } = await client.from('profiles').select('chess_rating').limit(1);
  if (error) {
    if (isColumnMissing(error.code, error.message)) return { ready: false, coreReady: false, error: null };
    return { ready: false, coreReady: false, error: error.message };
  }
  const probes: Array<{ name: string; hint: string; run: () => PromiseLike<{ error: { code?: string; message: string } | null }> }> = [
    {
      name: 'chessworld_settle_match',
      hint: 'liquidação das partidas',
      run: () => client.rpc('chessworld_settle_match', { p_match_id: '', p_kind: 'plaza', p_settled_at: new Date().toISOString(), p_players: [] }),
    },
    {
      name: 'chessworld_award_gambits',
      hint: 'bônus do campeão de torneio',
      run: () => client.rpc('chessworld_award_gambits', { p_match_id: '', p_player_id: null, p_amount: 0, p_kind: 'probe', p_day_start: new Date().toISOString(), p_daily_cap: null, p_awarded_at: new Date().toISOString() }),
    },
  ];
  // coreReady = colunas + liquidação (partidas são avaliadas); ready = tudo,
  // inclusive o bônus de campeão (função adicionada depois).
  let coreReady = true;
  for (const probe of probes) {
    const { error: probeError } = await probe.run();
    let failure: string | null = null;
    if (!probeError) failure = `${probe.name} respondeu a um payload vazio — versão inesperada da função`;
    else if (isFunctionMissing(probeError.code)) failure = `função ${probe.name} (${probe.hint}) ausente — rode o SQL de migração de novo`;
    else if (probeError.code !== 'P0001') failure = probeError.message;
    if (failure) {
      if (probe.name === 'chessworld_settle_match') coreReady = false;
      return { ready: false, coreReady, error: failure };
    }
  }
  return { ready: true, coreReady: true, error: null };
}

// ------------------------------------------------------------------ gambits

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
