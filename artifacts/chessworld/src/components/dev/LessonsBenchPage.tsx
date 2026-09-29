import { useEffect, useRef, useState } from 'react';
import { LessonPanel, type LessonTransport } from '../academy/lessons/LessonPanel';
import { LessonHUD, type LessonHUDTransport } from '../academy/lessons/LessonHUD';
import { LessonDeskCandles } from '../academy/lessons/LessonDeskCandles';
import { PuzzleTableOverlay } from '../academy/puzzles/PuzzleTableOverlay';
import { BenchTableFrame } from './BenchTableFrame';
import { LESSON_PRACTICE_SIZE, computeLessonStats, type LessonThemeId, type LessonDifficultyId, type ProblemFilters, type LessonProgressEntry } from '../../shared/academy/LessonShapes';
import { LESSON_EXAMPLES } from '../../shared/academy/lessonExamples';
import { evaluatePlayerMove, puzzleSetup, puzzleSolutionMoves } from '../../shared/academy/puzzleSolver';
import { useLessonStore } from '../../stores/lessonStore';
import { usePuzzleStore } from '../../stores/puzzleStore';
import { usePuzzleSessionStore } from '../../stores/puzzleSessionStore';
import type { PuzzleStartedPayload } from '../../shared/academy/PuzzleShapes';

const BOARD_ID = 'academy_lesson_1';
type Run = { kind: 'lesson'; theme: LessonThemeId; difficulty: LessonDifficultyId; index: number; solved: number; attempted: number; moveIndex: number; id: string; finished: boolean } |
  { kind: 'problem'; filters: ProblemFilters; index: number; solved: number; attempted: number; moveIndex: number; id: string; finished: boolean };
const starter: LessonProgressEntry[] = [
  { theme: 'mate_in_1', bestScore: 9, attempts: 2, completed: true }, { theme: 'mate_in_2', bestScore: 8, attempts: 1, completed: true },
  { theme: 'fork', bestScore: 6, attempts: 3, completed: false },
];
const rows = [{ theme: 'mate_in_1', solved: true, firstTry: true }, { theme: 'fork', solved: false, firstTry: false }];

