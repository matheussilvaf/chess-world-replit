import { describe, expect, it } from 'vitest';
import type { DailySlotView } from '../../../shared/academy/PuzzleShapes';
import { dailyTableSummary } from './dailyTableSummary';

const slot = (n: 1 | 2 | 3, status: DailySlotView['status']): DailySlotView => ({ slot: n, status } as DailySlotView);

describe('dailyTableSummary', () => {
  it('sem estado (anônimo/tabela ausente) só anuncia os puzzles', () => {
    expect(dailyTableSummary(undefined)).toEqual({ text: 'Puzzles do dia', remaining: true });
    expect(dailyTableSummary([slot(1, 'available')], true)).toEqual({ text: 'Puzzles do dia', remaining: true });
  });
  it('conta resolvidos e reprovados como concluídos', () => {
    expect(dailyTableSummary([slot(1, 'available'), slot(2, 'available'), slot(3, 'available')])).toEqual({ text: '3 puzzles para hoje', remaining: true });
    expect(dailyTableSummary([slot(1, 'solved'), slot(2, 'in_progress'), slot(3, 'available')])).toEqual({ text: '1 de 3 concluídos', remaining: true });
    expect(dailyTableSummary([slot(1, 'solved'), slot(2, 'failed'), slot(3, 'available')])).toEqual({ text: '2 de 3 concluídos', remaining: true });
    expect(dailyTableSummary([slot(1, 'solved'), slot(2, 'failed'), slot(3, 'solved')])).toEqual({ text: 'Tudo feito por hoje · 3 de 3', remaining: false });
  });
});
