/**
 * Regras puras da grade de slots do inventário (sem React/rede), usadas pelo
 * store e testáveis isoladamente.
 *
 * - `capacity` slots em INVENTORY_COLUMNS colunas; a última linha é o acesso rápido.
 * - `weaponSlotIndex(capacity)` (1º slot da última linha) é RESERVADO à arma
 *   da classe: nunca recebe item, nem por arrumação automática nem por arrasto.
 */
import { INVENTORY_COLUMNS } from '../../shared/collection/CollectionShapes';

export type SlotGrid = Array<string | null>;

export function weaponSlotIndex(capacity: number): number {
  return Math.max(0, capacity - INVENTORY_COLUMNS);
}

export const emptySlots = (capacity: number): SlotGrid => Array<string | null>(capacity).fill(null);

/** Normaliza uma grade vinda do storage: tamanho certo, sem duplicatas, slot reservado vazio. */
export function sanitizeSlots(raw: unknown, capacity: number): SlotGrid {
  if (!Array.isArray(raw)) return emptySlots(capacity);
  const reserved = weaponSlotIndex(capacity);
  const unique = new Set<string>();
  return Array.from({ length: capacity }, (_, index) => {
    const value = raw[index];
    if (index === reserved || typeof value !== 'string' || !value || unique.has(value)) return null;
    unique.add(value);
    return value;
  });
}

/**
 * Mantém a arrumação do jogador, remove o que acabou, encaixa itens novos nos
 * slots livres e adapta o tamanho quando a capacidade muda. Itens que não
 * couberem continuam existindo no servidor (ver `countUnslottedItems`).
 */
export function reconcileSlots(slots: SlotGrid, items: Record<string, number>, capacity: number): SlotGrid {
  const reserved = weaponSlotIndex(capacity);
  const available = new Set(Object.entries(items).filter(([, qty]) => qty > 0).map(([key]) => key));
  const seen = new Set<string>();
  const next: SlotGrid = Array.from({ length: capacity }, (_, index) => {
    const key = slots[index] ?? null;
    if (index === reserved || !key || !available.has(key) || seen.has(key)) return null;
    seen.add(key);
    return key;
  });
  // Itens que perderam o slot (capacidade menor) entram primeiro, na ordem antiga.
  const orphans = slots.slice(capacity).filter((key): key is string => !!key && available.has(key) && !seen.has(key));
  const incoming = [...orphans, ...[...available].filter((key) => !seen.has(key) && !orphans.includes(key))];
  for (const key of incoming) {
    if (seen.has(key)) continue;
    const empty = next.findIndex((value, index) => value === null && index !== reserved);
    if (empty === -1) break;
    next[empty] = key;
    seen.add(key);
  }
  return next;
}

/** Troca dois slots; devolve a mesma grade se o movimento for inválido (índices/reservado). */
export function swapSlots(slots: SlotGrid, from: number, to: number, capacity: number): SlotGrid {
  const reserved = weaponSlotIndex(capacity);
  if (from < 0 || to < 0 || from >= slots.length || to >= slots.length || from === to) return slots;
  if (from === reserved || to === reserved) return slots;
  const next = [...slots];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Quantos itens (com saldo) não couberam em nenhum slot. */
export function countUnslottedItems(items: Record<string, number>, slots: SlotGrid): number {
  const slotted = new Set(slots.filter((key): key is string => !!key));
  return Object.entries(items).filter(([key, qty]) => qty > 0 && !slotted.has(key)).length;
}
