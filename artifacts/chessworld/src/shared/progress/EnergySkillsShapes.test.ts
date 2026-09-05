import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENERGY_SKILLS_CONFIG,
  ENERGY_TOOL_KINDS,
  MINING_RESOURCE_KEYS,
  SKILL_IDS,
  WOODCUTTING_RESOURCE_KEYS,
  SKILL_LABELS,
  SKILL_NAME_MAX_LEN,
  evaluateEnergyState,
  parseActivityEvents,
  parseEnergySkillsConfig,
  skillName,
  skillProgressFromXp,
  xpToNextLevel,
} from './EnergySkillsShapes';

describe('defaults', () => {
  it('os defaults passam pela própria validação sem mudar', () => {
    const parsed = parseEnergySkillsConfig(DEFAULT_ENERGY_SKILLS_CONFIG);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config).toEqual(DEFAULT_ENERGY_SKILLS_CONFIG);
  });

  it('todo mineral e árvore têm XP padrão e as 9 skills existem', () => {
    expect(MINING_RESOURCE_KEYS.length).toBeGreaterThan(0);
    expect(WOODCUTTING_RESOURCE_KEYS.length).toBeGreaterThan(0);
    for (const key of MINING_RESOURCE_KEYS) expect(DEFAULT_ENERGY_SKILLS_CONFIG.skills.mining[key]).toBeGreaterThan(0);
    for (const key of WOODCUTTING_RESOURCE_KEYS) expect(DEFAULT_ENERGY_SKILLS_CONFIG.skills.woodcutting[key]).toBeGreaterThan(0);
    expect(SKILL_IDS).toHaveLength(9);
    expect(DEFAULT_ENERGY_SKILLS_CONFIG.energy.maxEnergy).toBe(250);
  });
});

describe('parseEnergySkillsConfig', () => {
  it('objeto vazio vira os defaults (campos ausentes = default)', () => {
    const parsed = parseEnergySkillsConfig({});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config).toEqual(DEFAULT_ENERGY_SKILLS_CONFIG);
  });

  it('arredonda inteiros, aceita taxa decimal e descarta campos desconhecidos', () => {
    const parsed = parseEnergySkillsConfig({
      energy: { maxEnergy: 300.4, foods: { beef: 12 }, extra: 1 },
      skills: { rate: 1.25, forging: { 'gen:weapon/sword/iron': 15 } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.energy.maxEnergy).toBe(300);
    expect(parsed.config.energy.foods).toEqual({ beef: 12 });
    expect(parsed.config.skills.rate).toBe(1.25);
    expect(parsed.config.skills.forging).toEqual({ 'gen:weapon/sword/iron': 15 });
    expect((parsed.config.energy as unknown as Record<string, unknown>).extra).toBeUndefined();
  });

  it('acusa valores fora do range, ações desconhecidas e chaves de item inválidas', () => {
    const parsed = parseEnergySkillsConfig({
      energy: {
        maxEnergy: 0,
        toolStrike: { pickaxe: { amount: 1, every: 0 } },
        thresholds: [{ percent: 120, action: 'hungry' }, { percent: 10, action: 'explode' }],
        weakSpeedPercent: 1,
        foods: { '../x': 5 },
      },
      skills: { baseXp: 0, mining: { 'mineral:naoexiste': 5 } },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join('\n')).toMatch(/energy\.maxEnergy/);
    expect(parsed.errors.join('\n')).toMatch(/toolStrike\.pickaxe\.every/);
    expect(parsed.errors.join('\n')).toMatch(/thresholds\[0\]/);
    expect(parsed.errors.join('\n')).toMatch(/thresholds\[1\]/);
    expect(parsed.errors.join('\n')).toMatch(/weakSpeedPercent/);
    expect(parsed.errors.join('\n')).toMatch(/foods: chave desconhecida/);
    expect(parsed.errors.join('\n')).toMatch(/skills\.baseXp/);
    expect(parsed.errors.join('\n')).toMatch(/mining: chave desconhecida/);
  });

  it('rejeita entrada que não é objeto', () => {
    expect(parseEnergySkillsConfig(null).ok).toBe(false);
    expect(parseEnergySkillsConfig('x').ok).toBe(false);
  });

  it('nomes das habilidades: aparados, faltando = padrão, vazio/longo = erro', () => {
    const ok = parseEnergySkillsConfig({ skills: { names: { mining: '  Minerar   pedras ', cooking: 'Cozinha' } } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.config.skills.names.mining).toBe('Minerar pedras');
    expect(ok.config.skills.names.cooking).toBe('Cozinha');
    expect(ok.config.skills.names.forging).toBe(SKILL_LABELS.forging);
    expect(skillName(ok.config.skills, 'mining')).toBe('Minerar pedras');
    expect(skillName({ names: { ...SKILL_LABELS, trading: '   ' } }, 'trading')).toBe(SKILL_LABELS.trading);

    const bad = parseEnergySkillsConfig({ skills: { names: { mining: '', hunting: 'x'.repeat(SKILL_NAME_MAX_LEN + 1), trading: 5 } } });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join('\n')).toMatch(/skills\.names\.mining/);
    expect(bad.errors.join('\n')).toMatch(/skills\.names\.hunting/);
    expect(bad.errors.join('\n')).toMatch(/skills\.names\.trading/);
  });

  it('culinária: um XP por item; documento antigo (craft + pickup) é fundido', () => {
    const current = parseEnergySkillsConfig({ skills: { cooking: { items: { beef: 7 }, eat: 3 } } });
    expect(current.ok).toBe(true);
    if (current.ok) expect(current.config.skills.cooking).toEqual({ items: { beef: 7 }, eat: 3 });

    const legacy = parseEnergySkillsConfig({ skills: { cooking: { craft: { 'stew': 12, beef: 9 }, pickup: { beef: 1, egg: 2 } } } });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.config.skills.cooking.items).toEqual({ beef: 9, egg: 2, 'stew': 12 });

    const invalid = parseEnergySkillsConfig({ skills: { cooking: { items: { '../x': 1 } } } });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.join('\n')).toMatch(/skills\.cooking\.items: chave desconhecida/);

    // Campo legado malformado não é descartado em silêncio.
    const brokenLegacy = parseEnergySkillsConfig({ skills: { cooking: { craft: 7, pickup: { beef: 1 } } } });
    expect(brokenLegacy.ok).toBe(false);
    if (!brokenLegacy.ok) expect(brokenLegacy.errors.join('\n')).toMatch(/skills\.cooking\.craft: esperado um objeto/);
  });
});

