/**
 * HTTP client da página /admin/chess-matches (Supabase JWT, admin):
 *   GET {base}/api/admin/chess-matches?page&player&result&kind&status&from&to → MatchListResult
 * Tipos espelhados de server/src/rating/matchRepository.ts (o servidor é a fonte).
 */
import type { MatchKind } from '../../../shared/rating/RatingShapes';
import { adminRequest } from '../rating/ratingApi';

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
  ratingHistoryMissing: boolean;
  tableMissing: boolean;
  error: string | null;
  warning: string | null;
}

export interface MatchListQuery {
  page: number;
  player: string;
  result: string;
  kind: 'all' | MatchKind;
  status: 'all' | 'playing' | 'finished';
  from: string;
  to: string;
}

export const matchesApi = {
  list: (query: MatchListQuery): Promise<MatchListResult> => {
    const params = new URLSearchParams();
    params.set('page', String(query.page));
    if (query.player) params.set('player', query.player);
    if (query.result && query.result !== 'all') params.set('result', query.result);
    if (query.kind !== 'all') params.set('kind', query.kind);
    if (query.status !== 'all') params.set('status', query.status);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return adminRequest('GET', `/chess-matches?${params.toString()}`, 'ver o banco de partidas');
  },
};
