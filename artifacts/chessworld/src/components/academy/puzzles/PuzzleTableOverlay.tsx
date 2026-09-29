import { useEffect, useMemo } from 'react';
import type { PuzzleContext } from '../../../shared/academy/PuzzleShapes';
import { TableBoardOverlay, type ScreenRect } from '../../chess/TableBoardOverlay';
import { useNow } from '../../../hooks/useNow';
import { sendBattleMove } from '../../../game/network/battleHandlers';
import { sendPuzzleMove } from '../../../game/network/puzzleHandlers';
import { battleServerTime, useBattleStore } from '../../../stores/battleStore';
import { SOLUTION_STEP_MS, applyUci, usePuzzleSessionStore } from '../../../stores/puzzleSessionStore';
import { usePuzzleTable } from './usePuzzleTable';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Tabuleiro de puzzle sobre a mesa do mapa (diário e batalhas). Segue o
 * retângulo da mesa como o ChessBoardOverlay das partidas; o estado do puzzle
 * vem do puzzleSessionStore.
 */
export function PuzzleTableOverlay({ onMove, rectOverride }: {
  /** Transporte alternativo (bancadas). */
  onMove?: (sessionId: string, uci: string, kind: PuzzleContext['kind']) => void;
  rectOverride?: ScreenRect | null;
}) {
  const table = usePuzzleTable();
  const puzzle = usePuzzleSessionStore((s) => s.puzzle);
  const phase = usePuzzleSessionStore((s) => s.phase);
  const sessionFen = usePuzzleSessionStore((s) => s.fen);
  const setupFen = usePuzzleSessionStore((s) => s.setupFen);
  const sessionLast = usePuzzleSessionStore((s) => s.last);
  const animation = usePuzzleSessionStore((s) => s.animation);
  const error = usePuzzleSessionStore((s) => s.error);
  const solutionStep = usePuzzleSessionStore((s) => s.solutionStep);
  const manualSolution = usePuzzleSessionStore((s) => s.manualSolution);
  const solution = usePuzzleSessionStore((s) => s.feedback?.solutionMoves);
  const receivedAt = useBattleStore((s) => s.receivedAt);
  const battle = table?.battle ?? null;
  const countdown = battle?.phase === 'countdown';
  const now = useNow(100, countdown);
  // Seletores derivados ficam em useMemo: um seletor que devolve objeto novo a cada
  // chamada faz o useSyncExternalStore do zustand entrar em loop.
  const replaying = phase === 'solution' && !!solution;
  const fen = useMemo(() => replaying && solution
    ? solution.slice(0, solutionStep).reduce((position, uci) => applyUci(position, uci), setupFen)
    : sessionFen, [replaying, solution, solutionStep, setupFen, sessionFen]);
  const last = useMemo(() => {
    if (!replaying || !solution) return sessionLast;
    const uci = solution[solutionStep - 1];
    return uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null;
  }, [replaying, solution, solutionStep, sessionLast]);

  // Replay automático da solução (sem vidas).
  useEffect(() => {
    if (manualSolution || phase !== 'solution' || !solution || solutionStep >= solution.length) return;
    const timer = window.setTimeout(() => usePuzzleSessionStore.getState().setSolutionStep(solutionStep + 1), SOLUTION_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [phase, solution, solutionStep, manualSolution]);

  if (!table) return null;
  const hasPuzzle = !!puzzle && puzzle.boardId === table.boardId;
  const secondsLeft = countdown && battle ? Math.max(0, Math.ceil((battle.startsAt - battleServerTime({ battle, receivedAt }, now)) / 1000)) : 0;
  const dimmed = !hasPuzzle || countdown || battle?.phase === 'finished';

  return <TableBoardOverlay boardId={table.boardId} rectOverride={rectOverride}
    fen={hasPuzzle ? fen : INITIAL_FEN} orientation={table.orientation}
    interactive={hasPuzzle && phase === 'ready' && battle?.phase !== 'finished'}
    lastMove={hasPuzzle ? last : null} errorSquares={hasPuzzle ? error : null}
    animateMove={hasPuzzle ? animation : null} onAnimationEnd={() => usePuzzleSessionStore.getState().animationDone()}
    dimmed={dimmed}
    onMove={(from, to, promotion) => {
      const session = usePuzzleSessionStore.getState();
      if (!session.puzzle) return false;
      const uci = `${from}${to}${promotion ?? ''}`;
      if (!session.playerMove(uci)) return false;
      const kind = session.puzzle.context.kind;
      if (onMove) onMove(session.puzzle.sessionId, uci, kind);
      else if (kind === 'battle') sendBattleMove(session.puzzle.sessionId, uci);
      else sendPuzzleMove(session.puzzle.sessionId, uci);
      return true;
    }}>
    {countdown && <span data-testid="battle-countdown" className="select-none text-[18vmin] font-black leading-none text-amber-400 drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)]">
      {secondsLeft || 'Vai!'}
    </span>}
  </TableBoardOverlay>;
}
