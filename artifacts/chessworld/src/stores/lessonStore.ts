import { create } from 'zustand';
import { DEFAULT_PROBLEM_FILTERS, computeLessonStats, type LessonDifficultyId, type LessonStatePayload, type LessonSessionEndPayload, type LessonThemeId, type ProblemFilters } from '../shared/academy/LessonShapes';
import type { PuzzleStartedPayload } from '../shared/academy/PuzzleShapes';

export interface LessonStore {
  state: LessonStatePayload;
  boardId: string | null;
  tab: 'licoes' | 'problemas';
  theme: LessonThemeId | null;
  step: 'explicacao' | 'exemplos' | 'pratica';
  difficulty: LessonDifficultyId;
  filters: ProblemFilters;
  run: Extract<PuzzleStartedPayload['context'], { kind: 'lesson' | 'problem' }> | null;
  solved: number;
  attempted: number;
  lastEnd: LessonSessionEndPayload | null;
  example: { theme: LessonThemeId; exampleIndex: number; ply: number } | null;
  setState: (state: LessonStatePayload) => void;
  setBoardId: (boardId: string | null) => void;
  setTab: (tab: LessonStore['tab']) => void;
  selectTheme: (theme: LessonThemeId) => void;
  setStep: (step: LessonStore['step']) => void;
  setDifficulty: (difficulty: LessonDifficultyId) => void;
  setFilters: (filters: ProblemFilters) => void;
  start: (payload: PuzzleStartedPayload) => void;
  finishPuzzle: (solved: boolean) => void;
  end: (end: LessonSessionEndPayload) => void;
  showExample: (theme: LessonThemeId, exampleIndex: number) => void;
  setExamplePly: (ply: number) => void;
  reset: () => void;
}
const emptyState: LessonStatePayload = { progress: [], stats: computeLessonStats([], []) };
export const useLessonStore = create<LessonStore>((set) => ({
  state: emptyState, boardId: null, tab: 'licoes', theme: null, step: 'explicacao',
  difficulty: 'iniciante', filters: DEFAULT_PROBLEM_FILTERS, run: null, solved: 0, attempted: 0, lastEnd: null, example: null,
  setState: (state) => set({ state }),
  setBoardId: (boardId) => set({ boardId }),
  setTab: (tab) => set({ tab }),
  selectTheme: (theme) => set({ theme, step: 'explicacao', example: null }),
  setStep: (step) => set({ step }),
  setDifficulty: (difficulty) => set({ difficulty }),
  setFilters: (filters) => set({ filters }),
  start: (payload) => {
    if (payload.context.kind !== 'lesson' && payload.context.kind !== 'problem') return;
    const index = payload.context.index;
    set((s) => ({
      run: payload.context as LessonStore['run'], boardId: null, example: null, lastEnd: null,
      solved: index === 0 ? 0 : s.solved, attempted: index === 0 ? 0 : s.attempted,
    }));
  },
  finishPuzzle: (solved) => set((s) => ({ attempted: s.attempted + 1, solved: s.solved + (solved ? 1 : 0) })),
  end: (lastEnd) => set({ lastEnd, run: null, solved: lastEnd.solved, attempted: lastEnd.attempted }),
  showExample: (theme, exampleIndex) => set({ example: { theme, exampleIndex, ply: 0 } }),
  setExamplePly: (ply) => set((s) => s.example ? { example: { ...s.example, ply } } : {}),
  reset: () => set({ state: emptyState, boardId: null, tab: 'licoes', theme: null, step: 'explicacao', difficulty: 'iniciante', filters: DEFAULT_PROBLEM_FILTERS, run: null, solved: 0, attempted: 0, lastEnd: null, example: null }),
}));