import type { Room } from 'colyseus.js';
import {
  PUZZLE_MSG, type DailySeatedPayload, type DailySlot, type DailyStatePayload, type PuzzleFeedbackPayload, type PuzzleStartedPayload,
} from '../../shared/academy/PuzzleShapes';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { pushNotice } from '../../stores/noticesStore';
import { usePuzzleSessionStore } from '../../stores/puzzleSessionStore';
import { usePuzzleStore } from '../../stores/puzzleStore';
import { useBattleStore } from '../../stores/battleStore';
import { useLessonStore } from '../../stores/lessonStore';
import { leavePuzzleTable, sitAtPuzzleTable } from '../puzzleTableClient';
import { dismissFinishedBattle } from './battleHandlers';
import { getActiveRoom, getActiveRoomType } from './colyseusClient';

/**
 * Zera todo o estado de puzzle do cliente (cadeira, painel, sessão e batalha) e
 * levanta o sprite da mesa. Usado ao trocar/anexar sala: o servidor recria o
 * estado do zero em cada sala (o diário fica salvo no banco com as vidas).
 */
export function resetPuzzleClientState(): void {
  leavePuzzleTable();
  usePuzzleStore.getState().reset();
  usePuzzleSessionStore.getState().clear();
  useBattleStore.getState().clear();
  useLessonStore.getState().reset();
}

export function registerDailyPuzzleHandlers(room: Room): () => void {
  // Sala nova (ou reconexão): nenhuma sessão antiga sobrevive no servidor.
  resetPuzzleClientState();
  const unsubscribe = [
    room.onMessage(PUZZLE_MSG.dailyState, (payload: DailyStatePayload) => usePuzzleStore.getState().setDaily(payload)),
    room.onMessage(PUZZLE_MSG.dailySeated, (payload: DailySeatedPayload) => {
      dismissFinishedBattle();
      usePuzzleStore.getState().setSeat({ boardId: payload.boardId, seat: payload.seat });
      sitAtPuzzleTable(payload.boardId, payload.seat);
    }),
    room.onMessage(PUZZLE_MSG.puzzleStarted, (payload: PuzzleStartedPayload) => {
      if (payload.context.kind !== 'daily') return;
      usePuzzleStore.getState().setActivePuzzle(payload);
      usePuzzleSessionStore.getState().start(payload);
      // O puzzle é resolvido na mesa: fecha o painel de slots.
      usePuzzleStore.getState().setDailyOpen(false);
      useGameStore.getState().setSelectedBoard(null);
      useGameStore.getState().setBoardLocked(false);
    }),
    room.onMessage(PUZZLE_MSG.puzzleFeedback, (payload: PuzzleFeedbackPayload) => {
      if (payload.sessionId !== usePuzzleStore.getState().activePuzzle?.sessionId) return;
      usePuzzleStore.getState().setFeedback(payload);
      usePuzzleSessionStore.getState().applyFeedback(payload);
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

/** Reserva a cadeira e já pede o estado do dia (o servidor responde `dailySeated` + `dailyState`). */
export function sendDailySit(boardId: string): void {
  const room = academyRoom();
  if (!room) return;
  usePuzzleStore.getState().setDailyLoading(true);
  room.send(PUZZLE_MSG.dailySit, { boardId });
}

export function sendDailyStart(slot: DailySlot): void {
  academyRoom()?.send(PUZZLE_MSG.dailyStart, { slot });
}

export function sendPuzzleMove(sessionId: string, uci: string): void {
  academyRoom()?.send(PUZZLE_MSG.puzzleMove, { sessionId, uci });
}

/** Levanta da mesa do puzzle diário (um puzzle em andamento continua salvo com as vidas restantes). */
export function leaveDailyTable(): void {
  const room = getActiveRoomType() === 'academy' ? getActiveRoom() : null;
  room?.send(PUZZLE_MSG.dailyLeave, {});
  leavePuzzleTable();
  const puzzles = usePuzzleStore.getState();
  puzzles.setSeat(null);
  puzzles.setActivePuzzle(null);
  puzzles.setDailyOpen(false);
  usePuzzleSessionStore.getState().clear();
  useGameStore.getState().setSelectedBoard(null);
  useGameStore.getState().setBoardLocked(false);
}
