import type { Room } from 'colyseus.js';
import { ACADEMY_MSG } from '../../shared/academy/AcademyShapes';
import { LESSON_MSG, type LessonDifficultyId, type LessonSessionEndPayload, type LessonStatePayload, type LessonThemeId, type ProblemFilters, type LessonSeatedPayload } from '../../shared/academy/LessonShapes';
import { PUZZLE_MSG, type PuzzleStartedPayload, type PuzzleFeedbackPayload } from '../../shared/academy/PuzzleShapes';
import { useLessonStore } from '../../stores/lessonStore';
import { usePuzzleStore } from '../../stores/puzzleStore';
import { usePuzzleSessionStore } from '../../stores/puzzleSessionStore';
import { useGameStore } from '../../stores/gameStore';
import { leavePuzzleTable, sitAtPuzzleTable } from '../puzzleTableClient';
import { dismissFinishedBattle } from './battleHandlers';
import { getActiveRoom, getActiveRoomType } from './colyseusClient';

let pendingReseat: { boardId: string; action: () => void } | null = null;
/** Só prossegue após confirmação da cadeira pelo servidor. */
export function reseatForLesson(boardId: string, action: () => void) {
  pendingReseat = { boardId, action };
  sendLessonSit(boardId);
}
export function registerLessonHandlers(room: Room): () => void {
  useLessonStore.getState().reset();
  const stops = [
    room.onMessage(LESSON_MSG.state, (payload: LessonStatePayload) => useLessonStore.getState().setState(payload)),
    room.onMessage(LESSON_MSG.seated, (payload: LessonSeatedPayload) => {
      dismissFinishedBattle();
      usePuzzleStore.getState().setSeat({ boardId: payload.boardId, seat: payload.seat });
      sitAtPuzzleTable(payload.boardId, payload.seat);
      if (pendingReseat?.boardId === payload.boardId) {
        const pending = pendingReseat;
        pendingReseat = null;
        pending.action();
      }
    }),
    room.onMessage(ACADEMY_MSG.error, () => { pendingReseat = null; }),
    room.onMessage(LESSON_MSG.sessionEnd, (payload: LessonSessionEndPayload) => {
      const boardId = usePuzzleStore.getState().seat?.boardId ?? usePuzzleSessionStore.getState().puzzle?.boardId;
      if (boardId) useLessonStore.getState().setBoardId(boardId);
      useLessonStore.getState().end(payload);
      usePuzzleSessionStore.getState().clear();
      leavePuzzleTable();
      usePuzzleStore.getState().setSeat(null);
      useGameStore.getState().setBoardLocked(false);
      useGameStore.getState().setSelectedBoard(null);
    }),
    room.onMessage(PUZZLE_MSG.puzzleStarted, (payload: PuzzleStartedPayload) => {
      if (payload.context.kind !== 'lesson' && payload.context.kind !== 'problem') return;
      useLessonStore.getState().start(payload);
      usePuzzleSessionStore.getState().start(payload);
      useGameStore.getState().setSelectedBoard(null);
      useGameStore.getState().setBoardLocked(false);
    }),
    room.onMessage(PUZZLE_MSG.puzzleFeedback, (payload: PuzzleFeedbackPayload) => {
      const current = usePuzzleSessionStore.getState().puzzle;
      if (current?.sessionId !== payload.sessionId || (current.context.kind !== 'lesson' && current.context.kind !== 'problem')) return;
      usePuzzleSessionStore.getState().applyFeedback(payload);
      if (!payload.ok && payload.solutionMoves) usePuzzleSessionStore.getState().setSolutionAutoplay(false);
      if (payload.solved || !payload.ok) useLessonStore.getState().finishPuzzle(payload.solved);
    }),
  ];
  if (getActiveRoomType() === 'academy') room.send(LESSON_MSG.open, {});
  return () => { pendingReseat = null; stops.forEach((stop) => stop()); };
}
function academyRoom() { return getActiveRoomType() === 'academy' ? getActiveRoom() : null; }
export function sendLessonOpen() { academyRoom()?.send(LESSON_MSG.open, {}); }
export function sendLessonSit(boardId: string) { academyRoom()?.send(LESSON_MSG.sit, { boardId }); }
export function sendLessonPracticeStart(boardId: string, theme: LessonThemeId, difficulty: LessonDifficultyId) { academyRoom()?.send(LESSON_MSG.practiceStart, { boardId, theme, difficulty }); }
export function sendLessonProblemStart(boardId: string, filters: ProblemFilters) { academyRoom()?.send(LESSON_MSG.problemStart, { boardId, filters }); }
export function sendLessonNext(boardId: string) { academyRoom()?.send(LESSON_MSG.next, { boardId }); }
export function sendLessonStop(boardId: string) { academyRoom()?.send(LESSON_MSG.stop, { boardId }); }
export function sendLessonLeave() {
  academyRoom()?.send(LESSON_MSG.leave, {});
  leavePuzzleTable();
  usePuzzleStore.getState().setSeat(null);
  usePuzzleSessionStore.getState().clear();
  useLessonStore.getState().setBoardId(null);
  useGameStore.getState().setSelectedBoard(null);
  useGameStore.getState().setBoardLocked(false);
}