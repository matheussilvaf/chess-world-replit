import { create } from 'zustand';
import type { DailyStatePayload, PuzzleFeedbackPayload, PuzzleSeat, PuzzleStartedPayload } from '../shared/academy/PuzzleShapes';

/** Cadeira ocupada pelo jogador local na mesa do puzzle diário. */
export interface DailySeat { boardId: string; seat: PuzzleSeat }

interface PuzzleState {
  daily: DailyStatePayload | null;
  dailyLoading: boolean;
  /** Puzzle diário em andamento (o tabuleiro em si fica em puzzleSessionStore). */
  activePuzzle: PuzzleStartedPayload | null;
  lastFeedback: PuzzleFeedbackPayload | null;
  /** Painel "Puzzles do dia" (lista de slots) aberto. */
  dailyOpen: boolean;
  seat: DailySeat | null;
  setDaily: (daily: DailyStatePayload | null) => void;
  setDailyLoading: (loading: boolean) => void;
  setActivePuzzle: (puzzle: PuzzleStartedPayload | null) => void;
  setFeedback: (feedback: PuzzleFeedbackPayload | null) => void;
  setDailyOpen: (open: boolean) => void;
  setSeat: (seat: DailySeat | null) => void;
  reset: () => void;
}

export const usePuzzleStore = create<PuzzleState>((set) => ({
  daily: null,
  dailyLoading: false,
  activePuzzle: null,
  lastFeedback: null,
  dailyOpen: false,
  seat: null,
  setDaily: (daily) => set({ daily, dailyLoading: false }),
  setDailyLoading: (dailyLoading) => set({ dailyLoading }),
  setActivePuzzle: (puzzle) => {
    if (puzzle?.context.kind === 'battle') return;
    set({ activePuzzle: puzzle, lastFeedback: null });
  },
  setFeedback: (lastFeedback) => set({ lastFeedback }),
  setDailyOpen: (dailyOpen) => set({ dailyOpen }),
  setSeat: (seat) => set({ seat }),
  reset: () => set({ daily: null, dailyLoading: false, activePuzzle: null, lastFeedback: null, dailyOpen: false, seat: null }),
}));
