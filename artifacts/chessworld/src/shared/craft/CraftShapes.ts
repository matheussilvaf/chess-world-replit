/**
 * Craft system — shared shapes/validators (spec: /admin/craft).
 *
 * O manual de receitas cobre QUALQUER item do jogo. O id de um item no craft
 * usa o MESMO identificador que o runtime já usa para aquele item (zero
 * mapeamento na hora de consultar):
 *   - gerador (ferramentas/armas): ref `gen:<weapon|crafttools>/<família>/<variação>`
 *     — igual ao equip_weapon/toolInventory, com a variação SEMPRE explícita
 *     (ex.: "gen:crafttools/axe/stone", "gen:weapon/sword/default");
 *   - recursos do Mundo de Coleta: chave crua do inventário de coleta
 *     ("mineral:pedra", "tree:pinheiro_peao", "herb:heal_herb", "bush",
 *     "hand_stone", "animal:cow" — ver RESOURCE_KEYS no CollectionShapes);
 *   - CRAFT ITEMS criados no admin (ex.: "barra-de-ouro"): slug + imagem.
 *
 * CRAFT RECIPES: alvo (targetId) + multiset de 1..9 ingredientes
 * {itemId, quantity 1..999}. Qualquer item pode ser alvo E ingrediente —
 * nunca de si mesmo. A ordem NUNCA importa. Cada execução da receita produz
 * `outputQuantity` unidades do alvo (inteiro 1..999; ausente = 1, caso das
 * receitas salvas antes do campo existir).
 *
 * Item de REPARO: um craft item pode declarar `repairsItemId` (ref gen: de
 * arma/ferramenta). A receita DESSE item passa a significar "repara o alvo".
 *
 * Consulta rápida para o jogo: missingIngredientsFor/canCraft/
 * craftableTargetIds operam sobre Record<itemId, quantidade> (o formato dos
 * inventários) em O(ingredientes) — sem joins nem tradução de ids.
 *
 * Mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/craft/CraftShapes.ts    (client)
 *   - server/src/shared/craft/CraftShapes.ts                  (Colyseus server)
 *   - artifacts/api-server/src/src/shared/craft/CraftShapes.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 */
import { RESOURCE_KEYS } from '../collection/CollectionShapes.js';

/** Craft item ids (itens criados no admin) são slugs minúsculos. */
export const CRAFT_ITEM_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/**
 * Ref gen: de item de mão com variação OBRIGATÓRIA — espelha o WEAPON_REF_RE
 * do PlayerCharacterShapes (lá a variação é opcional; aqui o id canônico da
 * receita exige a forma completa para ser único por item).
 */
export const CRAFT_GEN_REF_RE =
  /^gen:(weapon|crafttools)\/([a-z0-9][a-z0-9_-]{0,39})\/([a-z0-9][a-z0-9_-]{0,39})$/;
export const MAX_CRAFT_ITEM_NAME_LEN = 48;
export const MAX_CRAFT_IMAGE_URL_LEN = 512;
export const MAX_RECIPE_INGREDIENTS = 9;
export const MIN_INGREDIENT_QUANTITY = 1;
export const MAX_INGREDIENT_QUANTITY = 999;
export const MIN_OUTPUT_QUANTITY = 1;
export const MAX_OUTPUT_QUANTITY = 999;

const RESOURCE_KEY_SET: ReadonlySet<string> = new Set(RESOURCE_KEYS);

/** Classe de um id de item do craft (null = formato desconhecido). */
export type CraftEntityKind = 'gen' | 'resource' | 'custom';

/**
 * Classifica um id de item do manual de receitas. Recursos vêm ANTES de
 * custom: "bush"/"hand_stone" têm cara de slug, mas são chaves de recurso
 * reservadas (um craft item nunca pode usá-las).
 */
export function classifyCraftEntityId(id: unknown): CraftEntityKind | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (CRAFT_GEN_REF_RE.test(id)) return 'gen';
  if (RESOURCE_KEY_SET.has(id)) return 'resource';
  if (CRAFT_ITEM_ID_RE.test(id)) return 'custom';
  return null;
}

export interface CraftItemConfig {
  itemId: string;
  name: string;
  /** Public URL of the uploaded icon (Supabase Storage) — null until uploaded. */
  imageUrl: string | null;
  /**
   * Item de REPARO: ref gen: da arma/ferramenta que este item repara
   * (ex.: "gen:crafttools/axe/stone"). null/ausente = item comum.
   */
  repairsItemId?: string | null;
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
  /**
   * Unidades do alvo produzidas por execução da receita — inteiro 1..999.
   * Ausente = 1 (receitas antigas); o servidor sempre grava o valor explícito.
   */
  outputQuantity?: number;
}

