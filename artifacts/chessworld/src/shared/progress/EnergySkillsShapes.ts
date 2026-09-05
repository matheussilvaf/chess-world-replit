/**
 * Energia do personagem + habilidades (skills) — formas compartilhadas entre
 * servidor e cliente (admin em /admin/skills-energy, HUD e runtime do jogo).
 *
 * A configuração é UM documento jsonb (`energy_skills_config`, mesmo padrão
 * de collection_world_config): custos de energia por ação, limiares de fome/
 * fraqueza/morte, energia por comida e XP por ação de cada habilidade.
 *
 * O progresso de cada jogador (energia atual, XP total por skill e contadores
 * de golpes) fica em `player_progress` e é servido pelo progressService.
 */
import { RESOURCE_KEYS } from '../collection/CollectionShapes.js';
import { classifyCraftEntityId } from '../craft/CraftShapes.js';
import { STATION_IDS, type StationId } from '../craft/StationShapes.js';

export const ENERGY_SKILLS_CONFIG_ID = 'default';

// ------------------------------------------------------------------ energia

/** Ferramentas cujo golpe (que conecta) custa energia a cada N golpes. */
export const ENERGY_TOOL_KINDS = ['pickaxe', 'axe', 'machete', 'scissors'] as const;
export type EnergyToolKind = (typeof ENERGY_TOOL_KINDS)[number];
export const ENERGY_TOOL_LABELS: Record<EnergyToolKind, string> = {
  pickaxe: 'Picareta',
  axe: 'Machado',
  machete: 'Facão',
  scissors: 'Tesoura',
};

/** `amount` de energia a cada `every` golpes. */
export interface StrikeEnergyCost {
  amount: number;
  every: number;
}

export const ENERGY_THRESHOLD_ACTIONS = ['hungry', 'weak', 'die'] as const;
export type EnergyThresholdAction = (typeof ENERGY_THRESHOLD_ACTIONS)[number];
export const ENERGY_THRESHOLD_LABELS: Record<EnergyThresholdAction, string> = {
  hungry: 'Mostrar fome',
  weak: 'Ficar fraco',
  die: 'Morrer',
};

/** "Quando a energia atingir X% → ação" (dispara enquanto energia ≤ X%). */
export interface EnergyThreshold {
  percent: number;
  action: EnergyThresholdAction;
}

export interface EnergyConfig {
  /** Energia máxima global (todos os personagens). */
  maxEnergy: number;
  /** HP máximo global (todos os personagens). */
  maxHp: number;
  toolStrike: Record<EnergyToolKind, StrikeEnergyCost>;
  /** Golpe de arma/mão que acerta criatura ou animal. */
  creatureStrike: StrikeEnergyCost;
  /** Por golpe recebido de qualquer criatura (personagem ou monstro). */
  damageTaken: number;
  /** Por craft executado em cada estação (pública ou portátil da mesma família). */
  craftByStation: Record<StationId, number>;
  /** Craft de peça do tabuleiro central (ainda sem gancho no jogo — só o campo). */
  boardPieceCraft: number;
  /** Ao criar qualquer item de estação portátil (construir estação privada). */
  buildStation: number;
  thresholds: EnergyThreshold[];
  /** Velocidade de andar quando fraco (% da normal). */
  weakSpeedPercent: number;
  /** itemId (badge `edible` — comestível) → energia por unidade comida. */
  foods: Record<string, number>;
}

// ------------------------------------------------------------------- skills

export const SKILL_IDS = [
  'mining',
  'fighting',
  'woodcutting',
  'hunting',
  'forging',
  'smelting',
  'cooking',
  'alchemy',
  'trading',
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

/** Nomes padrão; o admin pode renomear cada habilidade em `skills.names`. */
export const SKILL_LABELS: Record<SkillId, string> = {
  mining: 'Mineração',
  fighting: 'Combate',
  woodcutting: 'Lenhador',
  hunting: 'Caça',
  forging: 'Forja',
  smelting: 'Fundição',
  cooking: 'Culinária',
  alchemy: 'Alquimia',
  trading: 'Comércio',
};

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && (SKILL_IDS as readonly string[]).includes(v);
}

