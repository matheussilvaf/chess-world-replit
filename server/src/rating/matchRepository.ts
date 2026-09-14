/**
 * Persistência de TODAS as partidas da sala (praça e torneio) na tabela
 * `matches` existente + listagem paginada para o admin "Chess Matches Database".
 *
 * Praça: a sala insere no início (`persistMatchStart`) e fecha no fim
 * (`persistMatchFinish`). Torneio: o coordinator continua inserindo/fechando
 * a linha (com os campos de torneio); aqui só a leitura é comum aos dois.
 */
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';
import { isAnonymousPlayerId, pliesFromFen, type MatchKind } from '../shared/rating/RatingShapes.js';
import { listRatingHistoryForMatches } from './ratingRepository.js';

export interface MatchStartRecord {
  colyseusMatchId: string;
  boardId: string;
  region: string;
  whiteUserId: string;
  blackUserId: string;
  fen: string;
  timeMinutes: number;
  incrementSeconds: number;
  whiteTimeMs: number;
  blackTimeMs: number;
}

export interface MatchFinishRecord {
  colyseusMatchId: string;
  result: string;
  winnerUserId: string | null;
  fen: string;
  pgn: string;
  turn: string;
  whiteTimeMs: number;
  blackTimeMs: number;
}

/** Insere a linha da partida da praça (jogadores anônimos não são persistidos — a coluna é uuid). */
export async function persistMatchStart(record: MatchStartRecord): Promise<{ ok: boolean; skipped: boolean; error: string | null }> {
  if (isAnonymousPlayerId(record.whiteUserId) || isAnonymousPlayerId(record.blackUserId)) return { ok: true, skipped: true, error: null };
  const client = getServiceClient();
  if (!client) return { ok: false, skipped: false, error: PERSISTENCE_UNAVAILABLE };
  const { data: existing, error: readError } = await client
    .from('matches')
    .select('id')
    .eq('colyseus_match_id', record.colyseusMatchId)
    .maybeSingle();
  if (readError) return { ok: false, skipped: false, error: readError.message };
  if (existing?.id) return { ok: true, skipped: false, error: null };
  const { error } = await client.from('matches').insert({
    colyseus_match_id: record.colyseusMatchId,
    board_id: record.boardId,
    white_user_id: record.whiteUserId,
    black_user_id: record.blackUserId,
    region: record.region,
    current_fen: record.fen,
    pgn: '',
    status: 'playing',
    turn: 'w',
    time_minutes: record.timeMinutes,
    increment_seconds: record.incrementSeconds,
    white_time_ms: record.whiteTimeMs,
    black_time_ms: record.blackTimeMs,
    last_move_at: new Date().toISOString(),
  });
  if (error) return { ok: false, skipped: false, error: error.message };
  return { ok: true, skipped: false, error: null };
}

/**
 * Fecha a linha (status/result/pgn/fen/relógios/finished_at). Se o insert do
 * início falhou (ex.: banco fora do ar naquele instante), grava a linha inteira
 * agora usando `start` — nenhuma partida terminada fica sem registro.
 */
export async function persistMatchFinish(
  finish: MatchFinishRecord,
  start: MatchStartRecord,
): Promise<{ ok: boolean; skipped: boolean; error: string | null }> {
  if (isAnonymousPlayerId(start.whiteUserId) || isAnonymousPlayerId(start.blackUserId)) return { ok: true, skipped: true, error: null };
  const client = getServiceClient();
  if (!client) return { ok: false, skipped: false, error: PERSISTENCE_UNAVAILABLE };
  const finishedAt = new Date().toISOString();
  const patch = {
    status: 'finished',
    result: finish.result,
    winner_user_id: finish.winnerUserId,
    current_fen: finish.fen,
    pgn: finish.pgn,
    turn: finish.turn,
    white_time_ms: finish.whiteTimeMs,
    black_time_ms: finish.blackTimeMs,
    finished_at: finishedAt,
  };
  const { data, error } = await client
    .from('matches')
    .update(patch)
    .eq('colyseus_match_id', finish.colyseusMatchId)
    .select('id');
  if (error) return { ok: false, skipped: false, error: error.message };
  if ((data ?? []).length > 0) return { ok: true, skipped: false, error: null };
  const { error: insertError } = await client.from('matches').insert({
    colyseus_match_id: start.colyseusMatchId,
    board_id: start.boardId,
    white_user_id: start.whiteUserId,
    black_user_id: start.blackUserId,
    region: start.region,
    time_minutes: start.timeMinutes,
    increment_seconds: start.incrementSeconds,
    last_move_at: finishedAt,
    ...patch,
  });
  if (insertError) return { ok: false, skipped: false, error: insertError.message };
  return { ok: true, skipped: false, error: null };
}

// -------------------------------------------------------------------- admin

export const MATCHES_PAGE_SIZE = 20;

export interface MatchListFilters {
  page: number;
  /** Nome de usuário (parcial, case-insensitive) ou user_id exato. */
  player: string;
  result: string;
  kind: 'all' | MatchKind;
  status: 'all' | 'playing' | 'finished';
  /** ISO date (YYYY-MM-DD) inclusive. */
  from: string;
  to: string;
}

export interface MatchListPlayer {
  id: string | null;
  username: string;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
}

export interface MatchListEntry {
  id: string;
  colyseusMatchId: string | null;
  kind: MatchKind;
  createdAt: string | null;
  finishedAt: string | null;
  status: string | null;
  result: string | null;
  boardId: string | null;
  region: string | null;
  tournamentId: string | null;
  tournamentRound: number | null;
  tournamentBoardNumber: number | null;
  tournamentScore: string | null;
  white: MatchListPlayer;
  black: MatchListPlayer;
  winnerUserId: string | null;
  plies: number;
  timeMinutes: number | null;
  incrementSeconds: number | null;
  fen: string | null;
  pgn: string | null;
}

