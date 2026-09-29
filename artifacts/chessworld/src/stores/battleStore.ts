import { create } from 'zustand';
import type { BattleStatePayload, PuzzleFeedbackPayload, PuzzleStartedPayload } from '../shared/academy/PuzzleShapes';

interface BattleStore {
  battle: BattleStatePayload | null;
  puzzle: PuzzleStartedPayload | null;
  feedback: PuzzleFeedbackPayload | null;
  screenOpen: boolean;
  setBattle: (battle: BattleStatePayload | null) => void;
  setPuzzle: (puzzle: PuzzleStartedPayload | null) => void;
  setFeedback: (feedback: PuzzleFeedbackPayload | null) => void;
  setScreenOpen: (open: boolean) => void;
  clear: () => void;
}

export const useBattleStore = create<BattleStore>((set) => ({
  battle: null, puzzle: null, feedback: null, screenOpen: false,
  setBattle: (battle) => set((state) => ({
    battle, puzzle: state.battle?.battleId === battle?.battleId ? state.puzzle : null,
    feedback: state.battle?.battleId === battle?.battleId ? state.feedback : null,
  })),
  setPuzzle: (puzzle) => set({ puzzle: puzzle?.context.kind === 'battle' ? puzzle : null, feedback: null }),
  setFeedback: (feedback) => set({ feedback }),
  setScreenOpen: (screenOpen) => set({ screenOpen }),
  clear: () => set({ battle: null, puzzle: null, feedback: null, screenOpen: false }),
}));

export const selectMyActiveBattle = (state: BattleStore) =>
  state.battle?.phase === 'countdown' || state.battle?.phase === 'running' ? state.battle : null;