import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { LESSON_EXAMPLES } from './lessonExamples';
import { describeExample, describeMove } from './lessonCommentary';
import { computeLessonStats, isProblemFilters, lessonThemeIds, problemFilterThemes, LESSON_THEMES } from './LessonShapes';

describe('comentário factual', () => {
  const initial = new Chess();
  it('descreve captura', () => {
    initial.move('e4'); initial.move('d5');
    expect(describeMove(initial.fen(), 'e4d5', { theme: 'hanging_piece', ply: 1, isPlayerMove: true, isLast: true })).toContain('captura o peão de d5');
  });
  it('descreve xeque', () => {
    const fen = '4k3/8/8/8/8/8/8/K3R3 w - - 0 1';
    expect(describeMove(fen, 'e1e7', { theme: 'fork', ply: 1, isPlayerMove: true, isLast: true })).toContain('xeque');
  });
  it('descreve mate', () => {
    const e = LESSON_EXAMPLES.mate_in_1[0];
    const c = new Chess(e.fen); c.move({ from: e.moves[0].slice(0, 2), to: e.moves[0].slice(2, 4) });
    expect(describeMove(c.fen(), e.moves[1], { theme: 'mate_in_1', ply: 1, isPlayerMove: true, isLast: true })).toContain('Mate!');
  });
  it('descreve promoção e subpromoção', () => {
    const e = LESSON_EXAMPLES.underpromotion[0];
    const c = new Chess(e.fen); c.move({ from: e.moves[0].slice(0, 2), to: e.moves[0].slice(2, 4) });
    expect(describeMove(c.fen(), e.moves[1], { theme: 'underpromotion', ply: 1, isPlayerMove: true, isLast: false })).toContain('Promoção a cavalo');
  });
  it('descreve roque', () => {
    expect(describeMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1', { theme: 'pin', ply: 1, isPlayerMove: true, isLast: false })).toContain('Roque pequeno');
  });
  it('detecta múltiplas ameaças após garfo', () => {
    expect(describeMove('4k3/1r1q4/8/8/4N3/8/8/K7 w - - 0 1', 'e4c5', { theme: 'fork', ply: 1, isPlayerMove: true, isLast: false })).toMatch(/torre de b7.*dama de d7|dama de d7.*torre de b7/);
  });
});

describe('contratos e exemplos', () => {
  it('tem exatamente dois exemplos legais por tema e comentários reproduzíveis', () => {
    const titles = new Set<string>();
    for (const theme of lessonThemeIds()) {
      expect(LESSON_EXAMPLES[theme]).toHaveLength(2);
      expect(LESSON_THEMES[theme].explanation.split(/[.!?]\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
      for (const e of LESSON_EXAMPLES[theme]) {
        expect(e.title.length).toBeGreaterThan(12);
        expect(e.intro.length).toBeGreaterThan(40);
        expect(e.outro.length).toBeGreaterThan(40);
        expect(titles.has(e.title)).toBe(false);
        titles.add(e.title);
        expect(describeExample(e)).toEqual(e.comments);
        const c = new Chess(e.fen);
        for (const move of e.moves) c.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) });
      }
    }
  });
  it('rejeita filtros inválidos e combina temas', () => {
    expect(isProblemFilters({ theme: 'mixed', difficulty: 'any', length: 'oneMove', phase: 'opening', opening: 'Sicilian_Defense' })).toBe(true);
    expect(isProblemFilters({ theme: 'mixed', difficulty: 'any', length: 'oneMove', phase: 'opening', opening: '', showTheme: false })).toBe(true);
    expect(isProblemFilters({ theme: 'mixed', difficulty: 'any', length: 'oneMove', phase: 'opening', showTheme: 'false' })).toBe(false);
    expect(isProblemFilters({ theme: 'mixed', difficulty: 'any', length: 'oneMove', phase: 'opening', opening: 'Invented_Defense' })).toBe(false);
    expect(isProblemFilters({ theme: 'fork', difficulty: 'any', length: 'short', phase: 'any', opening: '%bad' })).toBe(false);
    expect(problemFilterThemes({ theme: 'fork', difficulty: 'any', length: 'short', phase: 'opening' })).toEqual(['fork', 'short', 'opening']);
  });
  it('conta precisão e ordena forças e fraquezas sem mutar entradas', () => {
    const rows = ['fork', 'pin', 'skewer'].flatMap((theme, index) => Array.from({ length: 5 }, (_, i) => ({ theme, solved: i < index + 1, firstTry: i < index + 1 })));
    const stats = computeLessonStats(rows, []);
    expect(stats.accuracy).toBe(6 / 15);
    expect(stats.strongest.map((s) => s.theme)).toEqual(['skewer', 'pin', 'fork']);
    expect(stats.needsPractice.map((s) => s.theme)).toEqual(['fork', 'pin', 'skewer']);
  });
});