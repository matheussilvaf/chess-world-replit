import { create } from 'zustand';
import type {
  ActiveContractView,
  HuntContractsPayload,
  HuntEventPayload,
  HuntStatePayload,
} from '../shared/hunting/HuntingShapes';

interface PendingRequest { resolve: (ok: boolean) => void; timeout: number }
interface HuntingState {
  active: ActiveContractView | null;
  contracts: HuntContractsPayload | null;
  modalOpen: boolean;
  now: number;
  tableMissing: boolean;
  notice: string | null;
  error: string | null;
  pending: Record<string, PendingRequest>;
  applyContracts: (payload: HuntContractsPayload) => void;
  applyState: (payload: HuntStatePayload) => void;
  applyEvent: (payload: HuntEventPayload) => void;
  setModalOpen: (open: boolean) => void;
  clearNotice: () => void;
  tick: () => void;
  trackRequest: (requestId: string) => Promise<boolean>;
  resolveRequest: (requestId: string, ok: boolean, error?: string) => void;
  reset: () => void;
}

export const useHuntingStore = create<HuntingState>((set, get) => ({
  active: null, contracts: null, modalOpen: false, now: Date.now(), tableMissing: false,
  notice: null, error: null, pending: {},
  applyContracts: (payload) => set({
    contracts: payload, active: payload.active, now: payload.now, tableMissing: payload.tableMissing === true,
    modalOpen: true, error: null,
  }),
  applyState: (payload) => set({ active: payload.active, now: payload.now }),
  applyEvent: (payload) => set((state) => ({
    notice: payload.message,
    active: state.active && typeof payload.killed === 'number'
      ? { ...state.active, killed: payload.killed, complete: payload.killed >= state.active.quantity }
      : state.active,
  })),
  setModalOpen: (modalOpen) => set({ modalOpen, error: null }),
  clearNotice: () => set({ notice: null }),
  tick: () => set({ now: Date.now() }),
  trackRequest: (requestId) => new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => get().resolveRequest(requestId, false, 'A solicitação expirou.'), 10000);
    set((state) => ({ pending: { ...state.pending, [requestId]: { resolve, timeout } }, error: null }));
  }),
  resolveRequest: (requestId, ok, error) => {
    const request = get().pending[requestId];
    if (!request) return;
    window.clearTimeout(request.timeout);
    const pending = { ...get().pending };
    delete pending[requestId];
    request.resolve(ok);
    set({ pending, error: ok ? null : (error ?? 'Não foi possível concluir a solicitação.') });
  },
  reset: () => {
    for (const request of Object.values(get().pending)) {
      window.clearTimeout(request.timeout);
      request.resolve(false);
    }
    set({ active: null, contracts: null, modalOpen: false, now: Date.now(), tableMissing: false, notice: null, error: null, pending: {} });
  },
}));