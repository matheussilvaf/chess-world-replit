import { useMemo, useRef, useState } from 'react';
import { DailyPuzzlesModal, type DailyPuzzleTransport } from '../academy/puzzles/DailyPuzzlesModal';
import { dailyPuzzleDate, dailyPuzzleNextReset, dailyRewardFor, type DailySlot, type DailySlotView, type PuzzleStartedPayload } from '../../shared/academy/PuzzleShapes';
import { evaluatePlayerMove, isValidPuzzle, puzzleSetup, puzzleSolutionMoves } from '../../shared/academy/puzzleSolver';
import { usePuzzleStore } from '../../stores/puzzleStore';

const puzzles = [
  { puzzle_id: 'l1Pgu', fen: '2k5/1pp2ppp/1q2p3/7n/5r2/2N2Q2/PPP2PPP/1R4K1 w - - 7 20',
    moves: ['f3h5', 'b6f2', 'g1h1', 'f2f1', 'b1f1', 'f4f1'],
    rating: 751, themes: ['backRankMate', 'endgame', 'long', 'mate', 'mateIn3', 'sacrifice'] },
  { puzzle_id: 'wDpDn', fen: '4n3/p5k1/4P1p1/1PbK1P2/6PB/8/8/8 b - - 2 51',
    moves: ['c5b6', 'd5c6', 'g6f5', 'c6d7'],
    rating: 2732, themes: ['crushing', 'endgame', 'short'] },
  { puzzle_id: 'bench-opening', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], rating: 1200, themes: ['opening', 'short'] },
] as const;

if (!puzzles.every(isValidPuzzle)) throw new Error('Puzzle inválido na bancada');

export default function PuzzlesBenchPage() {
  const [log, setLog] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const session = useRef<{ slot: DailySlot; id: string; index: number } | null>(null);
  const slots = useRef<DailySlotView[]>(puzzles.map((p, index) => ({
    slot: (index + 1) as DailySlot, puzzleId: p.puzzle_id, rating: p.rating, themes: [...p.themes],
    rewardGambits: [10, 20, 30][index], status: 'available', livesLeft: 3, earnedGambits: 0,
  })));
  const seq = useRef(0);
  const record = (name: string, payload: unknown) => setLog((old) => [`${name}: ${JSON.stringify(payload)}`, ...old].slice(0, 35));
  const publish = () => {
    const state = { date: dailyPuzzleDate(), slots: [...slots.current], nextResetAt: dailyPuzzleNextReset(), serverNow: Date.now(), schemaMissing: false };
    usePuzzleStore.getState().setDaily(state);
    record('dailyState', state);
  };
  const start = (slot: DailySlot) => {
    record('dailyStart', { slot });
    const view = slots.current[slot - 1];
    if (!view || view.status === 'solved' || view.status === 'failed') return;
    const puzzle = puzzles[slot - 1];
    const setup = puzzleSetup(puzzle);
    const id = `bench-${++seq.current}`;
    session.current = { slot, id, index: 0 };
    view.status = 'in_progress';
    const started: PuzzleStartedPayload = {
      sessionId: id, context: { kind: 'daily', slot }, puzzleId: puzzle.puzzle_id,
      rating: puzzle.rating, themes: [...puzzle.themes], livesLeft: view.livesLeft, ...setup,
    };
    usePuzzleStore.getState().setActivePuzzle(started);
    record('puzzleStarted', started);
    publish();
  };
  const transport = useMemo<DailyPuzzleTransport>(() => ({
    open: () => { record('dailyOpen', {}); publish(); },
    start,
    move: (id, uci) => {
      record('puzzleMove', { sessionId: id, uci });
      const active = session.current;
      if (!active || active.id !== id) return;
      const puzzle = puzzles[active.slot - 1];
      const result = evaluatePlayerMove(puzzle, active.index, uci);
      if (!result.legal) { record('error', 'Lance ilegal'); return; }
      const view = slots.current[active.slot - 1];
      if (result.ok) active.index += 1;
      else view.livesLeft -= 1;
      const solved = result.solved;
      if (solved) { view.status = 'solved'; view.earnedGambits = dailyRewardFor(view.rewardGambits, view.livesLeft); }
      else if (!result.ok && view.livesLeft === 0) view.status = 'failed';
      const feedback = {
        sessionId: id, ok: result.ok, moveIndex: result.ok ? active.index - 1 : active.index,
        solved, reply: result.reply, livesLeft: view.livesLeft,
        ...(solved ? { dailyStatus: 'solved' as const, rewardGambits: view.earnedGambits } : {}),
        ...(!result.ok && view.livesLeft > 0 ? { restart: true } : {}),
        ...(!result.ok && view.livesLeft === 0 ? { dailyStatus: 'failed' as const, solutionMoves: puzzleSolutionMoves(puzzle) } : {}),
      };
      usePuzzleStore.getState().setFeedback(feedback);
      record('puzzleFeedback', feedback);
      publish();
      if (feedback.restart) window.setTimeout(() => start(active.slot), 900);
    },
    // The bench's fake room is intentionally stable for the modal lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  return <div className="min-h-screen bg-slate-950 p-6 text-white">
    <h1 className="text-xl font-bold">Bancada · Puzzles diários</h1>
    <button type="button" onClick={() => setVisible(true)} className="mt-3 rounded bg-amber-500 px-4 py-2 text-slate-950">Abrir puzzles</button>
    {visible && <DailyPuzzlesModal boardId="dev-puzzles" transport={transport} onClose={() => setVisible(false)} />}
    <aside data-testid="puzzle-message-log" className="fixed right-2 top-24 z-[1001] hidden max-h-[70vh] w-48 overflow-auto rounded-lg border border-slate-600 bg-slate-950/95 p-3 text-xs text-slate-300 shadow-xl xl:block">
      <h2 className="mb-2 font-semibold text-white">Mensagens simuladas</h2>
      {log.map((line, index) => <p key={index} className="mb-2 break-all border-b border-slate-700 pb-2">{line}</p>)}
    </aside>
  </div>;
}