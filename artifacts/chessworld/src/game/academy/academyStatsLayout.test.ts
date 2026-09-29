import { describe, expect, it } from 'vitest';
import { BOARDS, PERIODS, clampPage, pageCount, parseBoardResponse, truncateName } from './academyStatsLayout';

describe('estatísticas da academia', () => {
  it('pagina com limites estáveis', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(17)).toBe(3);
    expect(clampPage(99, 17)).toBe(3);
    expect(clampPage(0, 17)).toBe(1);
  });
  it('trunca nomes longos sem cortar caracteres Unicode', () => {
    expect(truncateName('Ana', 5)).toBe('Ana');
    expect(truncateName('Jogadora😀Grande', 9)).toBe('Jogadora…');
  });
  it('mapeia labels em português', () => {
    expect(BOARDS.map((b) => b.label)).toContain('1ª tentativa');
    expect(PERIODS.map((p) => p.label)).toEqual(['Semana', 'Mês', 'Sempre']);
  });
  it('trata schema ausente e respostas inválidas', () => {
    expect(parseBoardResponse({ schemaMissing: true }).rows).toEqual([]);
    expect(() => parseBoardResponse({ rows: null })).toThrow();
  });
});