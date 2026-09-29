import type { Room } from 'colyseus.js';
import {
  PUZZLE_MSG, type BattleChallengeClosedPayload, type BattleCreatePayload,
  type BattleStatePayload, type PuzzleFeedbackPayload, type PuzzleStartedPayload,
} from '../../shared/academy/PuzzleShapes';
import { useAuthStore } from '../../stores/authStore';
import { useBattleStore } from '../../stores/battleStore';
import { useGameStore } from '../../stores/gameStore';
import { pushNotice } from '../../stores/noticesStore';
import { getActiveRoom, getActiveRoomType } from './colyseusClient';

export function registerBattleHandlers(room: Room): () => void {
  const removers = [
    room.onMessage(PUZZLE_MSG.battleState, (data: BattleStatePayload) => {
      const store = useBattleStore.getState();
      store.setBattle(data);
      if (data.phase !== 'finished') store.setScreenOpen(true);
      if (data.result && typeof data.result.gambitsBalance === 'number') {
        useAuthStore.getState().patchProfile({ gambits: data.result.gambitsBalance });
      }
    }),
    room.onMessage(PUZZLE_MSG.puzzleStarted, (data: PuzzleStartedPayload) => {
      if (data.context?.kind !== 'battle') return;
      const battle = useBattleStore.getState().battle;
      if (battle && data.context.battleId !== battle.battleId) return;
      useBattleStore.getState().setPuzzle(data);
    }),
    room.onMessage(PUZZLE_MSG.puzzleFeedback, (data: PuzzleFeedbackPayload) => {
      if (useBattleStore.getState().puzzle?.sessionId === data.sessionId) useBattleStore.getState().setFeedback(data);
    }),
    room.onMessage(PUZZLE_MSG.battleChallengeClosed, (data: BattleChallengeClosedPayload) => {
      pushNotice({ title: data.reason === 'expired' ? 'Seu desafio expirou' : 'Seu desafio foi cancelado' });
      if (useGameStore.getState().selectedBoard?.id === data.boardId) {
        useGameStore.getState().setSelectedBoard(null);
        useGameStore.getState().setBoardLocked(false);
      }
    }),
  ];
  return () => removers.forEach((remove) => remove());
}

function send(message: string, payload: object) {
  const room = getActiveRoomType() === 'academy' ? getActiveRoom() : null;
  if (!room) { pushNotice({ title: 'A Academia ainda não está disponível neste servidor.' }); return; }
  room.send(message, payload);
}
export const sendBattleCreate = (payload: BattleCreatePayload) => send(PUZZLE_MSG.battleCreate, payload);
export const sendBattleCancel = (boardId: string) => send(PUZZLE_MSG.battleCancel, { boardId });
export const sendBattleAccept = (boardId: string) => send(PUZZLE_MSG.battleAccept, { boardId });
export const sendBattleLeave = (battleId: string) => send(PUZZLE_MSG.battleLeave, { battleId });
export const sendBattleMove = (sessionId: string, uci: string) => send(PUZZLE_MSG.puzzleMove, { sessionId, uci });
export const sendBattleDismiss = () => send(PUZZLE_MSG.battleDismiss, {});