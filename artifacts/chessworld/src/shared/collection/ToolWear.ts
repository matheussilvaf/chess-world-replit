/**
 * Desgaste de ferramentas (durabilidade) — regra pura compartilhada entre o
 * servidor (autoritativo) e o cliente (previsão otimista da barra).
 *
 * A durabilidade pertence à PILHA (usuário × itemKey): `remaining` é quanto
 * resta da cópia em uso; null = cheia (coluna vazia / cópia nova). Cada golpe
 * que conecta com uma ferramenta de coleta gasta 1 ponto. Ao chegar a 0 a
 * cópia quebra (qty − 1) e a próxima começa cheia — golpes excedentes de um
 * lote passam para ela. Sem cópias, nada a gastar.
 *
 * Mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/collection/ToolWear.ts   (client)
 *   - server/src/shared/collection/ToolWear.ts                 (Colyseus server)
 *   - artifacts/api-server/src/src/shared/collection/ToolWear.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 */

/** Prefixo das refs de ferramenta de coleta (as únicas que se desgastam). */
export const TOOL_ITEM_PREFIX = 'gen:crafttools/';

export function isToolItemKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(TOOL_ITEM_PREFIX);
}

/** Limites do lote POST /api/collection/tool-wear (mesmo espírito do /collect). */
export const TOOL_WEAR_MAX_HITS_PER_ENTRY = 999;
export const TOOL_WEAR_MAX_ENTRIES = 40;

export interface ToolStackState {
  /** Cópias na pilha. */
  qty: number;
  /** Durabilidade restante da cópia em uso; null = cheia. */
  remaining: number | null;
}

export interface ToolWearResult {
  qty: number;
  remaining: number | null;
  /** Quantas cópias quebraram neste lote. */
  broken: number;
}

/** Restante válido (1..max); null/lixo/valor acima do máximo atual → cheia. */
export function clampToolRemaining(remaining: number | null | undefined, maxDurability: number): number {
  const max = Math.max(1, Math.floor(maxDurability));
  if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining <= 0) return max;
  return Math.min(max, Math.floor(remaining));
}

/** Aplica `hits` golpes à pilha. Nunca produz qty negativa nem remaining ≤ 0 com cópias. */
export function applyToolWear(stack: ToolStackState, hits: number, maxDurability: number): ToolWearResult {
  const max = Math.max(1, Math.floor(maxDurability));
  let qty = Number.isFinite(stack.qty) ? Math.max(0, Math.floor(stack.qty)) : 0;
  if (qty === 0) return { qty: 0, remaining: null, broken: 0 };
  const spent = Number.isFinite(hits) ? Math.max(0, Math.floor(hits)) : 0;
  let remaining = clampToolRemaining(stack.remaining, max) - spent;
  let broken = 0;
  while (remaining <= 0) {
    qty -= 1;
    broken += 1;
    if (qty === 0) return { qty: 0, remaining: null, broken };
    remaining += max;
  }
  return { qty, remaining, broken };
}

/** Fração 0..1 da barra de durabilidade (null = cheia). */
export function toolDurabilityRatio(remaining: number | null | undefined, maxDurability: number): number {
  const max = Math.max(1, Math.floor(maxDurability));
  return clampToolRemaining(remaining, max) / max;
}
