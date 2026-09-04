/**
 * ToolWear — regra pura de desgaste/quebra de ferramentas, compartilhada com
 * o servidor (que a aplica de forma autoritativa) e usada no cliente para a
 * previsão otimista da barra.
 */
import { describe, expect, it } from 'vitest';
import {
  TOOL_WEAR_MAX_ENTRIES,
  TOOL_WEAR_MAX_HITS_PER_ENTRY,
  applyToolWear,
  clampToolRemaining,
  isToolItemKey,
  toolDurabilityRatio,
} from './ToolWear';

describe('isToolItemKey', () => {
  it('só refs de crafttools se desgastam', () => {
    expect(isToolItemKey('gen:crafttools/pickaxe/stone')).toBe(true);
    expect(isToolItemKey('gen:weapon/sword/iron')).toBe(false);
    expect(isToolItemKey('mineral:pedra')).toBe(false);
    expect(isToolItemKey(null)).toBe(false);
  });
});

describe('clampToolRemaining', () => {
  it('null/lixo/≤0 valem cheia; acima do máximo atual é limitado (admin baixou a durabilidade)', () => {
    expect(clampToolRemaining(null, 100)).toBe(100);
    expect(clampToolRemaining(undefined, 100)).toBe(100);
    expect(clampToolRemaining(Number.NaN, 100)).toBe(100);
    expect(clampToolRemaining(0, 100)).toBe(100);
    expect(clampToolRemaining(250, 100)).toBe(100);
    expect(clampToolRemaining(37.9, 100)).toBe(37);
  });
});

describe('applyToolWear', () => {
  it('cópia cheia perde 1 por golpe', () => {
    expect(applyToolWear({ qty: 1, remaining: null }, 1, 100)).toEqual({ qty: 1, remaining: 99, broken: 0 });
    expect(applyToolWear({ qty: 2, remaining: 40 }, 5, 100)).toEqual({ qty: 2, remaining: 35, broken: 0 });
  });

  it('chegar a 0 quebra a cópia; a próxima começa cheia menos o excedente', () => {
    expect(applyToolWear({ qty: 2, remaining: 3 }, 3, 100)).toEqual({ qty: 1, remaining: 100, broken: 1 });
    expect(applyToolWear({ qty: 2, remaining: 3 }, 5, 100)).toEqual({ qty: 1, remaining: 98, broken: 1 });
  });

  it('a última cópia quebrada zera a pilha e limpa a durabilidade', () => {
    expect(applyToolWear({ qty: 1, remaining: 2 }, 2, 100)).toEqual({ qty: 0, remaining: null, broken: 1 });
    expect(applyToolWear({ qty: 1, remaining: 2 }, 999, 100)).toEqual({ qty: 0, remaining: null, broken: 1 });
  });

  it('um lote grande pode quebrar várias cópias de uma vez', () => {
    expect(applyToolWear({ qty: 5, remaining: 10 }, 25, 10)).toEqual({ qty: 3, remaining: 5, broken: 2 });
    expect(applyToolWear({ qty: 2, remaining: 10 }, 25, 10)).toEqual({ qty: 0, remaining: null, broken: 2 });
  });

  it('sem cópias nada se gasta; golpes inválidos não mudam nada', () => {
    expect(applyToolWear({ qty: 0, remaining: 50 }, 10, 100)).toEqual({ qty: 0, remaining: null, broken: 0 });
    expect(applyToolWear({ qty: 1, remaining: 50 }, 0, 100)).toEqual({ qty: 1, remaining: 50, broken: 0 });
    expect(applyToolWear({ qty: 1, remaining: 50 }, -4, 100)).toEqual({ qty: 1, remaining: 50, broken: 0 });
    expect(applyToolWear({ qty: 1, remaining: 50 }, Number.NaN, 100)).toEqual({ qty: 1, remaining: 50, broken: 0 });
  });

  it('durabilidade máxima inválida vira 1 (nunca divide por zero nem loopa)', () => {
    expect(applyToolWear({ qty: 3, remaining: null }, 2, 0)).toEqual({ qty: 1, remaining: 1, broken: 2 });
  });
});

describe('toolDurabilityRatio', () => {
  it('cheia = 1; proporcional ao restante', () => {
    expect(toolDurabilityRatio(null, 100)).toBe(1);
    expect(toolDurabilityRatio(25, 100)).toBe(0.25);
    expect(toolDurabilityRatio(1, 4)).toBe(0.25);
  });
});

describe('limites do lote', () => {
  it('espelham o validador da rota', () => {
    expect(TOOL_WEAR_MAX_ENTRIES).toBe(40);
    expect(TOOL_WEAR_MAX_HITS_PER_ENTRY).toBe(999);
  });
});