export const SKILL_NAME_MAX_LEN = 24;

/** Nome exibido da habilidade (o salvo pelo admin, senão o padrão). */
export function skillName(skills: Pick<SkillsConfig, 'names'>, id: SkillId): string {
  return skills.names[id]?.trim() || SKILL_LABELS[id];
}

export interface FightingXp {
  pvpWin: number;
  pvpLoss: number;
  pveWin: number;
  pveLoss: number;
}

export interface CookingXp {
  /**
   * itemId (pelo menos a badge `food`: ingrediente ou prato) → XP por unidade
   * obtida — ao cozinhar (craft × quantidade) ou ao coletar do chão (ex.:
   * carne crua que cai de um animal).
   */
  items: Record<string, number>;
  /** XP a cada vez que come. */
  eat: number;
}

export interface SkillsConfig {
  /** Nome exibido de cada habilidade (o admin renomeia clicando no nome). */
  names: Record<SkillId, string>;
  /** XP para sair do nível 1 (Base da fórmula). */
  baseXp: number;
  /** Taxa da fórmula: XP_Necessário = Base * (Taxa ^ (Nível − 1)). */
  rate: number;
  maxLevel: number;
  /** chave `mineral:*` → XP por nó quebrado. */
  mining: Record<string, number>;
  /** chave `tree:*` → XP por árvore derrubada. */
  woodcutting: Record<string, number>;
  fighting: FightingXp;
  /** itemId (badge `forging`) → XP por craft. */
  forging: Record<string, number>;
  /** itemId (badge `smelting`) → XP por craft. */
  smelting: Record<string, number>;
  cooking: CookingXp;
}

export interface EnergySkillsConfig {
  configId: string;
  energy: EnergyConfig;
  skills: SkillsConfig;
}

// ----------------------------------------------------------------- defaults

export const MINING_RESOURCE_KEYS: readonly string[] = RESOURCE_KEYS.filter((k) => k.startsWith('mineral:'));
export const WOODCUTTING_RESOURCE_KEYS: readonly string[] = RESOURCE_KEYS.filter((k) => k.startsWith('tree:'));

/** XP usado quando um item/recurso ainda não tem valor próprio salvo. */
export const DEFAULT_NODE_XP = 5;
export const DEFAULT_CRAFT_XP = 10;
/** Item de culinária (badge `food`) por unidade obtida — cozinhada ou coletada. */
export const DEFAULT_COOKING_XP = 5;

export const DEFAULT_ENERGY_SKILLS_CONFIG: EnergySkillsConfig = {
  configId: ENERGY_SKILLS_CONFIG_ID,
  energy: {
    maxEnergy: 250,
    maxHp: 100,
    toolStrike: {
      pickaxe: { amount: 1, every: 5 },
      axe: { amount: 1, every: 5 },
      machete: { amount: 1, every: 5 },
      scissors: { amount: 1, every: 8 },
    },
    creatureStrike: { amount: 1, every: 3 },
    damageTaken: 2,
    craftByStation: { forja: 5, 'mesa-de-crafting': 2, fornalha: 3, 'estacao-de-pocoes': 3 },
    boardPieceCraft: 10,
    buildStation: 10,
    thresholds: [
      { percent: 40, action: 'hungry' },
      { percent: 15, action: 'weak' },
      { percent: 0, action: 'die' },
    ],
    weakSpeedPercent: 50,
    foods: {},
  },
  skills: {
    names: { ...SKILL_LABELS },
    baseXp: 100,
    rate: 1.5,
    maxLevel: 99,
    mining: Object.fromEntries(MINING_RESOURCE_KEYS.map((k) => [k, DEFAULT_NODE_XP])),
    woodcutting: Object.fromEntries(WOODCUTTING_RESOURCE_KEYS.map((k) => [k, DEFAULT_NODE_XP])),
    fighting: { pvpWin: 50, pvpLoss: 10, pveWin: 20, pveLoss: 5 },
    forging: {},
    smelting: {},
    cooking: { items: {}, eat: 2 },
  },
};

