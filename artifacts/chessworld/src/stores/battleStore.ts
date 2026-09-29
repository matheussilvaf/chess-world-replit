import { create } from 'zustand';
import type { BattleStatePayload, PuzzleFeedbackPayload, PuzzleStartedPayload } from '../shared/academy/PuzzleShapes';

interface BattleStore {
  battle: BattleStatePayload | null;
  /** Instante local em que `battle` chegou (para projetar `serverNow` sem congelar contagens). */
  receivedAt: number;
  puzzle: PuzzleStartedPayload | null;
  feedback: PuzzleFeedbackPayload | null;
  /** HUD/tabuleiro da batalha visíveis (até o jogador fechar o resultado). */
  screenOpen: boolean;
  setBattle: (battle: BattleStatePayload | null) => void;
  setPuzzle: (puzzle: PuzzleStartedPayload | null) => void;
  setFeedback: (feedback: PuzzleFeedbackPayload | null) => void;
  setScreenOpen: (open: boolean) => void;
  clear: () => void;
}

export const useBattleStore = create<BattleStore>((set) => ({
  battle: null, receivedAt: 0, puzzle: null, feedback: null, screenOpen: false,
  setBattle: (battle) => set((state) => ({
    battle, receivedAt: Date.now(),
    puzzle: state.battle?.battleId === battle?.battleId ? state.puzzle : null,
    feedback: state.battle?.battleId === battle?.battleId ? state.feedback : null,
  })),
  setPuzzle: (puzzle) => set({ puzzle: puzzle?.context.kind === 'battle' ? puzzle : null, feedback: null }),
  setFeedback: (feedback) => set({ feedback }),
  setScreenOpen: (screenOpen) => set({ screenOpen }),
  clear: () => set({ battle: null, receivedAt: 0, puzzle: null, feedback: null, screenOpen: false }),
}));

export const selectMyActiveBattle = (state: BattleStore) =>
  state.battle?.phase === 'countdown' || state.battle?.phase === 'running' ? state.battle : null;

/** Relógio do servidor projetado para agora (ms). */
export function battleServerTime(state: Pick<BattleStore, 'battle' | 'receivedAt'>, now = Date.now()): number {
  if (!state.battle) return now;
  return state.battle.serverNow + (now - state.receivedAt);
}
