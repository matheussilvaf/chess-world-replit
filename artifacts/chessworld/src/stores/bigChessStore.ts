/**
 * Peças do Big Chess Board na sala (espelho de `state.bigChessPieces`, chave =
 * casa) + UI ligada a elas: card aberto (peça própria ou adversária) e pedidos
 * em voo (coletar renda / equipar / atacar) resolvidos pelo requestId nas
 * respostas `inventory_changed` / `inventory_error` da sala.
 *
 * O WorldScene desenha a partir deste store; o GameCanvas alimenta pelos
 * listeners do Colyseus e limpa ao trocar de sala.
 */
import { create } from 'zustand';
import type { BigChessPieceView } from '../shared/bigchess/BigChessShapes';

export type BigChessRequestKind = 'collect' | 'equip' | 'attack';

export interface BigChessPendingRequest {
  kind: BigChessRequestKind;
  square: string;
  /** Item enviado (equipar). */
  itemKey?: string;
  sentAt: number;
}

export interface BigChessCardFeedback {
  kind: 'success' | 'error';
  message: string;
  at: number;
}

/** Último acerto local reportado pelo servidor (feedback visual na peça). */
export interface BigChessHitFeedback {
  square: string;
  damage: number;
  destroyed: boolean;
  at: number;
}

interface BigChessState {
  pieces: Record<string, BigChessPieceView>;
  /** Casa da peça cujo card está aberto. */
  openSquare: string | null;
  pending: Record<string, BigChessPendingRequest>;
  /** Mensagem curta mostrada no card (sucesso/erro do último pedido). */
  cardFeedback: BigChessCardFeedback | null;
  lastHit: BigChessHitFeedback | null;
  upsertPiece: (view: BigChessPieceView) => void;
  removePiece: (square: string) => void;
  clearPieces: () => void;
  setOpenSquare: (square: string | null) => void;
  trackRequest: (requestId: string, request: Omit<BigChessPendingRequest, 'sentAt'>) => void;
  /**
   * Resposta da sala: devolve o pedido se o requestId era nosso (e o remove),
   * senão null — o chamador segue com o tratamento genérico do inventário.
   */
  takeRequest: (requestId: string | undefined) => BigChessPendingRequest | null;
  /** Pedidos daquele tipo em voo (para desabilitar botões). */
  hasPending: (kind: BigChessRequestKind, square?: string) => boolean;
  setCardFeedback: (feedback: BigChessCardFeedback | null) => void;
  setLastHit: (hit: BigChessHitFeedback | null) => void;
  reset: () => void;
}

export const useBigChessStore = create<BigChessState>((set, get) => ({
  pieces: {},
  openSquare: null,
  pending: {},
  cardFeedback: null,
  lastHit: null,
  upsertPiece: (view) => set((s) => ({ pieces: { ...s.pieces, [view.square]: view } })),
  removePiece: (square) => set((s) => {
    if (!(square in s.pieces)) return s;
    const pieces = { ...s.pieces };
    delete pieces[square];
    return { pieces, openSquare: s.openSquare === square ? null : s.openSquare };
  }),
  clearPieces: () => set({ pieces: {}, openSquare: null, pending: {}, cardFeedback: null, lastHit: null }),
  setOpenSquare: (square) => set((s) => (
    s.openSquare === square ? s : { openSquare: square, cardFeedback: null }
  )),
  trackRequest: (requestId, request) => set((s) => ({
    pending: { ...s.pending, [requestId]: { ...request, sentAt: Date.now() } },
  })),
  takeRequest: (requestId) => {
    if (!requestId) return null;
    const request = get().pending[requestId];
    if (!request) return null;
    set((s) => {
      const pending = { ...s.pending };
      delete pending[requestId];
      return { pending };
    });
    return request;
  },
  hasPending: (kind, square) => Object.values(get().pending).some((r) => r.kind === kind && (!square || r.square === square)),
  setCardFeedback: (feedback) => set({ cardFeedback: feedback }),
  setLastHit: (hit) => set({ lastHit: hit }),
  reset: () => set({ pieces: {}, openSquare: null, pending: {}, cardFeedback: null, lastHit: null }),
}));
