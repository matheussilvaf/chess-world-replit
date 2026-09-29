import { useEffect, useState, type JSX } from 'react';
import { Chess } from 'chess.js';
import { SimpleChessBoard } from '../../chess/SimpleChessBoard';
import { parseUci } from '../../../shared/academy/puzzleSolver';
import { puzzleDifficultyLabel, puzzleMainThemes, puzzleThemeLabel, type PuzzleFeedbackPayload, type PuzzleStartedPayload } from '../../../shared/academy/PuzzleShapes';

export interface PuzzleBoardProps {
  puzzle: PuzzleStartedPayload | null;
  feedback: PuzzleFeedbackPayload | null;
  onMove: (uci: string) => void;
  size?: number | 'auto';
  compact?: boolean;
  showThemes?: boolean;
}

function applyMove(fen: string, uci: string): string {
  const move = parseUci(uci);
  if (!move) return fen;
  try {
    const chess = new Chess(fen);
    chess.move(move);
    return chess.fen();
  } catch { return fen; }
}

function PuzzleSession({ puzzle, feedback, onMove, size = 'auto', compact = false, showThemes = true }: PuzzleBoardProps & { puzzle: PuzzleStartedPayload }) {
  const [fen, setFen] = useState(puzzle.fen);
  const [setupFen] = useState(() => applyMove(puzzle.fen, puzzle.setupMove));
  const [animation, setAnimation] = useState<{ from: string; to: string; key: number } | undefined>(() => {
    const m = parseUci(puzzle.setupMove);
    return m ? { from: m.from, to: m.to, key: 0 } : undefined;
  });
  const [phase, setPhase] = useState<'setup' | 'ready' | 'waiting' | 'reply' | 'wrong' | 'solved' | 'solution' | 'over'>('setup');
  const [moveNumber, setMoveNumber] = useState(1);
  const [solutionStep, setSolutionStep] = useState(0);
  const [time, setTime] = useState(Date.now());
  const [last, setLast] = useState<{ from: string; to: string } | undefined>();
  const solution = feedback?.sessionId === puzzle.sessionId ? feedback.solutionMoves : undefined;

  useEffect(() => {
    if (!puzzle.deadlineAt) return;
    const interval = window.setInterval(() => setTime(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [puzzle.deadlineAt]);

  useEffect(() => {
    if (!feedback || feedback.sessionId !== puzzle.sessionId) return;
    if (feedback.puzzleOver) { setAnimation(undefined); setPhase('over'); return; }
    if (!feedback.ok) {
      setAnimation(undefined);
      setPhase('wrong');
      const timer = window.setTimeout(() => {
        if (feedback.solutionMoves) { setFen(setupFen); setSolutionStep(0); setPhase('solution'); }
      }, 700);
      return () => window.clearTimeout(timer);
    }
    if (feedback.solved) { setPhase('solved'); return; }
    if (feedback.reply) {
      const m = parseUci(feedback.reply);
      if (m) { setAnimation({ from: m.from, to: m.to, key: feedback.moveIndex + 1 }); setPhase('reply'); }
    } else { setMoveNumber(feedback.moveIndex + 2); setPhase('ready'); }
    return undefined;
  }, [feedback, puzzle.sessionId, setupFen]);

  useEffect(() => {
    if (phase !== 'solution' || !solution || solutionStep >= solution.length) return;
    const timer = window.setTimeout(() => setSolutionStep((n) => n + 1), 700);
    return () => window.clearTimeout(timer);
  }, [phase, solution, solutionStep]);

  let shownFen = fen;
  if (phase === 'solution' && solution) {
    shownFen = solution.slice(0, solutionStep).reduce((position, uci) => applyMove(position, uci), setupFen);
  }
  const overText = feedback?.puzzleOverReason === 'opponent_first' ? 'Adversário resolveu antes'
    : feedback?.puzzleOverReason === 'timeout' ? 'Tempo esgotado' : 'Errou';
  const status = phase === 'setup' ? 'Lance de preparação…' : phase === 'waiting' ? 'Verificando lance…'
    : phase === 'reply' ? 'Resposta do adversário…' : phase === 'wrong' ? 'Lance errado'
      : phase === 'solved' ? 'Resolvido!' : phase === 'solution' ? 'Sem vidas — veja a solução'
        : phase === 'over' ? overText : `Lance ${moveNumber} de ${puzzle.solutionLength}`;
  const seconds = Math.max(0, Math.ceil(((puzzle.deadlineAt ?? time) - time) / 1000));
  return <div className={`space-y-3 text-white ${phase === 'wrong' ? 'animate-pulse' : ''}`} data-testid="puzzle-board">
    {!compact && <div><h3 className="text-lg font-bold">Puzzle · {puzzleDifficultyLabel(puzzle.rating)} ({puzzle.rating})</h3>
      <p className="text-sm text-slate-300">Você joga de {puzzle.playerColor === 'w' ? 'Brancas' : 'Pretas'}</p></div>}
    {compact && <p className="text-sm text-slate-300">Você joga de {puzzle.playerColor === 'w' ? 'Brancas' : 'Pretas'}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <strong role="status" className={phase === 'solved' ? 'text-emerald-400' : phase === 'wrong' || phase === 'over' || phase === 'solution' ? 'text-red-400' : 'text-amber-300'}>{status}</strong>
      <span>{puzzle.livesLeft !== undefined && <span aria-label={`${puzzle.livesLeft} vidas`} className="text-rose-400">{'♥'.repeat(Math.max(0, puzzle.livesLeft))}{'♡'.repeat(Math.max(0, 3 - puzzle.livesLeft))}</span>}
        {puzzle.deadlineAt && <span className="ml-3">⏱ {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}</span>
    </div>
    <SimpleChessBoard fen={shownFen} orientation={puzzle.playerColor} size={size} interactive={phase === 'ready'}
      lastMove={last} animateMove={animation} onAnimationEnd={() => {
        if (!animation) return;
        const uci = phase === 'setup' ? puzzle.setupMove : feedback?.reply;
        if (uci) setFen((position) => applyMove(position, uci));
        setLast({ from: animation.from, to: animation.to });
        setAnimation(undefined);
        if (phase === 'reply') setMoveNumber((n) => n + 1);
        setPhase('ready');
      }}
      onMove={(from, to, promotion) => {
        if (phase !== 'ready') return false;
        const uci = `${from}${to}${promotion ?? ''}`;
        const next = applyMove(fen, uci);
        if (next === fen) return false;
        setFen(next);
        setLast({ from, to });
        setPhase('waiting');
        onMove(uci);
        return true;
      }} />
    {phase === 'solution' && solution && <div className="flex items-center justify-center gap-4 text-sm">
      <button type="button" aria-label="Lance anterior" disabled={solutionStep === 0} onClick={() => setSolutionStep((n) => n - 1)} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-40">◀</button>
      Solução {solutionStep} / {solution.length}
      <button type="button" aria-label="Próximo lance" disabled={solutionStep >= solution.length} onClick={() => setSolutionStep((n) => n + 1)} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-40">▶</button>
    </div>}
    {showThemes && puzzle.themes.length > 0 && <div className="flex flex-wrap gap-2 text-xs text-slate-300">
      {puzzleMainThemes(puzzle.themes).map((theme) => <span key={theme} className="rounded bg-slate-700 px-2 py-1">{puzzleThemeLabel(theme)}</span>)}
    </div>}
  </div>;
}

export function PuzzleBoard(props: PuzzleBoardProps): JSX.Element {
  if (!props.puzzle) return <p className="text-slate-300">Aguardando puzzle…</p>;
  return <PuzzleSession key={props.puzzle.sessionId} {...props} puzzle={props.puzzle} />;
}