export const ENERGY_RANGE = { min: 1, max: 100_000 } as const;
export const ENERGY_COST_RANGE = { min: 0, max: 10_000 } as const;
/** Energia por unidade de comida (0 = ainda não configurada, não dá para comer). */
export const FOOD_ENERGY_RANGE = { min: 0, max: ENERGY_RANGE.max } as const;
export const STRIKE_EVERY_RANGE = { min: 1, max: 1_000 } as const;
export const WEAK_SPEED_RANGE = { min: 5, max: 100 } as const;
export const MAX_ENERGY_THRESHOLDS = 12;
export const XP_VALUE_RANGE = { min: 0, max: 1_000_000 } as const;
export const BASE_XP_RANGE = { min: 1, max: 1_000_000_000 } as const;
export const XP_RATE_RANGE = { min: 1, max: 100 } as const;
export const MAX_LEVEL_RANGE = { min: 2, max: 999 } as const;

// --------------------------------------------------------------- validação

export type EnergySkillsParseResult =
  | { ok: true; config: EnergySkillsConfig }
  | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function intIn(v: unknown, range: { min: number; max: number }): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= range.min && n <= range.max ? n : null;
}

function numberIn(v: unknown, range: { min: number; max: number }): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v >= range.min && v <= range.max ? v : null;
}

/**
 * Valida E normaliza (cópia só com campos conhecidos, números arredondados).
 * Mapas por item aceitam qualquer id da página de receitas; chaves
 * desconhecidas são erro, para o admin enxergar dados velhos.
 */
