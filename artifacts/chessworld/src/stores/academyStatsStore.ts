import { create } from 'zustand';
import type { StatsBoard, StatsPeriod } from '../shared/academy/StatsShapes';

interface AcademyStatsState {
  open: boolean;
  board: StatsBoard;
  period: StatsPeriod;
  page: number;
  openModal: (initial?: Partial<Pick<AcademyStatsState, 'board' | 'period' | 'page'>>) => void;
  close: () => void;
  setBoard: (board: StatsBoard) => void;
  setPeriod: (period: StatsPeriod) => void;
  setPage: (page: number) => void;
}
export const useAcademyStatsStore = create<AcademyStatsState>((set) => ({
  open: false, board: 'points', period: 'week', page: 1,
  openModal: (initial) => set({ board: initial?.board ?? 'points', period: initial?.period ?? 'week', page: initial?.page ?? 1, open: true }),
  close: () => set({ open: false }),
  setBoard: (board) => set({ board, page: 1 }),
  setPeriod: (period) => set({ period, page: 1 }),
  setPage: (page) => set({ page: Math.max(1, Math.floor(page) || 1) }),
}));