export const BOARDS = [
  { id: 'solved', label: 'Resolvidos' }, { id: 'battles', label: 'Batalhas' },
  { id: 'lessons', label: 'Lições' }, { id: 'problems', label: 'Problemas' },
  { id: 'firsttry', label: '1ª tentativa' }, { id: 'hardest', label: 'Rating máx.' },
] as const;
export const PERIODS = [
  { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mês' }, { id: 'all', label: 'Sempre' },
] as const;
export type BoardId = typeof BOARDS[number]['id'];
export type PeriodId = typeof PERIODS[number]['id'];
export const PAGE_SIZE = 8;
export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));
export const clampPage = (page: number, total: number, size = PAGE_SIZE) =>
  Math.max(1, Math.min(pageCount(total, size), Math.floor(page) || 1));
export const truncateName = (name: string, limit = 18) =>
  Array.from(name).length > limit ? `${Array.from(name).slice(0, limit - 1).join('')}…` : name;

export interface BoardRow { rank: number; userId: string; username: string; value: number }
export interface BoardResponse {
  rows: BoardRow[]; me: { rank: number; value: number } | null;
  page: number; size: number; totalPlayers: number; schemaMissing: boolean;
}
export interface SummaryResponse {
  summary: { solvedToday: number; activeToday: number; battlesToday: number; lessonsToday: number;
    topThemeWeek: string | null; totalSolved: number; totalBattles: number } | null;
  myTraining: { lessonsCompleted: number; lessonsTotal: number; attempted: number;
    solvedFirstTry: number; strongest: { theme: string }[] };
  schemaMissing: boolean;
}
export function parseBoardResponse(raw: unknown): BoardResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Resposta do ranking inválida.');
  const r = raw as BoardResponse;
  if (r.schemaMissing) return { rows: [], me: null, page: 1, size: PAGE_SIZE, totalPlayers: 0, schemaMissing: true };
  if (!Array.isArray(r.rows) || !Number.isFinite(r.totalPlayers) || !Number.isFinite(r.page))
    throw new Error('Resposta do ranking inválida.');
  return r;
}