/** Simula as mensagens do servidor sem conexão: posições autênticas do catálogo de exemplos. */
export default function LessonsBenchPage() {
  const [panel, setPanel] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const run = useRef<Run | null>(null);
  const seq = useRef(0);
  const progress = useRef([...starter]);
  const history = useRef([...rows]);
  const record = (name: string) => setLog((prev) => [name, ...prev].slice(0, 18));
  const state = () => { useLessonStore.getState().setState({ progress: [...progress.current], stats: computeLessonStats(history.current, progress.current) }); record('state'); };
  const serve = () => {
    const current = run.current;
    if (!current) return;
    const theme = current.kind === 'lesson' ? current.theme : 'fork';
    const source = LESSON_EXAMPLES[theme][current.index % 2];
    const setup = puzzleSetup(source);
    current.id = `lesson-bench-${++seq.current}`;
    current.moveIndex = 0;
    current.finished = false;
    const payload: PuzzleStartedPayload = {
      sessionId: current.id, context: current.kind === 'lesson'
        ? { kind: 'lesson', theme: current.theme, difficulty: current.difficulty, index: current.index, total: LESSON_PRACTICE_SIZE }
        : { kind: 'problem', index: current.index, filters: current.filters },
      puzzleId: source.puzzleId, boardId: BOARD_ID, seat: 'bottom', rating: source.rating, themes: [theme],
      ...setup,
    };
    useLessonStore.getState().start(payload);
    usePuzzleSessionStore.getState().start(payload);
    setPanel(false);
    record('puzzleStarted');
  };
  const finish = (reason: 'finished' | 'stopped' | 'left') => {
    const current = run.current;
    if (!current) return;
    // Como no servidor: só a prática concluída (10 posições) grava progresso/vela.
    if (current.kind === 'lesson' && reason === 'finished') {
      const previous = progress.current.find((p) => p.theme === current.theme);
      const completed = current.solved >= 8 || !!previous?.completed;
      progress.current = [...progress.current.filter((p) => p.theme !== current.theme), {
        theme: current.theme, bestScore: Math.max(current.solved, previous?.bestScore ?? 0),
        attempts: (previous?.attempts ?? 0) + 1, completed,
      }];
      useLessonStore.getState().end({ kind: 'lesson', theme: current.theme, solved: current.solved, attempted: current.attempted,
        total: LESSON_PRACTICE_SIZE, completed, newlyCompleted: completed && !previous?.completed, reason });
    } else useLessonStore.getState().end({ kind: current.kind, ...(current.kind === 'lesson' ? { theme: current.theme, total: LESSON_PRACTICE_SIZE } : {}), solved: current.solved, attempted: current.attempted, reason });
    run.current = null;
    state();
    record('sessionEnd');
  };
  const transport: LessonTransport = {
    open: state,
    sit: (boardId) => { usePuzzleStore.getState().setSeat({ boardId, seat: 'bottom' }); record('seated'); },
    leave: () => { finish('left'); usePuzzleStore.getState().setSeat(null); usePuzzleSessionStore.getState().clear(); setPanel(false); },
    practiceStart: (_boardId, theme, difficulty) => { run.current = { kind: 'lesson', theme, difficulty, index: 0, solved: 0, attempted: 0, moveIndex: 0, id: '', finished: false }; serve(); },
    problemStart: (_boardId, filters) => { run.current = { kind: 'problem', filters, index: 0, solved: 0, attempted: 0, moveIndex: 0, id: '', finished: false }; serve(); },
  };
  const hud: LessonHUDTransport = {
    next: () => {
      const current = run.current;
      if (!current || !current.finished) return;
      current.index++;
      if (current.kind === 'lesson' && current.index >= LESSON_PRACTICE_SIZE) finish('finished');
      else serve();
    },
    stop: () => finish('stopped'),
    leave: transport.leave,
    practiceStart: transport.practiceStart,
    openPanel: () => setPanel(true),
  };
  const move = (id: string, uci: string) => {
    const current = run.current;
    if (!current || current.id !== id || current.finished) return;
    const source = LESSON_EXAMPLES[current.kind === 'lesson' ? current.theme : 'fork'][current.index % 2];
    const result = evaluatePlayerMove(source, current.moveIndex, uci);
    if (!result.legal) return;
    if (result.ok) current.moveIndex++;
    const ended = !result.ok || result.solved;
    if (ended) {
      current.finished = true;
      current.attempted++;
      if (result.solved) current.solved++;
      history.current.push({ theme: current.kind === 'lesson' ? current.theme : 'fork', solved: result.solved, firstTry: result.solved });
      useLessonStore.getState().finishPuzzle(result.solved);
    }
    window.setTimeout(() => {
      usePuzzleSessionStore.getState().applyFeedback({ sessionId: id, ok: result.ok, solved: result.solved,
        moveIndex: result.ok ? current.moveIndex - 1 : current.moveIndex, reply: result.reply,
        ...(!result.ok ? { solutionMoves: puzzleSolutionMoves(source) } : {}) });
      record('puzzleFeedback');
    }, 100);
  };
  useEffect(() => {
    state();
    return () => { usePuzzleStore.getState().reset(); useLessonStore.getState().reset(); usePuzzleSessionStore.getState().clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seat = usePuzzleStore((s) => s.seat);
  return <div className="min-h-screen bg-slate-950 text-white">
    <BenchTableFrame>{(rect) => <>
      <LessonDeskCandles rectOverride={rect} />
      <PuzzleTableOverlay rectOverride={rect} onMove={move} />
      <LessonHUD transport={hud} />
    </>}</BenchTableFrame>
    {!seat && <div className="fixed inset-x-0 top-3 z-[180] flex justify-center"><button data-testid="bench-sit" className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950" onClick={() => setPanel(true)}>Entrar na Sala de Lições</button></div>}
    {panel && <LessonPanel boardId={BOARD_ID} transport={transport} onClose={() => setPanel(false)} />}
    <aside className="fixed right-2 top-24 hidden w-40 rounded-xl border border-slate-700 bg-slate-900/90 p-2 text-xs xl:block"><b>Mensagens simuladas</b>{log.map((entry, i) => <p key={i}>{entry}</p>)}</aside>
  </div>;
}