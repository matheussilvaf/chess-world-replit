/**
 * CollectionShapes — regras novas de coleta: ferramenta requerida por
 * recurso, nível mínimo (0–6) e piso de travamento da ferramenta fraca.
 * Testes só de regra (nenhum nome real de recurso é obrigatório aqui).
 */
import { describe, expect, it } from 'vitest';
import {
  COLLECTION_CONFIG_ID,
  GATHER_LOCK_HP_RATIO,
  GATHER_TOOL_KINDS,
  GATHER_TOOL_LABELS,
  RESOURCE_MIN_LEVEL_RANGE,
  defaultGatherToolFor,
  isGatherToolKind,
  lockedHpFloorFor,
  validateCollectionWorldConfig,
} from './CollectionShapes.js';

const baseConfig = () => ({
  configId: COLLECTION_CONFIG_ID,
  mineralCounts: {},
  hurtboxes: {},
});

describe('isGatherToolKind / GATHER_TOOL_KINDS', () => {
  it('aceita exatamente os tipos declarados', () => {
    for (const kind of GATHER_TOOL_KINDS) expect(isGatherToolKind(kind)).toBe(true);
    expect(isGatherToolKind('sword')).toBe(false);
    expect(isGatherToolKind('')).toBe(false);
    expect(isGatherToolKind(undefined)).toBe(false);
    expect(isGatherToolKind(null)).toBe(false);
    expect(isGatherToolKind(3)).toBe(false);
  });

  it('todo tipo tem rótulo PT-BR', () => {
    for (const kind of GATHER_TOOL_KINDS) {
      expect(typeof GATHER_TOOL_LABELS[kind]).toBe('string');
      expect(GATHER_TOOL_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('defaultGatherToolFor (pareamento padrão recurso→ferramenta)', () => {
  it('usa o TIPO do recurso (prefixo da chave)', () => {
    expect(defaultGatherToolFor('tree:oak')).toBe('axe');
    expect(defaultGatherToolFor('mineral:iron')).toBe('pickaxe');
    expect(defaultGatherToolFor('bush')).toBe('machete');
    expect(defaultGatherToolFor('hand_stone')).toBe('hand');
    expect(defaultGatherToolFor('herb:mint')).toBe('hand');
    expect(defaultGatherToolFor('animal:cow')).toBe('hand');
  });

  it('recurso desconhecido cai na mão (nunca trava a coleta por engano)', () => {
    expect(defaultGatherToolFor('coisa:desconhecida')).toBe('hand');
  });
});

describe('lockedHpFloorFor (piso da ferramenta fraca)', () => {
  it('percentual do HP máximo, arredondado, mínimo 1', () => {
    expect(GATHER_LOCK_HP_RATIO).toBeCloseTo(0.2);
    expect(lockedHpFloorFor(100)).toBe(20);
    expect(lockedHpFloorFor(20)).toBe(4);
    expect(lockedHpFloorFor(7)).toBe(1); // round(1.4) = 1
    expect(lockedHpFloorFor(1)).toBe(1); // nunca 0 — o nó não pode quebrar
    expect(lockedHpFloorFor(0)).toBe(1);
  });

  it('piso fica sempre entre 1 e o próprio HP máximo', () => {
    for (const hp of [1, 2, 3, 5, 10, 50, 999]) {
      expect(lockedHpFloorFor(hp)).toBeGreaterThanOrEqual(1);
      expect(lockedHpFloorFor(hp)).toBeLessThanOrEqual(Math.max(1, hp));
    }
  });
});

describe('validateCollectionWorldConfig — resourceMinLevel/resourceTool', () => {
  it('aceita config sem os campos novos (retrocompatível)', () => {
    expect(validateCollectionWorldConfig(baseConfig()).ok).toBe(true);
  });

  it('aceita nível dentro da faixa e ferramenta conhecida', () => {
    const result = validateCollectionWorldConfig({
      ...baseConfig(),
      resourceMinLevel: {
        'tree:oak': RESOURCE_MIN_LEVEL_RANGE.max,
        'mineral:iron': RESOURCE_MIN_LEVEL_RANGE.min,
      },
      resourceTool: { 'tree:oak': 'axe', 'herb:mint': 'hand' },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejeita nível fora da faixa ou não inteiro', () => {
    const above = validateCollectionWorldConfig({
      ...baseConfig(),
      resourceMinLevel: { 'tree:oak': RESOURCE_MIN_LEVEL_RANGE.max + 1 },
    });
    expect(above.ok).toBe(false);
    const negative = validateCollectionWorldConfig({
      ...baseConfig(),
      resourceMinLevel: { 'tree:oak': -1 },
    });
    expect(negative.ok).toBe(false);
    const fractional = validateCollectionWorldConfig({
      ...baseConfig(),
      resourceMinLevel: { 'tree:oak': 2.5 },
    });
    expect(fractional.ok).toBe(false);
  });

  it('rejeita ferramenta desconhecida ou formato errado', () => {
    expect(
      validateCollectionWorldConfig({
        ...baseConfig(),
        resourceTool: { 'tree:oak': 'sword' },
      }).ok,
    ).toBe(false);
    expect(
      validateCollectionWorldConfig({ ...baseConfig(), resourceTool: 5 }).ok,
    ).toBe(false);
    expect(
      validateCollectionWorldConfig({ ...baseConfig(), resourceMinLevel: [] }).ok,
    ).toBe(false);
  });
});