export function parseEnergySkillsConfig(input: unknown): EnergySkillsParseResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['config: objeto obrigatório'] };
  const energyIn = isRecord(input.energy) ? input.energy : {};
  const skillsIn = isRecord(input.skills) ? input.skills : {};
  const d = DEFAULT_ENERGY_SKILLS_CONFIG;

  const readInt = (v: unknown, range: { min: number; max: number }, path: string, fallback: number): number => {
    if (v === undefined) return fallback;
    const n = intIn(v, range);
    if (n === null) errors.push(`${path}: inteiro ${range.min}..${range.max}`);
    return n ?? fallback;
  };
  const readStrike = (v: unknown, path: string, fallback: StrikeEnergyCost): StrikeEnergyCost => {
    if (v === undefined) return { ...fallback };
    if (!isRecord(v)) {
      errors.push(`${path}: { amount, every }`);
      return { ...fallback };
    }
    return {
      amount: readInt(v.amount, ENERGY_COST_RANGE, `${path}.amount`, fallback.amount),
      every: readInt(v.every, STRIKE_EVERY_RANGE, `${path}.every`, fallback.every),
    };
  };
  const readItemMap = (
    v: unknown,
    path: string,
    range: { min: number; max: number },
    allowKey: (key: string) => boolean,
    fallback: Record<string, number> = {},
  ): Record<string, number> => {
    if (v === undefined) return { ...fallback };
    if (!isRecord(v)) {
      errors.push(`${path}: mapa id → número`);
      return {};
    }
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(v)) {
      if (!allowKey(key)) {
        errors.push(`${path}: chave desconhecida "${key}"`);
        continue;
      }
      const n = intIn(raw, range);
      if (n === null) {
        errors.push(`${path}.${key}: inteiro ${range.min}..${range.max}`);
        continue;
      }
      out[key] = n;
    }
    return out;
  };
  const isItemId = (key: string) => classifyCraftEntityId(key) !== null;

  const toolStrike = {} as Record<EnergyToolKind, StrikeEnergyCost>;
  const toolIn = isRecord(energyIn.toolStrike) ? energyIn.toolStrike : {};
  for (const kind of ENERGY_TOOL_KINDS) toolStrike[kind] = readStrike(toolIn[kind], `energy.toolStrike.${kind}`, d.energy.toolStrike[kind]);
  const craftByStation = {} as Record<StationId, number>;
  const craftIn = isRecord(energyIn.craftByStation) ? energyIn.craftByStation : {};
  for (const id of STATION_IDS) craftByStation[id] = readInt(craftIn[id], ENERGY_COST_RANGE, `energy.craftByStation.${id}`, d.energy.craftByStation[id]);

  const thresholds: EnergyThreshold[] = [];
  if (energyIn.thresholds === undefined) {
    thresholds.push(...d.energy.thresholds.map((t) => ({ ...t })));
  } else if (!Array.isArray(energyIn.thresholds) || energyIn.thresholds.length > MAX_ENERGY_THRESHOLDS) {
    errors.push(`energy.thresholds: lista com até ${MAX_ENERGY_THRESHOLDS} condições`);
  } else {
    energyIn.thresholds.forEach((t, i) => {
      const percent = isRecord(t) ? numberIn(t.percent, { min: 0, max: 100 }) : null;
      const action = isRecord(t) && (ENERGY_THRESHOLD_ACTIONS as readonly string[]).includes(String(t.action)) ? (t.action as EnergyThresholdAction) : null;
      if (percent === null || action === null) {
        errors.push(`energy.thresholds[${i}]: { percent 0..100, action hungry|weak|die }`);
        return;
      }
      thresholds.push({ percent: Math.round(percent * 10) / 10, action });
    });
  }

  const energy: EnergyConfig = {
    maxEnergy: readInt(energyIn.maxEnergy, ENERGY_RANGE, 'energy.maxEnergy', d.energy.maxEnergy),
    maxHp: readInt(energyIn.maxHp, ENERGY_RANGE, 'energy.maxHp', d.energy.maxHp),
    toolStrike,
    creatureStrike: readStrike(energyIn.creatureStrike, 'energy.creatureStrike', d.energy.creatureStrike),
    damageTaken: readInt(energyIn.damageTaken, ENERGY_COST_RANGE, 'energy.damageTaken', d.energy.damageTaken),
    craftByStation,
    boardPieceCraft: readInt(energyIn.boardPieceCraft, ENERGY_COST_RANGE, 'energy.boardPieceCraft', d.energy.boardPieceCraft),
    buildStation: readInt(energyIn.buildStation, ENERGY_COST_RANGE, 'energy.buildStation', d.energy.buildStation),
    thresholds,
    weakSpeedPercent: readInt(energyIn.weakSpeedPercent, WEAK_SPEED_RANGE, 'energy.weakSpeedPercent', d.energy.weakSpeedPercent),
    foods: readItemMap(energyIn.foods, 'energy.foods', FOOD_ENERGY_RANGE, isItemId),
  };

  const fightingIn = isRecord(skillsIn.fighting) ? skillsIn.fighting : {};
  const cookingIn = isRecord(skillsIn.cooking) ? skillsIn.cooking : {};
  let rate = d.skills.rate;
  if (skillsIn.rate !== undefined) {
    const n = numberIn(skillsIn.rate, XP_RATE_RANGE);
    if (n === null) errors.push(`skills.rate: número ${XP_RATE_RANGE.min}..${XP_RATE_RANGE.max}`);
    else rate = Math.round(n * 1000) / 1000;
  }
  const names = {} as Record<SkillId, string>;
  const namesIn = isRecord(skillsIn.names) ? skillsIn.names : {};
  for (const id of SKILL_IDS) {
    const raw = namesIn[id];
    if (raw === undefined) {
      names[id] = SKILL_LABELS[id];
      continue;
    }
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (name.length === 0 || name.length > SKILL_NAME_MAX_LEN) {
      errors.push(`skills.names.${id}: texto de 1 a ${SKILL_NAME_MAX_LEN} caracteres`);
      names[id] = SKILL_LABELS[id];
      continue;
    }
    names[id] = name;
  }
  // Documentos antigos tinham `cooking.craft` (aba da fornalha) e `cooking.pickup`
  // (coleta) separados — hoje é UM valor por item com a badge `food`. Na
  // migração, `craft` prevalece sobre `pickup`; campo legado malformado é erro
  // (não se descarta regra salva em silêncio).
  let cookingItemsIn: unknown = cookingIn.items;
  if (cookingItemsIn === undefined && (cookingIn.craft !== undefined || cookingIn.pickup !== undefined)) {
    const merged: Record<string, unknown> = {};
    for (const field of ['pickup', 'craft'] as const) {
      const legacy = cookingIn[field];
      if (legacy === undefined) continue;
      if (!isRecord(legacy)) {
        errors.push(`skills.cooking.${field}: esperado um objeto {itemId: XP}`);
        continue;
      }
      Object.assign(merged, legacy);
    }
    cookingItemsIn = merged;
  }
  const skills: SkillsConfig = {
    names,
    baseXp: readInt(skillsIn.baseXp, BASE_XP_RANGE, 'skills.baseXp', d.skills.baseXp),
    rate,
    maxLevel: readInt(skillsIn.maxLevel, MAX_LEVEL_RANGE, 'skills.maxLevel', d.skills.maxLevel),
    mining: readItemMap(skillsIn.mining, 'skills.mining', XP_VALUE_RANGE, (k) => MINING_RESOURCE_KEYS.includes(k), d.skills.mining),
    woodcutting: readItemMap(skillsIn.woodcutting, 'skills.woodcutting', XP_VALUE_RANGE, (k) => WOODCUTTING_RESOURCE_KEYS.includes(k), d.skills.woodcutting),
    fighting: {
      pvpWin: readInt(fightingIn.pvpWin, XP_VALUE_RANGE, 'skills.fighting.pvpWin', d.skills.fighting.pvpWin),
      pvpLoss: readInt(fightingIn.pvpLoss, XP_VALUE_RANGE, 'skills.fighting.pvpLoss', d.skills.fighting.pvpLoss),
      pveWin: readInt(fightingIn.pveWin, XP_VALUE_RANGE, 'skills.fighting.pveWin', d.skills.fighting.pveWin),
      pveLoss: readInt(fightingIn.pveLoss, XP_VALUE_RANGE, 'skills.fighting.pveLoss', d.skills.fighting.pveLoss),
    },
    forging: readItemMap(skillsIn.forging, 'skills.forging', XP_VALUE_RANGE, isItemId),
    smelting: readItemMap(skillsIn.smelting, 'skills.smelting', XP_VALUE_RANGE, isItemId),
    cooking: {
      items: readItemMap(cookingItemsIn, 'skills.cooking.items', XP_VALUE_RANGE, isItemId),
      eat: readInt(cookingIn.eat, XP_VALUE_RANGE, 'skills.cooking.eat', d.skills.cooking.eat),
    },
  };

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { configId: ENERGY_SKILLS_CONFIG_ID, energy, skills } };
}

