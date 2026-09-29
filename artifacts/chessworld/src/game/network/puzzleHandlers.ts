import type { Room } from 'colyseus.js';
import { PUZZLE_MSG, type DailySlot, type DailyStatePayload, type PuzzleFeedbackPayload, type PuzzleStartedPayload } from '../../shared/academy/PuzzleShapes';
import { useAuthStore } from '../../stores/authStore';
import { pushNotice } from '../../stores/noticesStore';
import { usePuzzleStore } from '../../stores/puzzleStore';
import { getActiveRoom, getActiveRoomType } from './colyseusClient';

export function registerDailyPuzzleHandlers(room: Room): () => void {
  const unsubscribe = [
    room.onMessage(PUZZLE_MSG.dailyState, (payload: DailyStatePayload) => usePuzzleStore.getState().setDaily(payload)),
    room.onMessage(PUZZLE_MSG.puzzleStarted, (payload: PuzzleStartedPayload) => {
      if (payload.context.kind === 'daily') usePuzzleStore.getState().setActivePuzzle(payload);
    }),
    room.onMessage(PUZZLE_MSG.puzzleFeedback, (payload: PuzzleFeedbackPayload) => {
      if (payload.sessionId !== usePuzzleStore.getState().activePuzzle?.sessionId) return;
      usePuzzleStore.getState().setFeedback(payload);
      if (typeof payload.gambitsBalance === 'number') useAuthStore.getState().patchProfile({ gambits: payload.gambitsBalance });
    }),
  ];
  return () => unsubscribe.forEach((stop) => stop());
}

function academyRoom(): Room | null {
  const room = getActiveRoomType() === 'academy' ? getActiveRoom() : null;
  if (!room) pushNotice({ title: 'A Academia ainda não está disponível neste servidor.' });
  return room;
}

export function sendDailyOpen(): void {
  const room = academyRoom();
  if (!room) return;
  usePuzzleStore.getState().setDailyLoading(true);
  room.send(PUZZLE_MSG.dailyOpen, {});
}

export function sendDailyStart(slot: DailySlot): void {
  academyRoom()?.send(PUZZLE_MSG.dailyStart, { slot });
}

export function sendPuzzleMove(sessionId: string, uci: string): void {
  academyRoom()?.send(PUZZLE_MSG.puzzleMove, { sessionId, uci });
}