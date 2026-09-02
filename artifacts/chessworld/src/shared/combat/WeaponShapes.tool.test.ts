/**
 * WeaponShapes — campos NOVOS do tool de coleta (nível 0–6 + "incluir no
 * inventário"): helpers de leitura (clamp/padrões) e validação
 * retrocompatível (configs antigas sem os campos continuam válidas).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_LEVEL,
  TOOL_LEVEL_RANGE,
  getToolLevel,
  isToolInInventory,
  validateWeaponFamilyConfig,
  type WeaponFamilyConfig,
} from './WeaponShapes.js';

function familyWithTool(tool: Record<string, unknown> | undefined): WeaponFamilyConfig {
  return {
    familyId: 'ferramenta_teste',
    weaponHitboxProfileId: null,
    variants: { default: tool === undefined ? {} : { tool } },
  } as unknown as WeaponFamilyConfig;
}

const validTool = { power: 5, durability: 40 };

describe('getToolLevel', () => {
  it('família/variação sem tool (ou sem level) → nível padrão', () => {
    expect(getToolLevel(null, 'default')).toBe(DEFAULT_TOOL_LEVEL);
    expect(getToolLevel(familyWithTool(undefined), 'default')).toBe(DEFAULT_TOOL_LEVEL);
    expect(getToolLevel(familyWithTool(validTool), 'default')).toBe(DEFAULT_TOOL_LEVEL);
  });

  it('lê o nível autorado, arredonda e clampa na faixa', () => {
    expect(getToolLevel(familyWithTool({ ...validTool, level: 3 }), 'default')).toBe(3);
    expect(getToolLevel(familyWithTool({ ...validTool, level: 99 }), 'default')).toBe(
      TOOL_LEVEL_RANGE.max,
    );
    expect(getToolLevel(familyWithTool({ ...validTool, level: -2 }), 'default')).toBe(
      TOOL_LEVEL_RANGE.min,
    );
    expect(getToolLevel(familyWithTool({ ...validTool, level: 2.6 }), 'default')).toBe(3);
  });
});

describe('isToolInInventory', () => {
  it('ausente = incluída (retrocompatível com configs antigas)', () => {
    expect(isToolInInventory(null, 'default')).toBe(true);
    expect(isToolInInventory(familyWithTool(validTool), 'default')).toBe(true);
  });

  it('só sai do inventário com false explícito', () => {
    expect(isToolInInventory(familyWithTool({ ...validTool, inInventory: false }), 'default')).toBe(
      false,
    );
    expect(isToolInInventory(familyWithTool({ ...validTool, inInventory: true }), 'default')).toBe(
      true,
    );
  });
});

describe('validateWeaponFamilyConfig — tool.level / tool.inInventory', () => {
  it('tool sem os campos novos continua válido', () => {
    expect(validateWeaponFamilyConfig(familyWithTool(validTool)).ok).toBe(true);
  });

  it('aceita level 0–6 inteiro e inInventory booleano', () => {
    expect(
      validateWeaponFamilyConfig(familyWithTool({ ...validTool, level: 0, inInventory: true })).ok,
    ).toBe(true);
    expect(
      validateWeaponFamilyConfig(familyWithTool({ ...validTool, level: 6, inInventory: false })).ok,
    ).toBe(true);
  });

  it('rejeita level fora da faixa/não inteiro e inInventory não booleano', () => {
    expect(validateWeaponFamilyConfig(familyWithTool({ ...validTool, level: 7 })).ok).toBe(false);
    expect(validateWeaponFamilyConfig(familyWithTool({ ...validTool, level: 1.5 })).ok).toBe(false);
    expect(
      validateWeaponFamilyConfig(familyWithTool({ ...validTool, inInventory: 'sim' })).ok,
    ).toBe(false);
  });
});
