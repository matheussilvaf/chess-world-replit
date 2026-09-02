/**
 * Config do Mundo de Coleta (spec: /admin — Mundo de Coleta).
 *
 * Documento único (configId "main") persistido em jsonb:
 *  - mineralCounts: quantos nós de cada minério entram no sorteio diário do mapa;
 *  - hurtboxes: caixa de acerto por TIPO de recurso, em px do frame fonte,
 *    ancorada no centro-base do sprite (origin 0.5,1 — o "pé").
 *
 * Cópia espelhada em server/src/shared/collection/ — manter idêntica.
 */

export const COLLECTION_CONFIG_ID = 'main';

/**
 * Chaves canônicas de recurso do mapa (mesma formação usada pelo runtime e
 * pela página admin). Espelham os ids do craftingMapConfig do cliente —
 * ao adicionar um recurso novo lá, inclua a chave aqui.
 */
export const RESOURCE_KEYS: readonly string[] = [
  'mineral:pedra',
  'mineral:carvao',
  'mineral:ferro',
  'mineral:cobre',
  'mineral:ouro',
  'mineral:diamante',
  'mineral:cristal_real',
  'tree:pinheiro_peao',
  'tree:carvalho_torre',
  'tree:freixo_cavalo',
  'tree:ebano_dama',
  'tree:salgueiro_bispo',
  'herb:heal_herb',
  'herb:red_herb',
  'herb:blue_herb',
  'herb:queen_thorn',
  'herb:horse_root',
  'bush',
  'hand_stone',
  'animal:cow',
  'animal:sheep',
  'animal:chicken',
];

/** Itens que entram no inventário (tudo menos animais — morte ainda não definida). */
export const COLLECTIBLE_ITEM_KEYS: readonly string[] = RESOURCE_KEYS.filter(
  (k) => !k.startsWith('animal:'),
);

/** Opções do select "tempo de renascimento" (em segundos). */
export const RESPAWN_OPTIONS_SECONDS: readonly number[] = [
  30, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600,
  900, 1200, 1800, 2400, 3000, 21600, 43200, 86400,
];

export const DEFAULT_DROP_COUNT = 3;
export const DEFAULT_RESPAWN_SECONDS = 60;

/** HP padrão de um nó de recurso (poder padrão 10 → 3 golpes, como antes). */
export const DEFAULT_RESOURCE_HP = 30;
export const RESOURCE_HP_RANGE = { min: 1, max: 99999 } as const;

// ------------------------------------------------- ferramenta certa + nível
/** Ferramentas de coleta que um recurso pode exigir ('hand' = mão limpa). */
export const GATHER_TOOL_KINDS = ['pickaxe', 'axe', 'machete', 'scissors', 'hand'] as const;
export type GatherToolKind = (typeof GATHER_TOOL_KINDS)[number];

export function isGatherToolKind(v: unknown): v is GatherToolKind {
  return typeof v === 'string' && (GATHER_TOOL_KINDS as readonly string[]).includes(v);
}

/** Rótulos PT-BR para o admin. */
export const GATHER_TOOL_LABELS: Record<GatherToolKind, string> = {
  pickaxe: 'Picareta',
  axe: 'Machado',
  machete: 'Facão',
  scissors: 'Tesoura',
  hand: 'Mão (sem ferramenta)',
};

/** Nível mínimo que a ferramenta precisa ter para EXTRAIR o recurso (0 = qualquer). */
export const RESOURCE_MIN_LEVEL_RANGE = { min: 0, max: 6 } as const;

/**
 * Ferramenta padrão por tipo de recurso, quando o admin ainda não escolheu:
 * árvore→machado, minério→picareta, arbusto→facão, erva/pedra de mão→mão.
 */
export function defaultGatherToolFor(resourceKey: string): GatherToolKind {
  if (resourceKey.startsWith('tree:')) return 'axe';
  if (resourceKey.startsWith('mineral:')) return 'pickaxe';
  if (resourceKey.startsWith('herb:')) return 'hand';
  if (resourceKey === 'bush') return 'machete';
  if (resourceKey === 'hand_stone') return 'hand';
  return 'hand'; // animais/desconhecidos — irrelevante (animais não quebram)
}

/**
 * Piso de HP quando a ferramenta é a CERTA mas o nível é menor que o mínimo:
 * os golpes descem o HP até aqui e TRAVAM (o recurso nunca quebra).
 * Percentual do HP máximo para valer com qualquer HP configurado no admin.
 */
export const GATHER_LOCK_HP_RATIO = 0.2;
export function lockedHpFloorFor(maxHp: number): number {
  return Math.max(1, Math.round(maxHp * GATHER_LOCK_HP_RATIO));
}