// ------------------------------------------------------------ energia atual

export interface EnergyStateView {
  percent: number;
  hungry: boolean;
  weak: boolean;
  dead: boolean;
}

export function energyPercent(energy: number, maxEnergy: number): number {
  if (maxEnergy <= 0) return 0;
  return Math.max(0, Math.min(100, (energy / maxEnergy) * 100));
}

/** Uma condição vale enquanto a energia estiver EM ou ABAIXO do seu percentual. */
export function evaluateEnergyState(config: EnergyConfig, energy: number): EnergyStateView {
  const percent = energyPercent(energy, config.maxEnergy);
  const active = (action: EnergyThresholdAction) =>
    config.thresholds.some((t) => t.action === action && percent <= t.percent);
  return { percent, hungry: active('hungry'), weak: active('weak'), dead: active('die') };
}

// ------------------------------------------------------------------ níveis

/** XP necessário para sair de `level` (XP_Necessário = Base * Taxa^(Nível−1)). */
export function xpToNextLevel(skills: Pick<SkillsConfig, 'baseXp' | 'rate'>, level: number): number {
  return Math.max(1, Math.round(skills.baseXp * Math.pow(skills.rate, Math.max(1, level) - 1)));
}

export interface SkillProgress {
  /** XP total acumulado na habilidade. */
  xp: number;
  level: number;
  /** XP já ganho dentro do nível atual. */
  intoLevel: number;
  /** XP necessário para o próximo nível (0 no nível máximo). */
  needed: number;
}

