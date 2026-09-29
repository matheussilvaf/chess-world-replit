import { checkPuzzleError, puzzleClient, PuzzleStorageError } from '../puzzles/puzzleRepository.js';
import { buildLessonState } from '../lessons/lessonRepository.js';
import { ACADEMY_POINT_ACTIONS, STATS_BOARDS, STATS_PERIODS, type AcademyPointKey, type AcademyPointsResponse,
  type StatsBoard, type StatsPeriod } from '../../shared/academy/StatsShapes.js';

export type { StatsBoard, StatsPeriod };
export const statsBoards: readonly StatsBoard[] = STATS_BOARDS;
export const statsPeriods: readonly StatsPeriod[] = STATS_PERIODS;
/** SQL que cria as funções de ranking e a tabela de pesos (reexecutável). */
export const STATS_SQL = 'server/supabase/tactics_academy_stats.sql';
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { until: number; data: any }>();
const missing = (error: { code?: string }) => ['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '');

/** Esquece rankings e resumo em memória (pesos de pontos alterados pelo admin). */
export function clearStatsCache(): void {
  cache.clear();
}

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
  const missingResponse = { rows: [], me: null, page, size, totalPlayers: 0, schemaMissing: true };
  let own: any;
  try {
    own = await cached(`me:${board}:${period}:${userId}`, async () =>
      rpc('academy_my_rank', { p_board: board, p_period: period, p_user: userId }));
  } catch (e) {
    // SQL antigo (sem o quadro "Pontos"): a função rejeita o filtro → mesmo aviso de "execute o SQL".
    if (board === 'points' && e instanceof Error && e.message.includes('Filtro de ranking inválido')) return missingResponse;
    throw e;
  }
  if (own === null) return missingResponse;
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
const pointsDocument = (rows: { key: string; points: number }[] | null): AcademyPointsResponse => ({
  items: ACADEMY_POINT_ACTIONS.map((action) => ({
    key: action.key, label: action.label, description: action.description, defaultPoints: action.defaultPoints,
    points: rows?.find((r) => r.key === action.key)?.points ?? action.defaultPoints,
  })),
  schemaMissing: rows === null,
});

/** Pesos do quadro "Pontos". Tabela ausente → padrões com `schemaMissing` (o SQL ainda não foi executado). */
export async function academyPointsConfig(): Promise<AcademyPointsResponse> {
  return cached('points-config', async () => {
    const { data, error } = await puzzleClient().from('academy_points_config').select('key,points');
    if (error) {
      if (missing(error)) return pointsDocument(null);
      throw new Error(error.message);
    }
    return pointsDocument(data as { key: string; points: number }[]);
  });
}

/** Grava todos os pesos e invalida rankings em cache. Lança PuzzleStorageError(schemaMissing) sem a tabela. */
export async function saveAcademyPoints(points: Record<AcademyPointKey, number>): Promise<AcademyPointsResponse> {
  const updatedAt = new Date().toISOString();
  const { error } = await puzzleClient().from('academy_points_config').upsert(
    ACADEMY_POINT_ACTIONS.map((action) => ({ key: action.key, points: points[action.key], updated_at: updatedAt })),
    { onConflict: 'key' },
  );
  if (error && missing(error)) throw new PuzzleStorageError(error.message, true);
  checkPuzzleError(error);
  clearStatsCache();
  return academyPointsConfig();
}