describe('evaluateEnergyState', () => {
  const energy = DEFAULT_ENERGY_SKILLS_CONFIG.energy; // 40% fome, 15% fraco, 0% morre

  it('dispara cada condição quando a energia fica igual ou abaixo do limiar', () => {
    expect(evaluateEnergyState(energy, 250)).toMatchObject({ percent: 100, hungry: false, weak: false, dead: false });
    expect(evaluateEnergyState(energy, 100)).toMatchObject({ percent: 40, hungry: true, weak: false, dead: false });
    expect(evaluateEnergyState(energy, 37)).toMatchObject({ hungry: true, weak: true, dead: false });
    expect(evaluateEnergyState(energy, 0)).toMatchObject({ percent: 0, hungry: true, weak: true, dead: true });
  });

  it('sem condições nada dispara; max 0 não divide por zero', () => {
    expect(evaluateEnergyState({ ...energy, thresholds: [] }, 0)).toMatchObject({ hungry: false, weak: false, dead: false });
    expect(evaluateEnergyState({ ...energy, maxEnergy: 0 }, 10).percent).toBe(0);
  });
});

describe('níveis', () => {
  const skills = { baseXp: 100, rate: 1.5, maxLevel: 5 };

  it('fórmula Base × Taxa^(nível−1), arredondada', () => {
    expect(xpToNextLevel(skills, 1)).toBe(100);
    expect(xpToNextLevel(skills, 2)).toBe(150);
    expect(xpToNextLevel(skills, 3)).toBe(225);
    expect(xpToNextLevel(skills, 4)).toBe(338);
  });

  it('nível derivado do XP total, começando no 1 e travando no máximo', () => {
    expect(skillProgressFromXp(skills, 0)).toEqual({ xp: 0, level: 1, intoLevel: 0, needed: 100 });
    expect(skillProgressFromXp(skills, 99)).toMatchObject({ level: 1, intoLevel: 99 });
    expect(skillProgressFromXp(skills, 100)).toMatchObject({ level: 2, intoLevel: 0, needed: 150 });
    expect(skillProgressFromXp(skills, 260)).toMatchObject({ level: 3, intoLevel: 10, needed: 225 });
    expect(skillProgressFromXp(skills, 1_000_000)).toEqual({ xp: 1_000_000, level: 5, intoLevel: 0, needed: 0 });
    expect(skillProgressFromXp(skills, -5).xp).toBe(0);
  });
});

describe('parseActivityEvents', () => {
  it('aceita golpes de ferramenta, golpes em animal e nós quebrados', () => {
    const parsed = parseActivityEvents([
      { kind: 'tool_strike', key: ENERGY_TOOL_KINDS[0], count: 3 },
      { kind: 'creature_strike', key: 'animal:sheep', count: 1 },
      { kind: 'node_broken', key: MINING_RESOURCE_KEYS[0], count: 2 },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.events).toHaveLength(3);
  });

  it('rejeita lista vazia, kind desconhecido, chave inválida e count fora do range', () => {
    expect(parseActivityEvents([]).ok).toBe(false);
    expect(parseActivityEvents([{ kind: 'jump', key: 'x', count: 1 }]).ok).toBe(false);
    expect(parseActivityEvents([{ kind: 'tool_strike', key: 'sword', count: 1 }]).ok).toBe(false);
    expect(parseActivityEvents([{ kind: 'node_broken', key: 'mineral:nada', count: 1 }]).ok).toBe(false);
    expect(parseActivityEvents([{ kind: 'tool_strike', key: 'axe', count: 0 }]).ok).toBe(false);
    expect(parseActivityEvents([{ kind: 'tool_strike', key: 'axe', count: 1.5 }]).ok).toBe(false);
  });
});
