/**
 * Badges de itens de craft — etiquetas de texto livres (`food`, `edible`,
 * `forging`, `smelting`, `potion`…) que outras telas usam para FILTRAR itens:
 *   - `food`: item de culinária (ingrediente OU prato) — dá XP de Culinária ao
 *     ser obtido (cozinhado ou coletado do chão). Sozinha NÃO deixa comer.
 *   - `edible`: comestível — o clique na hotbar come e repõe energia. Normalmente
 *     vem junto com `food` (`food` sem `edible` = ingrediente).
 *   - `forging`/`smelting`/`potion`: XP das respectivas habilidades.
 *
 * Valem para QUALQUER id da página de receitas (gen refs, recursos e drops,
 * craft items custom), por isso moram numa tabela própria e não em craft_items.
 */
import { classifyCraftEntityId } from './CraftShapes.js';

/** Lowercase, sem espaços: letras/dígitos/`_`/`-`, 1..24 caracteres. */
export const CRAFT_BADGE_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
export const MAX_CRAFT_BADGE_LEN = 24;
export const MAX_CRAFT_BADGES_PER_ITEM = 20;

/** Badges com significado no jogo (as demais são só filtros do admin). */
export const BADGE_FOOD = 'food';
export const BADGE_EDIBLE = 'edible';
export const BADGE_FORGING = 'forging';
export const BADGE_SMELTING = 'smelting';
export const BADGE_POTION = 'potion';
export const SUGGESTED_CRAFT_BADGES: readonly string[] = [BADGE_FOOD, BADGE_EDIBLE, BADGE_FORGING, BADGE_SMELTING, BADGE_POTION];

/** itemId → badges (sem repetição, em ordem de inserção). */
export type CraftBadgeMap = Record<string, string[]>;

export type BadgeNormalizeResult = { ok: true; badges: string[] } | { ok: false; error: string };

/** Uma badge digitada pelo admin: aparada, minúscula, espaços internos viram `-`. */
export function normalizeCraftBadge(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const badge = raw.trim().toLowerCase().replace(/\s+/g, '-');
  return CRAFT_BADGE_RE.test(badge) ? badge : null;
}

/** Lista vinda do cliente/banco: valida cada badge, remove repetidas, limita a quantidade. */
export function normalizeCraftBadges(input: unknown): BadgeNormalizeResult {
  if (!Array.isArray(input)) return { ok: false, error: 'badges: lista de textos' };
  const badges: string[] = [];
  for (const raw of input) {
    const badge = normalizeCraftBadge(raw);
    if (badge === null) {
      return { ok: false, error: `badge inválida: "${String(raw)}" (letras minúsculas, dígitos, _ ou -, até ${MAX_CRAFT_BADGE_LEN} caracteres)` };
    }
    if (!badges.includes(badge)) badges.push(badge);
  }
  if (badges.length > MAX_CRAFT_BADGES_PER_ITEM) {
    return { ok: false, error: `no máximo ${MAX_CRAFT_BADGES_PER_ITEM} badges por item` };
  }
  return { ok: true, badges };
}

/** Id aceito na tabela de badges: qualquer entidade da página de receitas. */
export function isBadgeableItemId(id: unknown): id is string {
  return classifyCraftEntityId(id) !== null;
}

export function itemHasBadge(map: CraftBadgeMap | null | undefined, itemId: string, badge: string): boolean {
  return !!map?.[itemId]?.includes(badge);
}

/** Só a badge `edible` libera a ação de comer; `food` sozinha é ingrediente. */
export function isEdibleItem(map: CraftBadgeMap | null | undefined, itemId: string): boolean {
  return itemHasBadge(map, itemId, BADGE_EDIBLE);
}

/** Ids que carregam a badge (ordem estável por id). */
export function itemsWithBadge(map: CraftBadgeMap | null | undefined, badge: string): string[] {
  if (!map) return [];
  return Object.keys(map).filter((id) => map[id].includes(badge)).sort();
}
