import { computeLessonStats, isLessonThemeId, LESSON_PASS_SCORE, type LessonProgressEntry, type LessonStatePayload, type LessonThemeId } from '../../shared/academy/LessonShapes.js';
import { checkPuzzleError, puzzleClient, PuzzleStorageError } from '../puzzles/puzzleRepository.js';

export interface HistoryEntry {
  puzzleId: string; mode: 'lesson' | 'problem'; theme: string | null;
  solved: boolean; firstTry: boolean; rating: number;
}

export async function recentPuzzleIds(userId: string, limit: number): Promise<string[]> {
  const { data, error } = await puzzleClient().from('academy_puzzle_history').select('puzzle_id')
    .eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  checkPuzzleError(error);
  return (data ?? []).map((row) => row.puzzle_id);
}

export async function insertPuzzleHistory(userId: string, entry: HistoryEntry): Promise<void> {
  const { error } = await puzzleClient().from('academy_puzzle_history').insert({
    user_id: userId, puzzle_id: entry.puzzleId, mode: entry.mode, theme: entry.theme,
    solved: entry.solved, first_try: entry.firstTry, rating: entry.rating,
  });
  checkPuzzleError(error);
}

export async function loadPuzzleHistory(userId: string): Promise<{ theme: string | null; solved: boolean; firstTry: boolean }[]> {
  const { data, error } = await puzzleClient().from('academy_puzzle_history').select('theme,solved,first_try')
    .eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(2000);
  checkPuzzleError(error);
  return (data ?? []).map((row) => ({ theme: row.theme, solved: row.solved, firstTry: row.first_try }));
}

export async function loadLessonProgress(userId: string): Promise<LessonProgressEntry[]> {
  const { data, error } = await puzzleClient().from('academy_lesson_progress')
    .select('theme,best_score,attempts,completed_at').eq('user_id', userId);
  checkPuzzleError(error);
  return (data ?? []).filter((row) => isLessonThemeId(row.theme)).map((row) => ({
    theme: row.theme as LessonThemeId, bestScore: row.best_score, attempts: row.attempts,
    completed: !!row.completed_at, ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  }));
}

export async function saveLessonProgress(userId: string, theme: LessonThemeId, solved: number): Promise<{ completed: boolean; newlyCompleted: boolean }> {
  const previous = (await loadLessonProgress(userId)).find((row) => row.theme === theme);
  const completed = !!previous?.completed || solved >= LESSON_PASS_SCORE;
  const newlyCompleted = completed && !previous?.completed;
  const { error } = await puzzleClient().from('academy_lesson_progress').upsert({
    user_id: userId, theme, best_score: Math.max(previous?.bestScore ?? 0, solved),
    attempts: (previous?.attempts ?? 0) + 1,
    completed_at: previous?.completedAt ?? (newlyCompleted ? new Date().toISOString() : null),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,theme' });
  checkPuzzleError(error);
  return { completed, newlyCompleted };
}

export async function buildLessonState(userId: string): Promise<LessonStatePayload> {
  try {
    const [progress, history] = await Promise.all([loadLessonProgress(userId), loadPuzzleHistory(userId)]);
    return { progress, stats: computeLessonStats(history, progress), schemaMissing: false };
  } catch (error) {
    if (!(error instanceof PuzzleStorageError) || !error.schemaMissing) throw error;
    return { progress: [], stats: computeLessonStats([], []), schemaMissing: true };
  }
}