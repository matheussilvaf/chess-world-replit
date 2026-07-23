import { create } from 'zustand';
import type { InteractionObject, ZoneChangeEvent } from '../game/interactions/InteractionSystem';

interface InteractionDebugData {
  object: InteractionObject;
  playerDistance: number;
}

interface InteractionState {
  debugEnabled: boolean;
  modalData: InteractionDebugData | null;
  proximityObject: InteractionObject | null;
  currentZone: { zoneId: string; zoneName: string; zoneType: string } | null;
  zoneNotification: { zoneId: string; zoneName: string; zoneType: string; entered: boolean } | null;
  confirmAction: (() => void) | null;

  setDebugEnabled: (enabled: boolean) => void;
  openModal: (data: InteractionDebugData) => void;
  closeModal: () => void;
  setProximityObject: (obj: InteractionObject | null) => void;
  setCurrentZone: (zone: { zoneId: string; zoneName: string; zoneType: string } | null) => void;
  showZoneNotification: (event: ZoneChangeEvent) => void;
  clearZoneNotification: () => void;
  setConfirmAction: (fn: (() => void) | null) => void;
}

export const useInteractionStore = create<InteractionState>((set) => ({
  debugEnabled: true,
  modalData: null,
  proximityObject: null,
  currentZone: null,
  zoneNotification: null,
  confirmAction: null,

  setDebugEnabled: (enabled) => set({ debugEnabled: enabled }),
  openModal: (data) => set({ modalData: data }),
  closeModal: () => set({ modalData: null }),
  setProximityObject: (obj) => set({ proximityObject: obj }),
  setCurrentZone: (zone) => set({ currentZone: zone }),
  showZoneNotification: (event) => set({ zoneNotification: event }),
  clearZoneNotification: () => set({ zoneNotification: null }),
  setConfirmAction: (fn) => set({ confirmAction: fn }),
}));
