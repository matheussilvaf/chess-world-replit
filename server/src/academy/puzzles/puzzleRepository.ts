import { getServiceClient, isTableMissing, PERSISTENCE_UNAVAILABLE } from '../../rigs/serviceSupabase.js';
import { isValidPuzzle } from '../../shared/academy/puzzleSolver.js';

export interface PuzzleRow {
  puzzleId: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  gameUrl: string | null;
}

export class PuzzleStorageError extends Error {
  constructor(message: string, public readonly schemaMissing = false) { super(message); }
}

export function puzzleClient() {
  const client = getServiceClient();
  if (!client) throw new PuzzleStorageError(PERSISTENCE_UNAVAILABLE);
  return client;
}
export function checkPuzzleError(error: { code?: string; message: string } | null): void {
  if (error) throw new PuzzleStorageError(error.message, isTableMissing(error.code));
}
export function parsePuzzle(row: any): PuzzleRow {
  return { puzzleId: row.puzzle_id, fen: row.fen, moves: row.moves, rating: row.rating, themes: row.themes ?? [], gameUrl: row.game_url ?? null };
}
export async function getPuzzleById(id: string): Promise<PuzzleRow | null> {
  const { data, error } = await puzzleClient().from('lichess_puzzles').select('puzzle_id,fen,moves,rating,themes,game_url').eq('puzzle_id', id).maybeSingle();
  checkPuzzleError(error);
  return data && isValidPuzzle(data) ? parsePuzzle(data) : null;
}
export async function getPuzzlesByIds(ids: string[]): Promise<PuzzleRow[]> {
  if (!ids.length) return [];
  const { data, error } = await puzzleClient().from('lichess_puzzles').select('puzzle_id,fen,moves,rating,themes,game_url').in('puzzle_id', ids);
  checkPuzzleError(error);
  return (data ?? []).filter(isValidPuzzle).map(parsePuzzle);
}
export interface PuzzleFilter { ratingMin: number; ratingMax: number; theme?: string; excludeIds?: string[] }
export async function drawPuzzle(filter: PuzzleFilter): Promise<PuzzleRow | null> {
  const excluded = new Set(filter.excludeIds ?? []);
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = Math.random();
    for (const upper of [true, false]) {
      let query = puzzleClient().from('lichess_puzzles').select('puzzle_id,fen,moves,rating,themes,game_url')
        .gte('rating', filter.ratingMin).lte('rating', filter.ratingMax);
      if (filter.theme) query = query.contains('themes', [filter.theme]);
      if (excluded.size && excluded.size < 200) query = query.not('puzzle_id', 'in', `(${[...excluded].map((id) => `"${id.replace(/["\\]/g, '')}"`).join(',')})`);
      query = upper ? query.gte('random_key', key).order('random_key', { ascending: true }) :
        query.lt('random_key', key).order('random_key', { ascending: false });
      const { data, error } = await query.limit(1);
      checkPuzzleError(error);
      if (data?.[0] && !excluded.has(data[0].puzzle_id) && isValidPuzzle(data[0])) return parsePuzzle(data[0]);
    }
  }
  return null;
}
export async function countPuzzles(filter: PuzzleFilter): Promise<number> {
  let query = puzzleClient().from('lichess_puzzles').select('puzzle_id', { head: true, count: 'exact' })
    .gte('rating', filter.ratingMin).lte('rating', filter.ratingMax);
  if (filter.theme) query = query.contains('themes', [filter.theme]);
  const { count, error } = await query;
  checkPuzzleError(error);
  return count ?? 0;
}
export async function listThemeCounts(): Promise<{ theme: string; count: number }[]> {
  const { data, error } = await puzzleClient().from('academy_puzzle_themes').select('theme,count').order('count', { ascending: false });
  checkPuzzleError(error);
  return data ?? [];
}