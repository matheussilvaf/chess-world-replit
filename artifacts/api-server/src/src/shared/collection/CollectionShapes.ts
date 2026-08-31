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
  return { ok: errors.length === 0, errors };
}
