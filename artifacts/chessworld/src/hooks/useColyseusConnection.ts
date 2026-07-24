import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import { joinWorldRoom, leaveWorldRoom, getWorldRoom, isColyseusConfigured, getColyseusEndpoint } from '../game/network/colyseusClient';
import { create } from 'zustand';

export type ColyseusPhase =
  | 'not_configured'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'connection_failed';

interface ColyseusState {
  phase: ColyseusPhase;
  connected: boolean;
  sessionId: string | null;
  roomId: string | null;
  error: string | null;
  setPhase: (phase: ColyseusPhase) => void;
  setConnected: (sessionId: string, roomId: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useColyseusStore = create<ColyseusState>((set) => ({
  phase: isColyseusConfigured() ? 'idle' : 'not_configured',
  connected: false,
  sessionId: null,
  roomId: null,
  error: null,
  setPhase: (phase) => set({ phase }),
  setConnected: (sessionId, roomId) => set({
    phase: 'connected',
    connected: true,
    sessionId,
    roomId,
    error: null,
  }),
  setError: (error) => set({
    phase: 'connection_failed',
    connected: false,
    sessionId: null,
    roomId: null,
    error,
  }),
  reset: () => set({
    phase: isColyseusConfigured() ? 'idle' : 'not_configured',
    connected: false,
    sessionId: null,
    roomId: null,
    error: null,
  }),
}));

export function useColyseusConnection() {
  const { user, profile } = useAuthStore();
  const { region, playerPosition } = useGameStore();
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!isColyseusConfigured()) return;
    if (!user || !profile || !region) return;

    cancelledRef.current = false;

    const existingRoom = getWorldRoom();
    if (existingRoom) {
      const store = useColyseusStore.getState();
      if (!store.connected) {
        store.setConnected(existingRoom.sessionId, existingRoom.roomId);
      }
      return;
    }

    const endpoint = getColyseusEndpoint();
    console.log('[Colyseus] Connecting to:', endpoint);
    console.log('[Colyseus] Player:', profile.username, '| Region:', region);

    useColyseusStore.getState().setPhase('connecting');

    const payload = {
      playerId: user.id,
      username: profile.username,
      rating: profile.rating,
      region,
      x: playerPosition.x,
      y: playerPosition.y,
    };

    joinWorldRoom(payload)
      .then((room) => {
        if (cancelledRef.current) {
          console.log('[Colyseus] Connection succeeded but effect was cancelled, leaving...');
          leaveWorldRoom();
          return;
        }
        console.log('[Colyseus] Connected! Room:', room.roomId, '| Session:', room.sessionId);
        useColyseusStore.getState().setConnected(room.sessionId, room.roomId);
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        const message = err.message || String(err);
        console.error('[Colyseus] Connection failed:', message);
        useColyseusStore.getState().setError(message);
      });

    return () => {
      cancelledRef.current = true;
      const room = getWorldRoom();
      if (room) {
        leaveWorldRoom();
        useColyseusStore.getState().reset();
      }
    };
  }, [user?.id, profile?.username, region]);
}
