import { puzzleClient } from '../puzzles/puzzleRepository.js';
import { buildLessonState } from '../lessons/lessonRepository.js';

export type StatsBoard = 'solved' | 'battles' | 'lessons' | 'problems' | 'firsttry' | 'hardest';
export type StatsPeriod = 'week' | 'month' | 'all';
export const statsBoards: StatsBoard[] = ['solved', 'battles', 'lessons', 'problems', 'firsttry', 'hardest'];
export const statsPeriods: StatsPeriod[] = ['week', 'month', 'all'];
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { until: number; data: any }>();
const missing = (error: { code?: string }) => ['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '');

async function rpc(name: string, args?: Record<string, unknown>): Promise<any> {
  const { data, error } = await puzzleClient().rpc(name, args);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  return data;
}

async function cached<T>(key: string, work: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const old = cache.get(key);
  if (old && old.until > now) return old.data as T;
  const data = await work();
  // Cache limitado: descarta o que venceu e, se ainda estiver cheio, o mais antigo (inserção).
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
    while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, { until: now + CACHE_TTL_MS, data });
  return data;
}

export async function academyBoard(board: StatsBoard, period: StatsPeriod, page: number, size: number, userId: string) {
  // A posição própria vem primeiro: traz o total de jogadores, que limita a página
  // pedida ao que existe (páginas além do fim não geram consultas novas).
  const own = await cached(`me:${board}:${period}:${userId}`, async () =>
    rpc('academy_my_rank', { p_board: board, p_period: period, p_user: userId }));
  if (own === null) return { rows: [], me: null, page, size, totalPlayers: 0, schemaMissing: true };
  const self = own?.[0];
  const totalPlayers: number = self?.total_players ?? 0;
  const lastPage = Math.max(1, Math.ceil(totalPlayers / size));
  const safePage = Math.min(page, lastPage);
  const common = await cached(`board:${board}:${period}:${safePage}:${size}`, async () => {
    const rows = await rpc('academy_rank_board', { p_board: board, p_period: period, p_limit: size, p_offset: (safePage - 1) * size });
    if (rows === null) return { rows: [], schemaMissing: true };
    return {
      rows: (rows as any[]).map((r) => ({ rank: r.rank, userId: r.user_id, username: r.username, value: r.value })),
      schemaMissing: false,
    };
  });
  if (common.schemaMissing) return { rows: [], me: null, page: safePage, size, totalPlayers: 0, schemaMissing: true };
  return { rows: common.rows, totalPlayers, schemaMissing: false,
    me: self?.rank == null ? null : { rank: self.rank, value: self.value }, page: safePage, size };
}

export async function academySummary(userId: string) {
  const [summary, training] = await Promise.all([
    cached('summary', () => rpc('academy_stats_summary')),
    buildLessonState(userId),
  ]);
  return { summary, myTraining: training.stats, schemaMissing: summary === null || training.schemaMissing };
}