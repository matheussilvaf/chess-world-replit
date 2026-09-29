import { useEffect, useState } from 'react';
import { LESSON_DIFFICULTIES, LESSON_PASS_SCORE, LESSON_PRACTICE_SIZE, LESSON_THEMES, PROBLEM_DIFFICULTIES, problemThemeLabel } from '../../../shared/academy/LessonShapes';
import { useLessonStore } from '../../../stores/lessonStore';
import { usePuzzleStore } from '../../../stores/puzzleStore';
import { usePuzzleSessionStore } from '../../../stores/puzzleSessionStore';
import { useAuthStore } from '../../../stores/authStore';
import { useGameStore } from '../../../stores/gameStore';
import { usePuzzleTable } from '../puzzles/usePuzzleTable';
import { reseatForLesson, sendLessonLeave, sendLessonNext, sendLessonStop, sendLessonPracticeStart } from '../../../game/network/lessonHandlers';

export interface LessonHUDTransport {
  next: typeof sendLessonNext; stop: typeof sendLessonStop; leave: typeof sendLessonLeave; practiceStart: typeof sendLessonPracticeStart; openPanel: (boardId: string) => void; sit?: (boardId: string) => void;
}
const action = 'rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400';
export function LessonHUD({ transport }: { transport?: LessonHUDTransport }) {
  const table = usePuzzleTable();
  const run = useLessonStore((s) => s.run);
  const solved = useLessonStore((s) => s.solved);
  const attempted = useLessonStore((s) => s.attempted);
  const lastEnd = useLessonStore((s) => s.lastEnd);
  const endedBoardId = useLessonStore((s) => s.boardId);
  const example = useLessonStore((s) => s.example);
  const puzzle = usePuzzleSessionStore((s) => s.puzzle);
  const phase = usePuzzleSessionStore((s) => s.phase);
  const moveNumber = usePuzzleSessionStore((s) => s.moveNumber);
  const solutionStep = usePuzzleSessionStore((s) => s.solutionStep);
  const solution = usePuzzleSessionStore((s) => s.feedback?.solutionMoves);
  const revealedThemes = usePuzzleSessionStore((s) => s.feedback?.themes);
  const name = useAuthStore((s) => s.profile?.username) ?? 'Você';
  const [options, setOptions] = useState(false);
  // Sentou em outra mesa (diário/batalha) com o resultado ainda aberto: o resultado sai de cena.
  const otherTable = !!table && table.kind !== 'lesson';
  useEffect(() => { if (otherTable && lastEnd) useLessonStore.setState({ lastEnd: null }); }, [otherTable, lastEnd]);
  if (otherTable || (table?.kind !== 'lesson' && !lastEnd)) return null;
  // Em lição, a mesa atual; no resultado (já levantado), a carteira onde a sessão terminou.
  const boardId = table?.kind === 'lesson' ? table.boardId : endedBoardId;
  if (!boardId) return null;
  const closeResult = () => useLessonStore.setState({ lastEnd: null });
  const reseat = (actionAfterSeat: () => void) => {
    if (transport?.sit) { transport.sit(boardId); actionAfterSeat(); }
    else reseatForLesson(boardId, actionAfterSeat);
  };
  const open = () => {
    setOptions(false);
    if (transport) { transport.openPanel(boardId); return; }
    useGameStore.getState().setSelectedBoard({
      id: boardId, name: 'Sala de Lições', region: useAuthStore.getState().profile?.current_region ?? '',
      x: 0, y: 0, status: 'free', waiting_user_id: null, current_match_id: null,
      time_minutes: null, increment_seconds: null, created_at: '', updated_at: '',
    });
  };
  const next = () => (transport?.next ?? sendLessonNext)(boardId);
  const stop = () => { (transport?.stop ?? sendLessonStop)(boardId); setOptions(false); };
  const leave = () => { (transport?.leave ?? sendLessonLeave)(); setOptions(false); };
  const title = example ? `Exemplo ${example.exampleIndex + 1}/2 · ${LESSON_THEMES[example.theme].label}` :
    run?.kind === 'lesson' ? `Prática · ${LESSON_THEMES[run.theme].label} · ${LESSON_DIFFICULTIES[run.difficulty].label}` :
    run?.kind === 'problem' ? `Problemas · ${problemThemeLabel(run.filters.theme)} · ${PROBLEM_DIFFICULTIES[run.filters.difficulty].label}` : 'Sala de Lições';
  const status = phase === 'wrong' || phase === 'solution' ? 'Lance errado — veja a solução' : phase === 'solved' ? 'Resolvido!' :
    phase === 'ready' && puzzle ? `Sua vez · lance ${moveNumber} de ${puzzle.solutionLength}` : phase === 'waiting' ? 'Verificando lance…' : phase === 'reply' ? 'Resposta do adversário…' : '';
  const themes = puzzle?.themes?.length ? puzzle.themes : revealedThemes ?? [];
  return <>
    {table?.kind === 'lesson' && <>
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[200] flex justify-center">
      <div className="max-w-full rounded-xl border border-amber-500/40 bg-slate-900/95 px-4 py-2 text-center text-xs text-white shadow-xl">
        <p className="truncate font-bold text-amber-300">{title}</p>
        {run && <p className="mt-1 text-slate-300">{run.kind === 'lesson' ? `Posição ${run.index + 1} de ${run.total}` : `Posição ${run.index + 1}`} · <span className="text-emerald-300">✓{solved}</span> <span className="text-red-300">✗{attempted - solved}</span></p>}
        {run && <p className="mt-1 text-emerald-300">{status}</p>}
        {run && themes.length > 0 && <p className="mt-1 text-amber-200">Tema: {themes.map(problemThemeLabel).join(', ')}</p>}
      </div>
    </div>
    {/* Durante a faixa de solução/resolvido o cartão do jogador sai: a faixa ocupa a base inteira sem cobrir o tabuleiro. */}
    {!(run && (phase === 'solved' || phase === 'solution')) && <div className="fixed bottom-3 left-3 z-[200] w-[min(280px,55vw)] text-xs text-white">
      {options && <div className="mb-2 flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl">
        {run && <button data-testid="lesson-stop" className="rounded-lg bg-slate-700 p-2 text-left" onClick={stop}>Parar</button>}
        <button data-testid="lesson-leave" className="rounded-lg bg-red-800 p-2 text-left" onClick={leave}>Levantar</button>
        <button className="rounded-lg bg-amber-600 p-2 text-left" onClick={open}>Voltar ao painel</button>
      </div>}
       <button className="flex w-full items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl" onClick={() => setOptions(!options)}><span className={`h-2.5 w-2.5 rounded-full ${table.orientation === 'w' ? 'bg-white' : 'border border-white bg-slate-950'}`}/><span className="min-w-0 flex-1 truncate text-left">{name}</span><span className="text-emerald-300">✓{solved}</span><span className="text-red-300">✗{attempted - solved}</span></button>
    </div>}
    {run && (phase === 'solved' || phase === 'solution') && <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[210] flex justify-center">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-slate-900/95 px-3 py-2 text-center text-xs text-white shadow-xl">
        <p className={phase === 'solved' ? 'text-emerald-300' : 'text-red-300'}>{phase === 'solved' ? 'Resolvido!' : 'Lance errado — veja a solução'}</p>
         {phase === 'solution' && solution && <div className="flex items-center gap-2"><button aria-label="Lance anterior" disabled={solutionStep === 0} onClick={() => usePuzzleSessionStore.getState().navigateSolution(solutionStep - 1)}>◀</button><span>Solução {solutionStep}/{solution.length}</span><button aria-label="Próximo lance" disabled={solutionStep >= solution.length} onClick={() => usePuzzleSessionStore.getState().navigateSolution(solutionStep + 1)}>▶</button></div>}
        <button data-testid="lesson-next" className={action} onClick={next}>Próxima posição</button>
        <button type="button" className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800" onClick={stop}>Parar</button>
      </div>
    </div>}
    </>}
    {lastEnd && <div className="pointer-events-none fixed inset-0 z-[230] flex items-center justify-center p-4"><div data-testid="lesson-result" className="pointer-events-auto w-full max-w-sm rounded-2xl border border-amber-500/50 bg-slate-900/95 p-6 text-center text-white shadow-2xl">
      <h3 className="text-xl font-bold text-amber-300">{lastEnd.kind === 'lesson' ? `Você acertou ${lastEnd.solved} de ${lastEnd.total ?? lastEnd.attempted}` : `Treino encerrado · ${lastEnd.solved} de ${lastEnd.attempted}`}</h3>
      <p className="my-3 text-sm">{lastEnd.kind === 'lesson' && lastEnd.reason !== 'finished' ? 'Prática interrompida — só as 10 posições completas contam para a vela.'
        : lastEnd.newlyCompleted ? 'Tema concluído! 🕯️' : lastEnd.completed ? 'Tema já concluído — bom treino!' : lastEnd.kind === 'lesson' ? `Acerte ${LESSON_PASS_SCORE} de ${lastEnd.total ?? LESSON_PRACTICE_SIZE} para acender a vela.` : 'Continue praticando!'}</p>
       <div className="flex justify-center gap-2">{lastEnd.kind === 'lesson' && lastEnd.theme && <button className={action} onClick={() => reseat(() => { useLessonStore.setState({ lastEnd: null }); (transport?.practiceStart ?? sendLessonPracticeStart)(boardId, lastEnd.theme!, useLessonStore.getState().difficulty); })}>Refazer com 10 novas</button>}
         <button className={action} onClick={() => reseat(() => { useLessonStore.setState({ lastEnd: null }); open(); })}>Voltar ao painel</button>
         <button className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800" onClick={closeResult}>Fechar</button></div>
    </div></div>}
  </>;
}