/**
 * Craft system — shared shapes/validators (spec: /admin/craft).
 *
 * CRAFT ITEMS are admin-defined materials (ouro, prata, …) with an uploaded
 * icon; CRAFT RECIPES map a craft-tool ITEM (a generator PNG asset id from the
 * `crafttools` category, e.g. "pickaxe1" / "pickaxe1_c2") to the bag of craft
 * items required to obtain it. Order NEVER matters — a recipe is a multiset of
 * {itemId, quantity} entries (max 9 distinct entries, quantity 1..999).
 *
 * Mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/craft/CraftShapes.ts    (client)
 *   - server/src/shared/craft/CraftShapes.ts                  (Colyseus server)
 *   - artifacts/api-server/src/src/shared/craft/CraftShapes.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 */

/** Item ids are lowercase slugs (derived from the display name). */
export const CRAFT_ITEM_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** Recipe targets are generator asset ids (family or family_cN file stem). */
export const CRAFT_TARGET_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
export const MAX_CRAFT_ITEM_NAME_LEN = 48;
export const MAX_CRAFT_IMAGE_URL_LEN = 512;
export const MAX_RECIPE_INGREDIENTS = 9;
export const MIN_INGREDIENT_QUANTITY = 1;
export const MAX_INGREDIENT_QUANTITY = 999;

export interface CraftItemConfig {
  itemId: string;
  name: string;
  /** Public URL of the uploaded icon (Supabase Storage) — null until uploaded. */
  imageUrl: string | null;
}

export interface CraftIngredient {
  itemId: string;
  /** Integer 1..999 — how many of the item the recipe consumes. */
  quantity: number;
}

export interface CraftRecipeConfig {
  targetId: string;
  /** 1..9 entries, unique itemIds; order is irrelevant by design. */
  ingredients: CraftIngredient[];
}

export interface CraftValidation {
  ok: boolean;
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Derive a stable item id from a display name (client convenience). */
export function slugifyCraftItemName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return CRAFT_ITEM_ID_RE.test(slug) ? slug : '';
}

export function validateCraftItemConfig(value: unknown): CraftValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config: objeto esperado'] };
  const itemId = value.itemId;
  if (typeof itemId !== 'string' || !CRAFT_ITEM_ID_RE.test(itemId)) {
    errors.push('itemId: slug minúsculo (a-z, 0-9, "-", "_"), 1–48 caracteres');
  }
  const name = value.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > MAX_CRAFT_ITEM_NAME_LEN) {
    errors.push(`name: obrigatório, 1–${MAX_CRAFT_ITEM_NAME_LEN} caracteres`);
  }
  const imageUrl = value.imageUrl;
  if (imageUrl !== null && imageUrl !== undefined) {
    if (
      typeof imageUrl !== 'string' ||
      imageUrl.length > MAX_CRAFT_IMAGE_URL_LEN ||
      !/^https?:\/\//i.test(imageUrl)
    ) {
      errors.push(`imageUrl: null ou URL http(s) de até ${MAX_CRAFT_IMAGE_URL_LEN} caracteres`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateCraftRecipeConfig(
  value: unknown,
  knownItemIds?: ReadonlySet<string>,
): CraftValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config: objeto esperado'] };
  const targetId = value.targetId;
  if (typeof targetId !== 'string' || !CRAFT_TARGET_ID_RE.test(targetId)) {
    errors.push('targetId: id de asset inválido');
  }
  const ingredients = value.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > MAX_RECIPE_INGREDIENTS) {
    errors.push(`ingredients: lista de 1–${MAX_RECIPE_INGREDIENTS} entradas`);
    return { ok: false, errors };
  }
  const seen = new Set<string>();
  for (const [i, entry] of ingredients.entries()) {
    if (!isRecord(entry)) {
      errors.push(`ingredients[${i}]: objeto esperado`);
      continue;
    }
    const itemId = entry.itemId;
    if (typeof itemId !== 'string' || !CRAFT_ITEM_ID_RE.test(itemId)) {
      errors.push(`ingredients[${i}].itemId: slug inválido`);
    } else {
      if (seen.has(itemId)) errors.push(`ingredients[${i}].itemId: repetido ("${itemId}")`);
      seen.add(itemId);
      if (knownItemIds && !knownItemIds.has(itemId)) {
        errors.push(`ingredients[${i}].itemId: item desconhecido ("${itemId}")`);
      }
    }
    const q = entry.quantity;
    if (!isInt(q) || q < MIN_INGREDIENT_QUANTITY || q > MAX_INGREDIENT_QUANTITY) {
      errors.push(
        `ingredients[${i}].quantity: inteiro ${MIN_INGREDIENT_QUANTITY}–${MAX_INGREDIENT_QUANTITY}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Order-independent equality of two ingredient bags (dirty checks/tests). */
export function sameIngredientBag(a: CraftIngredient[], b: CraftIngredient[]): boolean {
  if (a.length !== b.length) return false;
  const key = (list: CraftIngredient[]) =>
    [...list]
      .sort((x, y) => x.itemId.localeCompare(y.itemId))
      .map((e) => `${e.itemId}:${e.quantity}`)
      .join('|');
  return key(a) === key(b);
}
