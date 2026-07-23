import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getActiveRoom } from '../game/network/colyseusClient';
import { seatTournamentPlayerWhenReady } from '../game/tournamentSeatClient';
import type { TournamentState } from './useTournamentRoom';
import type { Room } from 'colyseus.js';

export function useTournamentAutoSeat(
  state: TournamentState,
  connected: boolean,
) {
  const { user } = useAuthStore();
  const seatedForRound = useRef<number>(0);
  const pendingBoardId = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const listenerRoom = useRef<Room<any> | null>(null);
  const cancelSeat = useRef<(() => void) | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  function cleanup() {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (cancelSeat.current) {
      cancelSeat.current();
      cancelSeat.current = null;
    }
    pendingBoardId.current = null;
    retryCount.current = 0;
  }

  function installListener(room: Room<any>) {
    if (listenerRoom.current === room) return;
    listenerRoom.current = room;

    room.onMessage('tournament_seated', (msg: { boardId: string; color: string; seat: string }) => {
      if (pendingBoardId.current && msg.boardId === pendingBoardId.current) {
        if (retryTimer.current) {
          clearTimeout(retryTimer.current);
          retryTimer.current = null;
        }
        seatedForRound.current = stateRef.current.currentRound;
        pendingBoardId.current = null;
        retryCount.current = 0;

        cancelSeat.current = seatTournamentPlayerWhenReady(msg.boardId, msg.seat, msg.color as 'w' | 'b');
      }
    });
  }

  useEffect(() => {
    if (!connected || !user) return;
    if (state.status !== 'round_active') return;
    if (state.currentRound === seatedForRound.current) return;
    if (pendingBoardId.current) return;
    if (state.pairings.length === 0) return;
    if (state.modules.length === 0 || state.tables.length === 0) return;

    const myPairing = state.pairings.find(
      p => p.roundNumber === state.currentRound &&
        !p.isBye &&
        !p.result &&
        !p.completedAt &&
        (p.whitePlayerId === user.id || p.blackPlayerId === user.id)
    );
    if (!myPairing) {
      const byePairing = state.pairings.find(
        p => p.roundNumber === state.currentRound && p.isBye &&
          (p.whitePlayerId === user.id || p.blackPlayerId === user.id || p.byePlayerId === user.id)
      );
      if (byePairing) {
        seatedForRound.current = state.currentRound;
      }
      return;
    }
    if (!myPairing.runtimeTableId) return;

    const tableExists = state.tables.some(t => t.runtimeTableId === myPairing.runtimeTableId);
    if (!tableExists) return;

    const room = getActiveRoom();
    if (!room) return;

    installListener(room);

    const color: 'w' | 'b' = myPairing.whitePlayerId === user.id ? 'w' : 'b';
    const opponentId = color === 'w' ? myPairing.blackPlayerId : myPairing.whitePlayerId;
    pendingBoardId.current = myPairing.runtimeTableId;

    const sendSeat = () => {
      if (!pendingBoardId.current) return;
      retryCount.current++;
      if (retryCount.current > 10) {
        console.warn('[useTournamentAutoSeat] Gave up after 10 retries');
        cleanup();
        return;
      }

      const currentRoom = getActiveRoom();
      if (!currentRoom) return;

      if (listenerRoom.current !== currentRoom) {
        installListener(currentRoom);
      }

      currentRoom.send('tournament_seat', {
        boardId: myPairing.runtimeTableId,
        baseTimeSeconds: stateRef.current.baseTimeSeconds,
        incrementSeconds: stateRef.current.incrementSeconds,
        timeCategory: stateRef.current.timeControlCategory,
        timeLabel: stateRef.current.timeControlLabel,
        opponentId,
        color,
      });

      retryTimer.current = setTimeout(sendSeat, 500);
    };

    sendSeat();
  }, [state.status, state.currentRound, state.pairings, state.modules, state.tables, user, connected]);

  useEffect(() => {
    if (state.status === 'idle' || state.status === 'registration_open') {
      cleanup();
      seatedForRound.current = 0;
    }
    if (state.status === 'between_rounds') {
      cleanup();
      const scene = (window as any).__worldScene;
      if (scene && typeof scene.unseatPlayer === 'function' && scene.currentSeatInfo) {
        scene.unseatPlayer();
      }
    }
    if (state.status === 'completed' || state.status === 'finalizing') {
      cleanup();
      const scene = (window as any).__worldScene;
      if (scene && scene.currentSeatInfo) {
        if (typeof scene.unseatPlayerToReception === 'function') {
          scene.unseatPlayerToReception();
        } else if (typeof scene.unseatPlayer === 'function') {
          scene.unseatPlayer();
        }
      }
    }
  }, [state.status]);

  useEffect(() => {
    return () => { cleanup(); };
  }, []);
}
