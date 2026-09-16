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
 *     "animal:cow" — ver RESOURCE_KEYS no CollectionShapes; nós que rendem
 *     OUTRO item, como "hand_stone" → "mineral:pedra", não são itens —
 *     ver yieldItemKeyFor);
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
import { INVENTORY_ITEM_KEYS, RESOURCE_KEYS } from '../collection/CollectionShapes.js';
import { MAX_PLACEABLE_DURABILITY, MIN_PLACEABLE_DURABILITY, isPlaceableStationItemKey, isValidPlaceableDurability } from './PlaceableStations.js';

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
/** Gambits (moeda das partidas) cobrados por execução da receita — 0 = grátis. */
export const MIN_GAMBITS_COST = 0;
export const MAX_GAMBITS_COST = 100_000;
/** Alternativas ("ou") por card de ingrediente. */
export const MAX_INGREDIENT_ALTERNATIVES = 3;
/** Tempo de preparo por opção (segundos); 0 = instantâneo. */
export const MAX_CRAFT_PREP_SECONDS = 300;
/** Presets oferecidos no editor (0 = Instantâneo). */
export const CRAFT_PREP_SECONDS_PRESETS: readonly number[] = [0, 3, 5, 7, 10, 15, 20];

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

const INVENTORY_RESOURCE_SET: ReadonlySet<string> = new Set(INVENTORY_ITEM_KEYS);

/**
 * O id pode existir numa pilha do inventário (logo, ser ingrediente/alvo de
 * receita ou sofrer delta)? Refs gen: e craft items sempre; chaves de recurso
 * só as que rendem a si mesmas — nós de animal e nós que rendem OUTRO item
 * (pedra de mão → Pedra comum) são recurso do mapa, não item.
 */
export function isInventoryItemId(id: unknown): id is string {
  const kind = classifyCraftEntityId(id);
  if (kind === null) return false;
  if (kind === 'resource') return INVENTORY_RESOURCE_SET.has(id as string);
  return true;
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
  /**
   * Só para ESTAÇÕES PORTÁTEIS embutidas (ver PlaceableStations): quantos
   * crafts a estação aguenta antes de ficar sem durabilidade. Inteiro 1..9999;
   * ausente = padrão da definição embutida. Recusado em qualquer outro item.
   */
  durability?: number;
}

/**
 * Opção alternativa de um ingrediente ("ou"): o jogador pode entregar este
 * item NO LUGAR do principal, na mesma quantidade do card.
 */
export interface CraftIngredientOption {
  itemId: string;
  /**
   * Tempo de preparo em segundos quando ESTA opção é a escolhida — inteiro
   * 0..300 (0/ausente = instantâneo). Só tem efeito em cards com alternativas.
   */
  prepSeconds?: number;
}

export interface CraftIngredient {
  itemId: string;
  /** Integer 1..999 — how many of the item the recipe consumes. */
  quantity: number;
  /** Tempo de preparo (s) quando o item PRINCIPAL é o escolhido — ver CraftIngredientOption. */
  prepSeconds?: number;
  /**
   * Itens aceitos no lugar do principal ("ou"), 1..3, únicos em toda a
   * receita. Ausente/vazio = ingrediente simples. A quantidade é a do card.
   */
  alternatives?: CraftIngredientOption[];
}

/** Escolha do jogador por card: itemId PRINCIPAL do card → itemId da opção usada. */
export type CraftChoices = Readonly<Record<string, string>>;