export interface MatchListResult {
  page: number;
  pageSize: number;
  total: number;
  matches: MatchListEntry[];
  /** Histórico de rating ainda sem tabela (migração pendente). */
  ratingHistoryMissing: boolean;
  tableMissing: boolean;
  error: string | null;
  /** Falha parcial (ex.: histórico de rating indisponível) — a lista ainda vale. */
  warning: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawMatch = {
  id: string;
  colyseus_match_id: string | null;
  created_at: string | null;
  finished_at: string | null;
  status: string | null;
  result: string | null;
  board_id: string | null;
  region: string | null;
  tournament_id: string | null;
  tournament_round: number | null;
  tournament_board_number: number | null;
  tournament_score: string | null;
  white_user_id: string | null;
  black_user_id: string | null;
  winner_user_id: string | null;
  current_fen: string | null;
  pgn: string | null;
  time_minutes: number | null;
  increment_seconds: number | null;
};

export async function listMatchesForAdmin(filters: MatchListFilters): Promise<MatchListResult> {
  const empty = (error: string | null, tableMissing = false): MatchListResult => ({
    page: filters.page,
    pageSize: MATCHES_PAGE_SIZE,
    total: 0,
    matches: [],
    ratingHistoryMissing: false,
    tableMissing,
    error,
    warning: null,
  });
  const client = getServiceClient();
  if (!client) return empty(PERSISTENCE_UNAVAILABLE);

  // Filtro por jogador: username parcial → ids; uuid → id direto.
  let playerIds: string[] | null = null;
  const player = filters.player.trim();
  if (player) {
    if (UUID_RE.test(player)) playerIds = [player.toLowerCase()];
    else {
      const escaped = player.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[(),]/g, '');
      const { data, error } = await client.from('profiles').select('user_id').ilike('username', `%${escaped}%`).limit(50);
      if (error) return empty(error.message);
      playerIds = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
      if (playerIds.length === 0) return empty(null);
    }
  }

  const offset = (filters.page - 1) * MATCHES_PAGE_SIZE;
  let query = client
    .from('matches')
    .select(
      'id, colyseus_match_id, created_at, finished_at, status, result, board_id, region, tournament_id, tournament_round, tournament_board_number, tournament_score, white_user_id, black_user_id, winner_user_id, current_fen, pgn, time_minutes, increment_seconds',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + MATCHES_PAGE_SIZE - 1);
  if (playerIds) {
    const list = playerIds.join(',');
    query = query.or(`white_user_id.in.(${list}),black_user_id.in.(${list})`);
  }
  if (filters.result) query = query.eq('result', filters.result);
  if (filters.kind === 'plaza') query = query.is('tournament_id', null);
  if (filters.kind === 'tournament') query = query.not('tournament_id', 'is', null);
  if (filters.status === 'playing') query = query.eq('status', 'playing');
  if (filters.status === 'finished') query = query.neq('status', 'playing');
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00.000Z`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) {
    if (isTableMissing(error.code)) return empty(null, true);
    return empty(error.message);
  }
  const rows = (data ?? []) as RawMatch[];

  const userIds = new Set<string>();
  const colyseusIds: string[] = [];
  for (const row of rows) {
    if (row.white_user_id) userIds.add(row.white_user_id);
    if (row.black_user_id) userIds.add(row.black_user_id);
    if (row.colyseus_match_id) colyseusIds.push(row.colyseus_match_id);
  }
  const names = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles, error: profilesError } = await client.from('profiles').select('user_id, username').in('user_id', [...userIds]);
    if (profilesError) return empty(profilesError.message);
    for (const p of (profiles ?? []) as Array<{ user_id: string; username: string | null }>) names.set(p.user_id, p.username ?? 'Jogador');
  }
  const history = await listRatingHistoryForMatches(colyseusIds);
  const historyByKey = new Map<string, { ratingBefore: number; ratingAfter: number; ratingDelta: number }>();
  for (const h of history.rows) historyByKey.set(`${h.matchId}|${h.playerId}`, h);

  const toPlayer = (userId: string | null, colyseusId: string | null): MatchListPlayer => {
    const h = userId && colyseusId ? historyByKey.get(`${colyseusId}|${userId}`) : undefined;
    return {
      id: userId,
      username: userId ? names.get(userId) ?? userId.slice(0, 8) : '—',
      ratingBefore: h ? h.ratingBefore : null,
      ratingAfter: h ? h.ratingAfter : null,
      ratingDelta: h ? h.ratingDelta : null,
    };
  };

  const matches: MatchListEntry[] = rows.map((row) => ({
    id: row.id,
    colyseusMatchId: row.colyseus_match_id,
    kind: row.tournament_id ? 'tournament' : 'plaza',
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    status: row.status,
    result: row.result,
    boardId: row.board_id,
    region: row.region,
    tournamentId: row.tournament_id,
    tournamentRound: row.tournament_round,
    tournamentBoardNumber: row.tournament_board_number,
    tournamentScore: row.tournament_score,
    white: toPlayer(row.white_user_id, row.colyseus_match_id),
    black: toPlayer(row.black_user_id, row.colyseus_match_id),
    winnerUserId: row.winner_user_id,
    plies: pliesFromFen(row.current_fen ?? ''),
    timeMinutes: row.time_minutes,
    incrementSeconds: row.increment_seconds,
    fen: row.current_fen,
    pgn: row.pgn,
  }));

  return {
    page: filters.page,
    pageSize: MATCHES_PAGE_SIZE,
    total: count ?? matches.length,
    matches,
    ratingHistoryMissing: history.schemaMissing,
    tableMissing: false,
    error: null,
    warning: history.error,
  };
}