/** Nível derivado do XP total (todos começam no 1). */
export function skillProgressFromXp(skills: Pick<SkillsConfig, 'baseXp' | 'rate' | 'maxLevel'>, totalXp: number): SkillProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let remaining = xp;
  while (level < skills.maxLevel) {
    const needed = xpToNextLevel(skills, level);
    if (remaining < needed) return { xp, level, intoLevel: remaining, needed };
    remaining -= needed;
    level += 1;
  }
  return { xp, level, intoLevel: 0, needed: 0 };
}

// ------------------------------------------------------- eventos do cliente

/** Eventos que só o cliente enxerga (golpes/nós no mapa de coleta), enviados em lote. */
export const ACTIVITY_KINDS = ['tool_strike', 'creature_strike', 'node_broken'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  kind: ActivityKind;
  /** tool_strike: tipo da ferramenta; creature_strike: chave do animal; node_broken: chave do recurso. */
  key: string;
  count: number;
}

export const ACTIVITY_MAX_ENTRIES = 40;
export const ACTIVITY_MAX_COUNT = 999;

export function parseActivityEvents(input: unknown): { ok: true; events: ActivityEvent[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > ACTIVITY_MAX_ENTRIES) {
    return { ok: false, error: `events: lista de 1 a ${ACTIVITY_MAX_ENTRIES} entradas` };
  }
  const events: ActivityEvent[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) return { ok: false, error: 'events: cada entrada é um objeto' };
    const kind = String(raw.kind);
    const key = String(raw.key ?? '');
    const count = Number(raw.count);
    if (!(ACTIVITY_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `kind desconhecido: ${kind}` };
    if (!Number.isInteger(count) || count < 1 || count > ACTIVITY_MAX_COUNT) return { ok: false, error: `count inválido (inteiro 1..${ACTIVITY_MAX_COUNT})` };
    const valid =
      kind === 'tool_strike'
        ? (ENERGY_TOOL_KINDS as readonly string[]).includes(key)
        : kind === 'creature_strike'
          ? /^[a-z0-9:_-]{1,40}$/.test(key)
          : RESOURCE_KEYS.includes(key);
    if (!valid) return { ok: false, error: `key inválida para ${kind}: ${key}` };
    events.push({ kind: kind as ActivityKind, key, count });
  }
  return { ok: true, events };
}

// ------------------------------------------------------- snapshot p/ cliente

export interface ProgressSnapshot {
  /**
   * Número crescente por jogador (cresce a cada snapshot novo). O MESMO
   * snapshot chega ao cliente por dois caminhos — resposta HTTP do lote de
   * atividade e `progress_update` da sala — e re-tentativas idempotentes o
   * repetem; o cliente ignora o que não for mais novo que o último aplicado
   * (senão o "+5 XP" aparece em dobro e um atrasado regride a tela).
   */
  seq: number;
  energy: number;
  maxEnergy: number;
  maxHp: number;
  weakSpeedPercent: number;
  state: EnergyStateView;
  skills: Record<SkillId, SkillProgress>;
  /** XP ganho nesta atualização (para o ticker do HUD). */
  gains: Array<{ skill: SkillId; xp: number }>;
  /** false = tabela player_progress ausente (progresso só em memória). */
  persisted: boolean;
}
