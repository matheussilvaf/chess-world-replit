import type { DailySlotView } from '../../../shared/academy/PuzzleShapes';

/** Texto do aviso sobre a mesa, a partir dos slots do dia. */
export function dailyTableSummary(slots: DailySlotView[] | undefined, schemaMissing?: boolean): { text: string; remaining: boolean } {
  if (!slots || schemaMissing || !slots.length) return { text: 'Puzzles do dia', remaining: true };
  const done = slots.filter((s) => s.status === 'solved' || s.status === 'failed').length;
  if (done === 0) return { text: `${slots.length} puzzles para hoje`, remaining: true };
  if (done >= slots.length) return { text: `Tudo feito por hoje · ${done} de ${slots.length}`, remaining: false };
  return { text: `${done} de ${slots.length} concluídos`, remaining: true };
}
