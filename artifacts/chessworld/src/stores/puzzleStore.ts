import { create } from 'zustand';
import type { DailyStatePayload, PuzzleFeedbackPayload, PuzzleStartedPayload } from '../shared/academy/PuzzleShapes';

interface PuzzleState {
  daily: DailyStatePayload | null;
  dailyLoading: boolean;
  activePuzzle: PuzzleStartedPayload | null;
  lastFeedback: PuzzleFeedbackPayload | null;
  dailyOpen: boolean;
  setDaily: (daily: DailyStatePayload | null) => void;
  setDailyLoading: (loading: boolean) => void;
  setActivePuzzle: (puzzle: PuzzleStartedPayload | null) => void;
  setFeedback: (feedback: PuzzleFeedbackPayload | null) => void;
  setDailyOpen: (open: boolean) => void;
  reset: () => void;
}

export const usePuzzleStore = create<PuzzleState>((set) => ({
  daily: null,
  dailyLoading: false,
  activePuzzle: null,
  lastFeedback: null,
  dailyOpen: false,
  setDaily: (daily) => set({ daily, dailyLoading: false }),
  setDailyLoading: (dailyLoading) => set({ dailyLoading }),
  setActivePuzzle: (puzzle) => {
    if (puzzle?.context.kind === 'battle') return;
    set({ activePuzzle: puzzle, lastFeedback: null });
  },
  setFeedback: (lastFeedback) => set({ lastFeedback }),
  setDailyOpen: (dailyOpen) => set({ dailyOpen }),
  reset: () => set({ daily: null, dailyLoading: false, activePuzzle: null, lastFeedback: null, dailyOpen: false }),
}));