export interface CraftRecipeConfig {
  targetId: string;
  /** 1..9 entries, unique itemIds; order is irrelevant by design. */
  ingredients: CraftIngredient[];
  /**
   * Unidades do alvo produzidas por execução da receita — inteiro 1..999.
   * Ausente = 1 (receitas antigas); o servidor sempre grava o valor explícito.
   */
  outputQuantity?: number;
  /**
   * Gambits debitados do jogador por execução da receita — inteiro 0..100000.
   * Ausente = 0 (grátis); o servidor sempre grava o valor explícito.
   */
  gambitsCost?: number;
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
  const durability = value.durability;
  if (durability !== undefined && durability !== null) {
    if (!isPlaceableStationItemKey(itemId)) {
      errors.push('durability: só estações portáteis embutidas têm durabilidade');
    } else if (!isValidPlaceableDurability(durability)) {
      errors.push(`durability: inteiro ${MIN_PLACEABLE_DURABILITY}..${MAX_PLACEABLE_DURABILITY}`);
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
  } else if (!isInventoryItemId(targetId)) {
    errors.push(`targetId: "${String(targetId)}" é um nó do mapa, não um item de inventário`);
  }
  const ingredients = value.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > MAX_RECIPE_INGREDIENTS) {
    errors.push(`ingredients: lista de 1–${MAX_RECIPE_INGREDIENTS} entradas`);
    return { ok: false, errors };
  }
  const seen = new Set<string>();
  // Um id (principal OU alternativa) só pode aparecer uma vez em toda a
  // receita — senão a escolha do jogador viraria ambígua nos débitos.
  const checkOptionId = (label: string, itemId: unknown) => {
    const kind = classifyCraftEntityId(itemId);
    if (typeof itemId !== 'string' || kind === null) {
      errors.push(`${label}: id de item inválido`);
      return;
    }
    if (!isInventoryItemId(itemId)) {
      errors.push(`${label}: "${itemId}" é um nó do mapa, não um item de inventário`);
    }
    if (itemId === targetId) {
      errors.push(`${label}: a receita não pode consumir o próprio item`);
    }
    if (seen.has(itemId)) errors.push(`${label}: repetido ("${itemId}")`);
    seen.add(itemId);
    if (kind === 'custom' && knownItemIds && !knownItemIds.has(itemId)) {
      errors.push(`${label}: item desconhecido ("${itemId}")`);
    }
  };
  const checkPrepSeconds = (label: string, value: unknown) => {
    if (value === undefined) return;
    if (!isInt(value) || value < 0 || value > MAX_CRAFT_PREP_SECONDS) {
      errors.push(`${label}: inteiro 0–${MAX_CRAFT_PREP_SECONDS} segundos (ausente = instantâneo)`);
    }
  };
  for (const [i, entry] of ingredients.entries()) {
    if (!isRecord(entry)) {
      errors.push(`ingredients[${i}]: objeto esperado`);
      continue;
    }
    checkOptionId(`ingredients[${i}].itemId`, entry.itemId);
    const q = entry.quantity;
    if (!isInt(q) || q < MIN_INGREDIENT_QUANTITY || q > MAX_INGREDIENT_QUANTITY) {
      errors.push(
        `ingredients[${i}].quantity: inteiro ${MIN_INGREDIENT_QUANTITY}–${MAX_INGREDIENT_QUANTITY}`,
      );
    }
    checkPrepSeconds(`ingredients[${i}].prepSeconds`, entry.prepSeconds);
    const alternatives = entry.alternatives;
    if (alternatives === undefined) continue;
    // Lista vazia é tolerada na LEITURA (= sem alternativas); a gravação nunca a persiste.
    if (!Array.isArray(alternatives) || alternatives.length > MAX_INGREDIENT_ALTERNATIVES) {
      errors.push(`ingredients[${i}].alternatives: lista de até ${MAX_INGREDIENT_ALTERNATIVES} opções`);
      continue;
    }
    for (const [j, option] of alternatives.entries()) {
      const label = `ingredients[${i}].alternatives[${j}]`;
      if (!isRecord(option)) {
        errors.push(`${label}: objeto esperado`);
        continue;
      }
      checkOptionId(`${label}.itemId`, option.itemId);
      checkPrepSeconds(`${label}.prepSeconds`, option.prepSeconds);
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
  const gambits = value.gambitsCost;
  if (gambits !== undefined) {
    if (!isInt(gambits) || gambits < MIN_GAMBITS_COST || gambits > MAX_GAMBITS_COST) {
      errors.push(`gambitsCost: inteiro ${MIN_GAMBITS_COST}–${MAX_GAMBITS_COST} (ausente = 0)`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------- alternativas ("ou") e preparo

/** Alternativas efetivas de um card (ausente/vazio = nenhuma). */
export function ingredientAlternatives(ing: CraftIngredient): CraftIngredientOption[] {
  return ing.alternatives && ing.alternatives.length > 0 ? ing.alternatives : [];
}

export function ingredientHasAlternatives(ing: CraftIngredient): boolean {
  return ingredientAlternatives(ing).length > 0;
}

/** Todas as opções do card na ordem exibida: o principal primeiro, depois as alternativas. */
export function ingredientOptions(ing: CraftIngredient): CraftIngredientOption[] {
  return [
    { itemId: ing.itemId, ...(ing.prepSeconds !== undefined ? { prepSeconds: ing.prepSeconds } : {}) },
    ...ingredientAlternatives(ing),
  ];
}

/** Ids de item que uma receita pode consumir (principais + alternativas). */
export function recipeIngredientItemIds(recipe: Pick<CraftRecipeConfig, 'ingredients'>): string[] {
  return recipe.ingredients.flatMap((ing) => ingredientOptions(ing).map((option) => option.itemId));
}

/**
 * Tempo de preparo de uma opção. Só cards COM alternativas têm tempo — um
 * `prepSeconds` órfão (alternativas removidas) é ignorado.
 */
export function ingredientOptionPrepSeconds(ing: CraftIngredient, chosenItemId: string): number {
  if (!ingredientHasAlternatives(ing)) return 0;
  const option = ingredientOptions(ing).find((entry) => entry.itemId === chosenItemId);
  const seconds = option?.prepSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/** Ingrediente com a escolha do jogador aplicada. */
export interface ResolvedIngredient {
  /** Id do card (item principal) — chave em `CraftChoices`. */
  primaryId: string;
  /** Item efetivamente consumido. */
  itemId: string;
  quantity: number;
  prepSeconds: number;
}

export type ResolvedRecipe =
  | { ok: true; ingredients: ResolvedIngredient[]; prepSeconds: number }
  | { ok: false; message: string };

/**
 * Aplica as escolhas ("ou") a uma receita. Sem escolha para um card = opção
 * principal. Escolha para card sem alternativas, para id fora da receita ou
 * para item que não é opção do card = erro (o cliente nunca manda isso).
 * `prepSeconds` do craft = MAIOR tempo entre as opções escolhidas (por
 * execução, não multiplica pela quantidade).
 */
export function resolveRecipeChoices(recipe: CraftRecipeConfig, choices?: CraftChoices | null): ResolvedRecipe {
  const picked = choices ?? {};
  const ingredients: ResolvedIngredient[] = [];
  let prepSeconds = 0;
  for (const ing of recipe.ingredients) {
    const chosen = picked[ing.itemId] ?? ing.itemId;
    const options = ingredientOptions(ing);
    if (!options.some((option) => option.itemId === chosen)) {
      return { ok: false, message: `"${chosen}" não é uma opção válida para o ingrediente "${ing.itemId}"` };
    }
    if (chosen !== ing.itemId && !ingredientHasAlternatives(ing)) {
      return { ok: false, message: `O ingrediente "${ing.itemId}" não tem alternativas` };
    }
    const seconds = ingredientOptionPrepSeconds(ing, chosen);
    prepSeconds = Math.max(prepSeconds, seconds);
    ingredients.push({ primaryId: ing.itemId, itemId: chosen, quantity: ing.quantity, prepSeconds: seconds });
  }
  const cardIds = new Set(recipe.ingredients.map((ing) => ing.itemId));
  for (const key of Object.keys(picked)) {
    if (!cardIds.has(key)) return { ok: false, message: `"${key}" não é um ingrediente desta receita` };
  }
  return { ok: true, ingredients, prepSeconds };
}

/** Segundos de preparo do craft para as escolhas dadas (0 = instantâneo/escolha inválida). */
export function craftPrepSeconds(recipe: CraftRecipeConfig, choices?: CraftChoices | null): number {
  const resolved = resolveRecipeChoices(recipe, choices);
  return resolved.ok ? resolved.prepSeconds : 0;
}

/**
 * Escolhas "automáticas" para um inventário: em cada card com alternativas,
 * a primeira opção (na ordem exibida) que o inventário cobre; se nenhuma
 * cobrir, a principal. Cards simples não entram no mapa.
 */
export function autoChoicesFor(
  recipe: CraftRecipeConfig,
  counts: Readonly<Record<string, number>>,
  multiplier = 1,
): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const ing of recipe.ingredients) {
    if (!ingredientHasAlternatives(ing)) continue;
    const need = ing.quantity * multiplier;
    const covered = ingredientOptions(ing).find((option) => (counts[option.itemId] ?? 0) >= need);
    choices[ing.itemId] = covered?.itemId ?? ing.itemId;
  }
  return choices;
}

/** Order-independent equality of two ingredient bags (dirty checks/tests). */
export function sameIngredientBag(a: CraftIngredient[], b: CraftIngredient[]): boolean {
  if (a.length !== b.length) return false;
  const optionKey = (option: CraftIngredientOption) => `${option.itemId}@${option.prepSeconds ?? 0}`;
  const entryKey = (e: CraftIngredient) => {
    const alternatives = ingredientAlternatives(e);
    if (alternatives.length === 0) return `${e.itemId}:${e.quantity}`;
    // Com alternativas os tempos contam (inclusive o do principal) e a ordem
    // das opções também — ela é a ordem do select no jogo.
    return `${e.itemId}:${e.quantity}@${e.prepSeconds ?? 0}|${alternatives.map(optionKey).join(',')}`;
  };
  const key = (list: CraftIngredient[]) =>
    [...list]
      .sort((x, y) => x.itemId.localeCompare(y.itemId))
      .map(entryKey)
      .join('|');
  return key(a) === key(b);
}

/** Unidades do alvo produzidas por execução da receita (ausente/legado = 1). */
export function recipeOutputQuantity(recipe: CraftRecipeConfig | null | undefined): number {
  return recipe?.outputQuantity ?? 1;
}

/** Gambits cobrados por execução da receita (ausente/legado = 0). */
export function recipeGambitsCost(recipe: CraftRecipeConfig | null | undefined): number {
  const cost = recipe?.gambitsCost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 0;
}

// ------------------------------------------------- consulta de craftabilidade
// Formato de inventário: Record<itemId, quantidade> — o mesmo dos stores do
// cliente (coleta/ferramentas) e de qualquer snapshot vindo do servidor.

export interface MissingIngredient {
  /** Item que faltou (a opção escolhida do card). */
  itemId: string;
  need: number;
  have: number;
}

/**
 * O que falta para craftar `recipe` com o inventário `counts` (O(ingredientes)).
 * `choices` = opções escolhidas nos cards com "ou"; ausente = escolha
 * automática (primeira opção que o inventário cobre — ver autoChoicesFor).
 */
export function missingIngredientsFor(
  recipe: CraftRecipeConfig,
  counts: Readonly<Record<string, number>>,
  choices?: CraftChoices | null,
): MissingIngredient[] {
  const resolved = resolveRecipeChoices(recipe, choices ?? autoChoicesFor(recipe, counts));
  if (!resolved.ok) return recipe.ingredients.map((ing) => ({ itemId: ing.itemId, need: ing.quantity, have: 0 }));
  const missing: MissingIngredient[] = [];
  for (const ing of resolved.ingredients) {
    const have = counts[ing.itemId] ?? 0;
    if (have < ing.quantity) missing.push({ itemId: ing.itemId, need: ing.quantity, have });
  }
  return missing;
}

export function canCraft(
  recipe: CraftRecipeConfig,
  counts: Readonly<Record<string, number>>,
  choices?: CraftChoices | null,
): boolean {
  return missingIngredientsFor(recipe, counts, choices).length === 0;
}

/** Alvos craftáveis com o inventário atual (qualquer combinação de "ou"), ordenados (UI estável). */
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
