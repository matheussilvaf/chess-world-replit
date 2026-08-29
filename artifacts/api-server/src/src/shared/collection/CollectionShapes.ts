/**
 * Config do Mundo de Coleta (spec: /admin — Mundo de Coleta).
 *
 * Documento único (configId "main") persistido em jsonb:
 *  - mineralCounts: quantos nós de cada minério entram no sorteio diário do mapa;
 *  - hurtboxes: caixa de acerto por TIPO de recurso, em px do frame fonte,
 *    ancorada no centro-base do sprite (origin 0.5,1 — o "pé").
 *
 * Cópia espelhada em artifacts/chessworld/src/shared/collection/ — manter idêntica.
 */

export const COLLECTION_CONFIG_ID = 'main';

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
  return { ok: errors.length === 0, errors };
}