export interface CraftValidation {
  ok: boolean;
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Derive a stable item id from a display name (client convenience).
 * Slugs que colidem com chaves de recurso reservadas (ex.: "bush") são
 * rejeitados aqui mesmo — retorna '' como qualquer nome inválido.
 */
export function slugifyCraftItemName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return classifyCraftEntityId(slug) === 'custom' ? slug : '';
}

export function validateCraftItemConfig(value: unknown): CraftValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config: objeto esperado'] };
  const itemId = value.itemId;
  if (typeof itemId !== 'string' || classifyCraftEntityId(itemId) !== 'custom') {
    errors.push(
      'itemId: slug minúsculo (a-z, 0-9, "-", "_"), 1–48 caracteres, sem colidir com chaves de recurso do jogo',
    );
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
  const repairs = value.repairsItemId;
  if (repairs !== null && repairs !== undefined) {
    if (typeof repairs !== 'string' || classifyCraftEntityId(repairs) !== 'gen') {
      errors.push(
        'repairsItemId: null ou ref gen: de arma/ferramenta (ex.: "gen:crafttools/axe/stone")',
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Valida uma receita. `knownItemIds` (quando passado) é o conjunto de CRAFT
 * ITEMS existentes — a checagem de existência vale SÓ para ids 'custom':
 * refs gen: vivem no manifest de assets e chaves de recurso são fixas no
 * código, nenhum dos dois está no banco.
 */
export function validateCraftRecipeConfig(
  value: unknown,
  knownItemIds?: ReadonlySet<string>,
): CraftValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config: objeto esperado'] };
  const targetId = value.targetId;
  const targetKind = classifyCraftEntityId(targetId);
  if (targetKind === null) {
    errors.push('targetId: id de item inválido (ref gen:, chave de recurso ou slug de craft item)');
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
    const kind = classifyCraftEntityId(itemId);
    if (typeof itemId !== 'string' || kind === null) {
      errors.push(`ingredients[${i}].itemId: id de item inválido`);
    } else {
      if (itemId === targetId) {
        errors.push(`ingredients[${i}].itemId: a receita não pode consumir o próprio item`);
      }
      if (seen.has(itemId)) errors.push(`ingredients[${i}].itemId: repetido ("${itemId}")`);
      seen.add(itemId);
      if (kind === 'custom' && knownItemIds && !knownItemIds.has(itemId)) {
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
  const output = value.outputQuantity;
  if (output !== undefined) {
    if (!isInt(output) || output < MIN_OUTPUT_QUANTITY || output > MAX_OUTPUT_QUANTITY) {
      errors.push(
        `outputQuantity: inteiro ${MIN_OUTPUT_QUANTITY}–${MAX_OUTPUT_QUANTITY} (ausente = 1)`,
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

/** Unidades do alvo produzidas por execução da receita (ausente/legado = 1). */
export function recipeOutputQuantity(recipe: CraftRecipeConfig | null | undefined): number {
  return recipe?.outputQuantity ?? 1;
}

// ------------------------------------------------- consulta de craftabilidade
// Formato de inventário: Record<itemId, quantidade> — o mesmo dos stores do
// cliente (coleta/ferramentas) e de qualquer snapshot vindo do servidor.

export interface MissingIngredient {
  itemId: string;
  need: number;
  have: number;
}

/** O que falta para craftar `recipe` com o inventário `counts` (O(ingredientes)). */
export function missingIngredientsFor(
  recipe: CraftRecipeConfig,
  counts: Readonly<Record<string, number>>,
): MissingIngredient[] {
  const missing: MissingIngredient[] = [];
  for (const ing of recipe.ingredients) {
    const have = counts[ing.itemId] ?? 0;
    if (have < ing.quantity) missing.push({ itemId: ing.itemId, need: ing.quantity, have });
  }
  return missing;
}

export function canCraft(
  recipe: CraftRecipeConfig,
  counts: Readonly<Record<string, number>>,
): boolean {
  return missingIngredientsFor(recipe, counts).length === 0;
}

/** Alvos craftáveis com o inventário atual, ordenados (UI estável). */
export function craftableTargetIds(
  recipes: Readonly<Record<string, CraftRecipeConfig>>,
  counts: Readonly<Record<string, number>>,
): string[] {
  const out: string[] = [];
  for (const recipe of Object.values(recipes)) {
    if (canCraft(recipe, counts)) out.push(recipe.targetId);
  }
  return out.sort();
}
