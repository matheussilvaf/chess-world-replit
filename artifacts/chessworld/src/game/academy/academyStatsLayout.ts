import { STATS_BOARDS, STATS_BOARD_INFO, STATS_PERIODS, STATS_PERIOD_INFO,
  type StatsBoard, type StatsPeriod, type StatsBoardRow, type StatsBoardResponse, type StatsSummaryResponse } from '../../shared/academy/StatsShapes';
export const BOARDS = STATS_BOARDS.map((id) => ({ id, label: STATS_BOARD_INFO[id].label }));
export const PERIODS = STATS_PERIODS.map((id) => ({ id, label: STATS_PERIOD_INFO[id].label }));
export type BoardId = StatsBoard;
export type PeriodId = StatsPeriod;
export const PAGE_SIZE = 8;
export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));
export const clampPage = (page: number, total: number, size = PAGE_SIZE) =>
  Math.max(1, Math.min(pageCount(total, size), Math.floor(page) || 1));
export const truncateName = (name: string, limit = 18) =>
  Array.from(name).length > limit ? `${Array.from(name).slice(0, limit - 1).join('')}…` : name;

export type BoardRow = StatsBoardRow;
export type BoardResponse = StatsBoardResponse;
export type SummaryResponse = StatsSummaryResponse;
export function parseBoardResponse(raw: unknown): BoardResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Resposta do ranking inválida.');
  const r = raw as BoardResponse;
  if (r.schemaMissing) return { rows: [], me: null, page: 1, size: PAGE_SIZE, totalPlayers: 0, schemaMissing: true };
  if (!Array.isArray(r.rows) || !Number.isFinite(r.totalPlayers) || !Number.isFinite(r.page))
    throw new Error('Resposta do ranking inválida.');
  return r;
}