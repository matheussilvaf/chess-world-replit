import { create } from 'zustand';
import type { ChessRatingUpdateMessage } from '../shared/rating/RatingShapes';

/**
 * Último `chess_rating_update` recebido da sala. Vive fora do chessStore de
 * propósito: o chessStore faz `reset()` ~3 s depois de `match_finished`, e o
 * card de rating precisa continuar na tela até o jogador fechar (ou expirar).
 */
interface RatingState {
  update: ChessRatingUpdateMessage | null;
  receivedAt: number;
  setUpdate: (update: ChessRatingUpdateMessage) => void;
  dismiss: () => void;
}

export const useRatingStore = create<RatingState>((set) => ({
  update: null,
  receivedAt: 0,
  setUpdate: (update) => set({ update, receivedAt: Date.now() }),
  dismiss: () => set({ update: null, receivedAt: 0 }),
}));
