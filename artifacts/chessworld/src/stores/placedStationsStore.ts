/**
 * Estações portáteis posicionadas no mapa (espelho de `state.placedStations`
 * da sala) + UI ligada a elas: painel aberto em cima de uma estação
 * posicionada, prompt de "pedir permissão" e pedidos recebidos pelo dono.
 *
 * O WorldScene desenha a partir deste store; o GameCanvas alimenta pelos
 * listeners do Colyseus e limpa ao trocar de sala.
 */
import { create } from 'zustand';

export interface PlacedStationView {
  id: string;
  itemKey: string;
  stationId: string;
  ownerId: string;
  ownerName: string;
  /** Âncora = centro da base do corpo (px do mundo). */
  x: number;
  y: number;
  durability: number;
  maxDurability: number;
  placedAt: number;
  expiresAt: number;
  /** Ids dos jogadores autorizados a usar (além do dono). */
  allowed: string[];
}

export interface StationAccessRequest {
  placedId: string;
  stationId: string;
  itemKey: string;
  requesterId: string;
  requesterName: string;
  receivedAt: number;
}

export interface StationNotice {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  createdAt: number;
}

export type PermissionPromptStatus = 'idle' | 'sending' | 'sent' | 'granted' | 'denied' | 'error';

export interface PermissionPrompt {
  placedId: string;
  status: PermissionPromptStatus;
  message?: string;
}

interface PlacedStationsState {
  stations: Record<string, PlacedStationView>;
  /** Pedidos pendentes recebidos (lado do dono). */
  accessRequests: StationAccessRequest[];
  notices: StationNotice[];
  /** Estação posicionada cujo painel de craft está aberto. */
  openPlacedId: string | null;
  /** Prompt para pedir permissão ao dono de uma estação alheia. */
  permissionPrompt: PermissionPrompt | null;
  /** Recolha em voo (requestId) — desabilita o botão até a resposta. */
  pickupRequestId: string | null;
  upsertStation: (view: PlacedStationView) => void;
  removeStation: (id: string) => void;
  clearStations: () => void;
  pushAccessRequest: (request: StationAccessRequest) => void;
  dismissAccessRequest: (placedId: string, requesterId: string) => void;
  pushNotice: (kind: StationNotice['kind'], message: string) => void;
  dismissNotice: (id: number) => void;
  setOpenPlacedId: (id: string | null) => void;
  setPermissionPrompt: (prompt: PermissionPrompt | null) => void;
  updatePermissionPrompt: (placedId: string, patch: Partial<Omit<PermissionPrompt, 'placedId'>>) => void;
  setPickupRequestId: (requestId: string | null) => void;
  reset: () => void;
}

let noticeSeq = 0;
const MAX_NOTICES = 4;

export const usePlacedStationsStore = create<PlacedStationsState>((set) => ({
  stations: {},
  accessRequests: [],
  notices: [],
  openPlacedId: null,
  permissionPrompt: null,
  pickupRequestId: null,
  upsertStation: (view) => set((s) => ({ stations: { ...s.stations, [view.id]: view } })),
  removeStation: (id) => set((s) => {
    if (!s.stations[id]) return s;
    const stations = { ...s.stations };
    delete stations[id];
    return {
      stations,
      openPlacedId: s.openPlacedId === id ? null : s.openPlacedId,
      permissionPrompt: s.permissionPrompt?.placedId === id ? null : s.permissionPrompt,
      accessRequests: s.accessRequests.filter((r) => r.placedId !== id),
    };
  }),
  clearStations: () => set({ stations: {}, openPlacedId: null, permissionPrompt: null, accessRequests: [], pickupRequestId: null }),
  pushAccessRequest: (request) => set((s) => ({
    accessRequests: [
      ...s.accessRequests.filter((r) => !(r.placedId === request.placedId && r.requesterId === request.requesterId)),
      request,
    ].slice(-8),
  })),
  dismissAccessRequest: (placedId, requesterId) => set((s) => ({
    accessRequests: s.accessRequests.filter((r) => !(r.placedId === placedId && r.requesterId === requesterId)),
  })),
  pushNotice: (kind, message) => set((s) => ({
    notices: [...s.notices, { id: ++noticeSeq, kind, message, createdAt: Date.now() }].slice(-MAX_NOTICES),
  })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setOpenPlacedId: (id) => set({ openPlacedId: id }),
  setPermissionPrompt: (prompt) => set({ permissionPrompt: prompt }),
  updatePermissionPrompt: (placedId, patch) => set((s) => (
    s.permissionPrompt?.placedId === placedId ? { permissionPrompt: { ...s.permissionPrompt, ...patch } } : s
  )),
  setPickupRequestId: (requestId) => set({ pickupRequestId: requestId }),
  reset: () => set({ stations: {}, accessRequests: [], notices: [], openPlacedId: null, permissionPrompt: null, pickupRequestId: null }),
}));

/** O jogador pode usar a estação (dono ou autorizado). */
export function canUsePlacedStation(view: PlacedStationView | undefined, userId: string | null | undefined): boolean {
  if (!view || !userId) return false;
  return view.ownerId === userId || view.allowed.includes(userId);
}
