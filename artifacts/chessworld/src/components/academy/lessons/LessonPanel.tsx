import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { LESSON_CATEGORIES, LESSON_THEMES, LESSON_DIFFICULTIES, PROBLEM_THEME_GROUPS, PROBLEM_DIFFICULTIES, PROBLEM_LENGTHS, PROBLEM_PHASES, isProblemFilters, openingTagLabel, problemThemeLabel, type LessonDifficultyId, type ProblemFilters } from '../../../shared/academy/LessonShapes';
import { LESSON_EXAMPLES } from '../../../shared/academy/lessonExamples';
import { useLessonStore } from '../../../stores/lessonStore';
import { usePuzzleStore } from '../../../stores/puzzleStore';
import { usePuzzleSessionStore } from '../../../stores/puzzleSessionStore';
import { useGameStore } from '../../../stores/gameStore';
import { sendLessonOpen, sendLessonSit, sendLessonPracticeStart, sendLessonProblemStart, sendLessonLeave } from '../../../game/network/lessonHandlers';

export interface LessonTransport {
  open: () => void; sit: (boardId: string) => void; leave: () => void;
  practiceStart: typeof sendLessonPracticeStart; problemStart: typeof sendLessonProblemStart;
}
const realTransport: LessonTransport = { open: sendLessonOpen, sit: sendLessonSit, leave: sendLessonLeave, practiceStart: sendLessonPracticeStart, problemStart: sendLessonProblemStart };
const button = 'rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500/60';
const primary = 'rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40';