/** Animais que fogem ao apanhar (galinha nunca foge). */
export const FLEEING_ANIMAL_KEYS: readonly string[] = ['animal:cow', 'animal:sheep'];

/** Fuga: raio padrão (px a partir do ponto do 1º golpe) e faixas dos overrides do admin. */
export const DEFAULT_FLEE_RADIUS = 240;
export const FLEE_RADIUS_RANGE = { min: 40, max: 1200 } as const;
/** Velocidade de fuga em px/s (sem override: 2.2× a velocidade de passeio do bicho). */
export const FLEE_SPEED_RANGE = { min: 10, max: 400 } as const;

export interface ResourceHurtbox {
  /** Deslocamento horizontal a partir do centro do pé do sprite (px; + = direita). */
  offsetX: number;
  /** Deslocamento vertical a partir do pé do sprite (px; + = para cima). */
  offsetY: number;
  width: number;
  height: number;
}

export interface CollectionWorldConfig {
  configId: typeof COLLECTION_CONFIG_ID;
  /** mineralId → quantidade no mapa (0 = não aparece). */
  mineralCounts: Record<string, number>;
  /** resourceKey → hurtbox. Chaves: mineral:<id>, tree:<tipo>, herb:<id>, bush, hand_stone, animal:<id>. */
  hurtboxes: Record<string, ResourceHurtbox>;
  /** resourceKey → itens dropados ao quebrar (padrão 3). Opcional p/ configs antigas. */
  dropCounts?: Record<string, number>;
  /** resourceKey → segundos até renascer (padrão 60). Opcional p/ configs antigas. */
  respawnSeconds?: Record<string, number>;
  /** animal:<id> → raio de fuga em px (padrão DEFAULT_FLEE_RADIUS). */
  fleeRadius?: Record<string, number>;
  /** animal:<id> → velocidade de fuga em px/s (padrão: 2.2× o passeio do bicho). */
  fleeSpeed?: Record<string, number>;
  /** resourceKey → HP total do nó (padrão 30). Animais não usam (não morrem). */
  resourceHp?: Record<string, number>;
  /** resourceKey → nível mínimo da ferramenta (0..6; ausente = 0). */
  resourceMinLevel?: Record<string, number>;
  /** resourceKey → ferramenta que extrai o recurso (ausente = padrão por tipo). */
  resourceTool?: Record<string, GatherToolKind>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const KEY_RE = /^[a-z0-9_:-]{1,64}$/;

export function validateResourceHurtbox(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: esperado objeto {offsetX, offsetY, width, height}`);
    return;
  }
  for (const field of ['offsetX', 'offsetY', 'width', 'height'] as const) {
    const n = value[field];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      errors.push(`${path}.${field}: número finito obrigatório`);
    } else if (Math.abs(n) > 4000) {
      errors.push(`${path}.${field}: fora do limite (±4000px)`);
    }
  }
  if (typeof value.width === 'number' && value.width <= 0) errors.push(`${path}.width: deve ser > 0`);
  if (typeof value.height === 'number' && value.height <= 0) errors.push(`${path}.height: deve ser > 0`);
}

export function validateCollectionWorldConfig(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config deve ser um objeto'] };
  if (value.configId !== COLLECTION_CONFIG_ID) errors.push(`configId deve ser "${COLLECTION_CONFIG_ID}"`);
  if (!isRecord(value.mineralCounts)) {
    errors.push('mineralCounts deve ser um objeto {mineralId: quantidade}');
  } else {
    for (const [k, v] of Object.entries(value.mineralCounts)) {
      if (!KEY_RE.test(k)) errors.push(`mineralCounts["${k}"]: id inválido`);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 999) {
        errors.push(`mineralCounts["${k}"]: inteiro entre 0 e 999`);
      }
    }
  }
  if (!isRecord(value.hurtboxes)) {
    errors.push('hurtboxes deve ser um objeto {resourceKey: hurtbox}');
  } else {
    for (const [k, v] of Object.entries(value.hurtboxes)) {
      if (!KEY_RE.test(k)) errors.push(`hurtboxes["${k}"]: chave inválida (slug minúsculo)`);
      validateResourceHurtbox(v, `hurtboxes["${k}"]`, errors);
    }
  }
  // Campos novos — opcionais (configs salvas antes deles continuam válidas).
  if (value.dropCounts !== undefined) {
    if (!isRecord(value.dropCounts)) {
      errors.push('dropCounts deve ser um objeto {resourceKey: quantidade}');
    } else {
      for (const [k, v] of Object.entries(value.dropCounts)) {
        if (!KEY_RE.test(k)) errors.push(`dropCounts["${k}"]: chave inválida`);
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 20) {
          errors.push(`dropCounts["${k}"]: inteiro entre 0 e 20`);
        }
      }
    }
  }
  if (value.respawnSeconds !== undefined) {
    if (!isRecord(value.respawnSeconds)) {
      errors.push('respawnSeconds deve ser um objeto {resourceKey: segundos}');
    } else {
      for (const [k, v] of Object.entries(value.respawnSeconds)) {
        if (!KEY_RE.test(k)) errors.push(`respawnSeconds["${k}"]: chave inválida`);
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 10 || v > 86400) {
          errors.push(`respawnSeconds["${k}"]: inteiro entre 10 e 86400 segundos`);
        }
      }
    }
  }
  if (value.fleeRadius !== undefined) {
    if (!isRecord(value.fleeRadius)) {
      errors.push('fleeRadius deve ser um objeto {animalKey: px}');
    } else {
      for (const [k, v] of Object.entries(value.fleeRadius)) {
        if (!KEY_RE.test(k)) errors.push(`fleeRadius["${k}"]: chave inválida`);
        if (
          typeof v !== 'number' || !Number.isInteger(v) ||
          v < FLEE_RADIUS_RANGE.min || v > FLEE_RADIUS_RANGE.max
        ) {
          errors.push(`fleeRadius["${k}"]: inteiro entre ${FLEE_RADIUS_RANGE.min} e ${FLEE_RADIUS_RANGE.max} px`);
        }
      }
    }
  }
  if (value.fleeSpeed !== undefined) {
    if (!isRecord(value.fleeSpeed)) {
      errors.push('fleeSpeed deve ser um objeto {animalKey: px/s}');
    } else {
      for (const [k, v] of Object.entries(value.fleeSpeed)) {
        if (!KEY_RE.test(k)) errors.push(`fleeSpeed["${k}"]: chave inválida`);
        if (
          typeof v !== 'number' || !Number.isInteger(v) ||
          v < FLEE_SPEED_RANGE.min || v > FLEE_SPEED_RANGE.max
        ) {
          errors.push(`fleeSpeed["${k}"]: inteiro entre ${FLEE_SPEED_RANGE.min} e ${FLEE_SPEED_RANGE.max} px/s`);
        }
      }
    }
  }
  if (value.resourceHp !== undefined) {
    if (!isRecord(value.resourceHp)) {
      errors.push('resourceHp deve ser um objeto {resourceKey: hp}');
    } else {
      for (const [k, v] of Object.entries(value.resourceHp)) {
        if (!KEY_RE.test(k)) errors.push(`resourceHp["${k}"]: chave inválida`);
        if (
          typeof v !== 'number' || !Number.isInteger(v) ||
          v < RESOURCE_HP_RANGE.min || v > RESOURCE_HP_RANGE.max
        ) {
          errors.push(`resourceHp["${k}"]: inteiro entre ${RESOURCE_HP_RANGE.min} e ${RESOURCE_HP_RANGE.max}`);
        }
      }
    }
  }
  if (value.resourceMinLevel !== undefined) {
    if (!isRecord(value.resourceMinLevel)) {
      errors.push('resourceMinLevel deve ser um objeto {resourceKey: nível}');
    } else {
      for (const [k, v] of Object.entries(value.resourceMinLevel)) {
        if (!KEY_RE.test(k)) errors.push(`resourceMinLevel["${k}"]: chave inválida`);
        if (
          typeof v !== 'number' || !Number.isInteger(v) ||
          v < RESOURCE_MIN_LEVEL_RANGE.min || v > RESOURCE_MIN_LEVEL_RANGE.max
        ) {
          errors.push(`resourceMinLevel["${k}"]: inteiro entre ${RESOURCE_MIN_LEVEL_RANGE.min} e ${RESOURCE_MIN_LEVEL_RANGE.max}`);
        }
      }
    }
  }
  if (value.resourceTool !== undefined) {
    if (!isRecord(value.resourceTool)) {
      errors.push('resourceTool deve ser um objeto {resourceKey: ferramenta}');
    } else {
      for (const [k, v] of Object.entries(value.resourceTool)) {
        if (!KEY_RE.test(k)) errors.push(`resourceTool["${k}"]: chave inválida`);
        if (!isGatherToolKind(v)) {
          errors.push(`resourceTool["${k}"]: ferramenta inválida (use ${GATHER_TOOL_KINDS.join(', ')})`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
