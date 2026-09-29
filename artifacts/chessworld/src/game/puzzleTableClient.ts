import type { PuzzleSeat } from '../shared/academy/PuzzleShapes';
import { seatTournamentPlayerWhenReady } from './tournamentSeatClient';

/**
 * Sala de Puzzles: senta o sprite local na cadeira da mesa (bottom/top) e liga o
 * modo "em partida" da WorldScene (movimento travado, câmera girada para quem
 * senta em cima, tabuleiro Phaser escondido para o tabuleiro HTML assumir).
 * A cor passada à cena é só a ORIENTAÇÃO FÍSICA da cadeira; a cor do puzzle é
 * tratada pelo tabuleiro HTML.
 */
let cancelSeat: (() => void) | null = null;
let seatedAt: { boardId: string; seat: PuzzleSeat } | null = null;

export function sitAtPuzzleTable(boardId: string, seat: PuzzleSeat): void {
  if (seatedAt && seatedAt.boardId === boardId && seatedAt.seat === seat) return;
  cancelSeat?.();
  seatedAt = { boardId, seat };
  const color = seat === 'top' ? 'b' : 'w';
  cancelSeat = seatTournamentPlayerWhenReady(boardId, seat, color);
  const scene = (window as any).__worldScene;
  scene?.activateOverlayInteraction?.(boardId, color);
}

export function leavePuzzleTable(): void {
  cancelSeat?.();
  cancelSeat = null;
  if (!seatedAt) return;
  seatedAt = null;
  const scene = (window as any).__worldScene;
  scene?.deactivateOverlayInteraction?.();
  scene?.unseatPlayer?.();
}

export function puzzleTableSeat(): { boardId: string; seat: PuzzleSeat } | null { return seatedAt; }
