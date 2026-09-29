import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BATTLE_WRONG_COOLDOWN_MS, type PuzzleContext } from '../../../shared/academy/PuzzleShapes';
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
  // Relógio de 50 ms só enquanto o cooldown (e o flash "Sua vez!") ainda são visíveis.
  const cooldownActive = !!puzzle?.cooldownUntil && battle?.phase === 'running' &&
    battleServerTime({ battle, receivedAt }) < puzzle.cooldownUntil + 600;
  const now = useNow(50, countdown || cooldownActive);
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
  // Batalha encerrada: o jogador já levantou; só o modal de resultado fica (sem tabuleiro capturando cliques).
  if (table.kind === 'battle' && table.battle?.phase === 'finished') return null;
  const hasPuzzle = !!puzzle && puzzle.boardId === table.boardId;
  const serverNow = battleServerTime({ battle, receivedAt }, now);
  const secondsLeft = countdown && battle ? Math.max(0, Math.ceil((battle.startsAt - serverNow) / 1000)) : 0;
  const cooldownUntil = hasPuzzle && puzzle.context.kind === 'battle' ? puzzle.cooldownUntil ?? 0 : 0;
  const remaining = Math.max(0, cooldownUntil - serverNow);
  const cooling = !!cooldownUntil && remaining > 0 && phase !== 'wrong' && !battle?.bestOf?.roundResult && battle?.phase === 'running';
  // Nunca mostra "4": o restante inclui o piscar do erro quando o relógio do servidor está adiantado.
  const cooldownSeconds = Math.min(Math.ceil(BATTLE_WRONG_COOLDOWN_MS / 1000), Math.ceil(remaining / 1000));
  const readyFlash = !!cooldownUntil && remaining === 0 && serverNow - cooldownUntil < 500 && phase !== 'wrong' && !battle?.bestOf?.roundResult && battle?.phase === 'running';
  const dimmed = !hasPuzzle || countdown || cooling || !!battle?.bestOf?.roundResult || battle?.phase === 'finished';

  return <TableBoardOverlay boardId={table.boardId} rectOverride={rectOverride}
    fen={hasPuzzle ? fen : INITIAL_FEN} orientation={table.orientation}
    interactive={hasPuzzle && phase === 'ready' && battle?.phase !== 'finished' && !battle?.bestOf?.roundResult && !cooling}
    lastMove={hasPuzzle ? last : null} errorSquares={hasPuzzle ? error : null}
    animateMove={hasPuzzle ? animation : null} onAnimationEnd={() => usePuzzleSessionStore.getState().animationDone()}
    dimmed={dimmed}
    onMove={(from, to, promotion) => {
      const session = usePuzzleSessionStore.getState();
      if (!session.puzzle) return false;
      const currentBattle = useBattleStore.getState();
      if (session.puzzle.cooldownUntil && session.puzzle.cooldownUntil > battleServerTime(currentBattle)) return false;
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
    {cooling && <div data-testid="battle-cooldown" className="pointer-events-none select-none rounded-2xl border border-amber-300/30 bg-slate-950/85 px-5 py-4 text-center text-white shadow-2xl backdrop-blur-md">
      <div className="relative mx-auto h-20 w-20">
        <svg viewBox="0 0 80 80" className="-rotate-90 h-full w-full" aria-hidden="true">
          <circle cx="40" cy="40" r="33" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="5" />
          <circle cx="40" cy="40" r="33" fill="none" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 33} strokeDashoffset={2 * Math.PI * 33 * (1 - Math.min(1, remaining / BATTLE_WRONG_COOLDOWN_MS))} />
        </svg>
        <motion.span key={cooldownSeconds} initial={{ scale: 1.25, opacity: 0.7 }} animate={{ scale: 1, opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center font-mono text-4xl font-black tabular-nums text-amber-200">
          {cooldownSeconds}
        </motion.span>
      </div>
      <p className="mt-2 text-sm font-bold">Posição reiniciada</p>
      <p className="mt-0.5 text-xs text-slate-300">Tente de novo em instantes</p>
    </div>}
    {readyFlash && <motion.div data-testid="battle-ready-flash" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
      className="pointer-events-none rounded-xl border border-emerald-400/50 bg-slate-950/85 px-5 py-3 text-xl font-black text-emerald-300 shadow-xl backdrop-blur-md">
      Sua vez!
    </motion.div>}
  </TableBoardOverlay>;
}