export function LessonPanel({ boardId, transport = realTransport, onClose }: { boardId: string; transport?: LessonTransport; onClose?: () => void }) {
  const state = useLessonStore((s) => s.state);
  const tab = useLessonStore((s) => s.tab);
  const theme = useLessonStore((s) => s.theme);
  const step = useLessonStore((s) => s.step);
  const difficulty = useLessonStore((s) => s.difficulty);
  const filters = useLessonStore((s) => s.filters);
  const example = useLessonStore((s) => s.example);
  const seat = usePuzzleStore((s) => s.seat);
  const solutionStep = usePuzzleSessionStore((s) => s.solutionStep);
  useEffect(() => {
    if (example) useLessonStore.getState().setExamplePly(solutionStep);
    // The example identity only changes when a new example is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solutionStep, example?.theme, example?.exampleIndex]);
  const [placement, setPlacement] = useState<'left' | 'right' | 'bottom'>('bottom');
  const [sideWidth, setSideWidth] = useState(370);
  const close = () => {
    useLessonStore.getState().setBoardId(null);
    useGameStore.getState().setSelectedBoard(null);
    useGameStore.getState().setBoardLocked(false);
    onClose?.();
  };
  useEffect(() => {
    useLessonStore.getState().setBoardId(boardId);
    if (usePuzzleStore.getState().seat?.boardId !== boardId) transport.sit(boardId);
    transport.open();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); useLessonStore.getState().setBoardId(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);
  useEffect(() => {
    const poll = () => {
      const rect = (window as any).__tableScreenRects?.[boardId];
      if (window.innerWidth < 750 || !rect) { setPlacement('bottom'); return; }
      const leftGap = rect.x;
      const rightGap = window.innerWidth - rect.x - rect.width;
      const side = leftGap >= rightGap ? 'left' : 'right';
      const gap = Math.max(leftGap, rightGap);
      if (gap < 260) { setPlacement('bottom'); return; }
      setSideWidth(Math.min(370, gap - 24));
      setPlacement(side);
    };
    poll();
    const timer = window.setInterval(poll, 500);
    return () => window.clearInterval(timer);
  }, [boardId]);
  const selectExample = (index: number) => {
    if (!theme || !seat || seat.boardId !== boardId) return;
    const item = LESSON_EXAMPLES[theme][index];
    useLessonStore.getState().showExample(theme, index);
    usePuzzleSessionStore.getState().showExample({ boardId, seat: seat.seat, fen: item.fen, moves: item.moves, playerColor: item.playerColor });
  };
  const chosen = example && theme === example.theme ? LESSON_EXAMPLES[theme][example.exampleIndex] : null;
  const updateFilter = <K extends keyof ProblemFilters>(key: K, value: ProblemFilters[K]) => useLessonStore.getState().setFilters({ ...filters, [key]: value });
  const valid = isProblemFilters(filters);
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  return <div className="pointer-events-none fixed inset-0 z-[1000]" data-testid="lesson-panel">
    <section role="dialog" aria-label="Sala de Lições" style={placement !== 'bottom' ? { width: sideWidth } : undefined} className={`pointer-events-auto absolute flex w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-amber-500/40 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md ${placement === 'bottom' ? `${example ? 'max-h-[28vh]' : 'max-h-[min(68vh,620px)]'} bottom-3 left-3 sm:left-4` : placement === 'left' ? 'max-h-[min(80vh,690px)] left-4 top-1/2 -translate-y-1/2' : 'max-h-[min(80vh,690px)] right-4 top-1/2 -translate-y-1/2'}`}>
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div><h2 className="font-bold text-amber-200">Sala de Lições</h2><p className="text-[11px] text-slate-400">Lições concluídas {state.stats.lessonsCompleted}/{state.stats.lessonsTotal}</p></div>
        <button type="button" aria-label="Fechar" onClick={close}><X className="h-5 w-5" /></button>
      </header>
      <nav className="flex border-b border-slate-700">
        {(['licoes', 'problemas'] as const).map((item) => <button type="button" key={item} data-testid={`lesson-tab-${item}`} onClick={() => useLessonStore.getState().setTab(item)} className={`flex-1 py-2 text-xs font-bold ${tab === item ? 'border-b-2 border-amber-400 text-amber-300' : 'text-slate-400'}`}>{item === 'licoes' ? 'LIÇÕES' : 'PROBLEMAS'}</button>)}
      </nav>
      <div className="space-y-3 overflow-y-auto p-4 text-sm">
        {state.schemaMissing && <p role="alert" className="rounded-lg border border-amber-600/50 bg-amber-900/20 p-2 text-xs text-amber-200">O histórico de treino ainda não está instalado. Você pode explorar os exemplos, mas o progresso pode não ser salvo.</p>}
        {tab === 'licoes' && (!theme ? LESSON_CATEGORIES.map((category) => <div key={category.id}>
          <h3 className="mb-1 text-xs font-bold text-amber-300">{category.label} · {category.themes.filter((id) => state.progress.some((p) => p.theme === id && p.completed)).length}/{category.themes.length}</h3>
          <div className="grid grid-cols-2 gap-1.5">{category.themes.map((id) => {
            const progress = state.progress.find((p) => p.theme === id);
            return <button type="button" data-testid={`lesson-theme-${id}`} key={id} onClick={() => useLessonStore.getState().selectTheme(id)} className={`${button} text-left`}>
              {progress?.completed ? '🕯️' : '○'} {LESSON_THEMES[id].label} <span className="block text-[10px] text-slate-400">{progress ? `Melhor: ${progress.bestScore}/10` : 'Não iniciada'}</span>
            </button>;
          })}</div>
        </div>) : <>
          <button type="button" className="text-xs text-amber-300" onClick={() => { useLessonStore.getState().selectTheme(theme); useLessonStore.setState({ theme: null }); usePuzzleSessionStore.getState().clear(); }}>← Todas as lições</button>
          <h3 className="text-lg font-bold">{LESSON_THEMES[theme].label}</h3>
          <div className="grid grid-cols-3 gap-1">{(['explicacao', 'exemplos', 'pratica'] as const).map((item, index) => <button type="button" key={item} onClick={() => useLessonStore.getState().setStep(item)} className={`${button} ${step === item ? 'border-amber-400 text-amber-300' : ''}`}>{index + 1}. {item === 'explicacao' ? 'Explicação' : item === 'exemplos' ? 'Exemplos' : 'Prática'}</button>)}</div>
          {step === 'explicacao' && <><p className="leading-relaxed text-slate-200">{LESSON_THEMES[theme].explanation}</p><button className={primary} onClick={() => useLessonStore.getState().setStep('exemplos')}>Ver exemplos →</button></>}
          {step === 'exemplos' && <>
            {LESSON_EXAMPLES[theme].map((item, index) => <div key={item.puzzleId} className="rounded-xl border border-slate-700 p-3"><p className="font-semibold">{index + 1}. {item.title}</p><p className="my-1 text-xs text-slate-400">{item.intro}</p><button type="button" className={button} onClick={() => selectExample(index)}>Ver no tabuleiro</button></div>)}
            {chosen && <div className="rounded-xl border border-amber-500/40 bg-slate-800 p-3"><p className="text-xs text-amber-300">Exemplo {example!.exampleIndex + 1}/2 · lance {solutionStep}/{chosen.moves.length}</p><p className="my-2 text-xs text-slate-200">{solutionStep ? chosen.comments[solutionStep - 1] ?? chosen.outro : chosen.intro}</p>
              <div className="flex items-center gap-2"><button aria-label="Lance anterior" className={button} disabled={!solutionStep} onClick={() => usePuzzleSessionStore.getState().setSolutionStep(solutionStep - 1)}><ChevronLeft size={16}/></button><button className={button} disabled={solutionStep >= chosen.moves.length} onClick={() => usePuzzleSessionStore.getState().setSolutionStep(solutionStep + 1)}>Próximo lance <ChevronRight size={14} className="inline"/></button></div>
            </div>}
            <button className={primary} onClick={() => useLessonStore.getState().setStep('pratica')}>Ir para prática →</button>
          </>}
          {step === 'pratica' && <><label className="block text-xs text-slate-300">Dificuldade<select className="mt-1 w-full rounded-lg bg-slate-800 p-2 text-white" value={difficulty} onChange={(e) => useLessonStore.getState().setDifficulty(e.target.value as LessonDifficultyId)}>{Object.entries(LESSON_DIFFICULTIES).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}</select></label>
            <button data-testid="lesson-start-practice" className={primary} onClick={() => { transport.practiceStart(boardId, theme, difficulty); close(); }}>Começar (10 posições)</button></>}
        </>)}
        {tab === 'problemas' && <>
          <h3 className="font-semibold text-amber-200">Treino livre</h3>
          <label className="block text-xs">Tema<select className="mt-1 w-full rounded-lg bg-slate-800 p-2" value={filters.theme} onChange={(e) => updateFilter('theme', e.target.value)}>{PROBLEM_THEME_GROUPS.map((group) => <optgroup label={group.label} key={group.id}>{group.themes.map((id) => <option key={id} value={id}>{problemThemeLabel(id)}</option>)}</optgroup>)}</select></label>
          {([
            ['difficulty', PROBLEM_DIFFICULTIES, 'Dificuldade'], ['length', PROBLEM_LENGTHS, 'Extensão'], ['phase', PROBLEM_PHASES, 'Fase'],
          ] as const).map(([key, choices, label]) => <label key={key} className="block text-xs">{label}<select className="mt-1 w-full rounded-lg bg-slate-800 p-2" value={filters[key]} onChange={(e) => useLessonStore.getState().setFilters({ ...filters, [key]: e.target.value })}>{Object.entries(choices).map(([id, info]) => <option key={id} value={id}>{typeof info === 'string' ? info : info.label}</option>)}</select></label>)}
          <label className="block text-xs">Tag de abertura<input className="mt-1 w-full rounded-lg bg-slate-800 p-2" maxLength={64} placeholder="Ex.: Sicilian_Defense" value={filters.opening ?? ''} onChange={(e) => updateFilter('opening', e.target.value || undefined)} />{filters.opening && <span className="text-slate-400">{openingTagLabel(filters.opening)}</span>}</label>
          {!valid && <p role="alert" className="text-xs text-red-300">Use até 64 letras, números, hífens ou sublinhados na abertura.</p>}
          <button disabled={!valid} className={primary} onClick={() => { if (valid) { transport.problemStart(boardId, filters); close(); } }}>Resolver</button>
          <div className="border-t border-slate-700 pt-3 text-xs"><h3 className="mb-2 font-bold text-amber-300">Estatísticas de treino</h3>
            <p>Lições concluídas: {state.stats.lessonsCompleted}/{state.stats.lessonsTotal}</p><p>Tentados: {state.stats.attempted} · Acertos de primeira: {state.stats.solvedFirstTry}</p>
            <p>Precisão geral: {state.stats.attempted ? percent(state.stats.accuracy) : 'Ainda sem dados'}</p>
            <h4 className="mt-2 font-semibold">Precisão por tema</h4><p>{state.stats.byTheme.length ? state.stats.byTheme.map((s) => `${s.label}: ${percent(s.accuracy)}`).join(' · ') : 'Ainda sem dados'}</p>
            <h4 className="mt-2 font-semibold">Pontos fortes</h4><p>{state.stats.strongest.length ? state.stats.strongest.map((s) => s.label).join(', ') : 'Ainda sem dados'}</p>
            <h4 className="mt-2 font-semibold">Precisa praticar</h4><p>{state.stats.needsPractice.length ? state.stats.needsPractice.map((s) => s.label).join(', ') : 'Ainda sem dados'}</p>
          </div>
        </>}
        <button className="text-xs text-red-300" onClick={() => { transport.leave(); close(); }}>Levantar da carteira</button>
      </div>
    </section>
  </div>;
}