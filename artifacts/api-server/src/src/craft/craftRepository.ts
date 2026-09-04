/**
 * CraftRepository — craft items + craft recipes persistence (spec: /admin/craft).
 *
 * Storage: Supabase tables `craft_items` (item_id text PK, config jsonb,
 * updated_at) and `craft_recipes` (target_id text PK, config jsonb,
 * updated_at), service-role only — same pattern as weapon_families.
 *
 * Craft-tool DISCOVERY (which PNGs exist) is dynamic on the client (generator
 * manifest scan of the `crafttools` folder); recipes reference those asset ids
 * by FORMAT only — the server never scans PNGs.
 */
import {
  validateCraftItemConfig,
  validateCraftRecipeConfig,
  type CraftItemConfig,
  type CraftRecipeConfig,
} from '../shared/craft/CraftShapes.js';
import { PLACEABLE_STATIONS, isPlaceableStationItemKey } from '../shared/craft/PlaceableStations.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const CRAFT_TABLES_SQL = `CREATE TABLE IF NOT EXISTS craft_items (
  item_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE craft_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS craft_recipes (
  target_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE craft_recipes ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

interface ConfigRow {
  config: unknown;
  updated_at?: string;
}
type ItemRow = ConfigRow & { item_id: string };
type RecipeRow = ConfigRow & { target_id: string };

export interface CraftListResult<T> {
  records: Record<string, T>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  error: string | null;
  invalidIds: string[];
}

export interface CraftWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

const emptyList = <T>(over: Partial<CraftListResult<T>> = {}): CraftListResult<T> => ({
  records: {},
  updatedAt: {},
  tableMissing: false,
  error: null,
  invalidIds: [],
  ...over,
});

// ------------------------------------------------------------------- items

/**
 * Itens EMBUTIDOS (estações portáteis): existem mesmo sem linha na tabela; a
 * linha, quando houver, só sobrescreve nome/durabilidade/reparo — a imagem é
 * sempre a do jogo (o cliente resolve pelo id), nunca uma URL enviada.
 */
export function builtInCraftItems(): Record<string, CraftItemConfig> {
  const records: Record<string, CraftItemConfig> = {};
  for (const def of PLACEABLE_STATIONS) {
    records[def.itemId] = { itemId: def.itemId, name: def.name, imageUrl: null, durability: def.defaultDurability };
  }
  return records;
}

/** Aplica uma linha salva por cima da definição embutida (campos travados preservados). */
export function mergeBuiltInCraftItem(base: CraftItemConfig, override: CraftItemConfig): CraftItemConfig {
  return {
    ...base,
    name: override.name,
    repairsItemId: override.repairsItemId ?? null,
    durability: override.durability ?? base.durability,
  };
}

export async function listCraftItems(): Promise<CraftListResult<CraftItemConfig>> {
  const client = getServiceClient();
  if (!client) return emptyList({ error: PERSISTENCE_UNAVAILABLE });
  const { data, error } = await client
    .from('craft_items')
    .select('item_id, config, updated_at')
    .order('item_id');
  if (error) {
    if (isTableMissing(error.code)) return emptyList({ tableMissing: true, records: builtInCraftItems() });
    return emptyList({ error: error.message });
  }
  const result = emptyList<CraftItemConfig>({ records: builtInCraftItems() });
  for (const row of (data ?? []) as ItemRow[]) {
    const validated = validateCraftItemConfig(row.config);
    const config = row.config as CraftItemConfig;
    if (validated.ok && config.itemId === row.item_id) {
      result.records[row.item_id] = isPlaceableStationItemKey(row.item_id)
        ? mergeBuiltInCraftItem(result.records[row.item_id], config)
        : config;
      if (row.updated_at) result.updatedAt[row.item_id] = row.updated_at;
    } else {
      console.warn(`[craft] stored item "${row.item_id}" is invalid; skipping`);
      result.invalidIds.push(row.item_id);
    }
  }
  return result;
}

export async function saveCraftItem(config: CraftItemConfig): Promise<CraftWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { item_id: config.itemId, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('craft_items').upsert(row, { onConflict: 'item_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateCraftCaches();
  return { ok: true, tableMissing: false, error: null };
}

export async function deleteCraftItem(itemId: string): Promise<CraftWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('craft_items').delete().eq('item_id', itemId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateCraftCaches();
  return { ok: true, tableMissing: false, error: null };
}

// ----------------------------------------------------------------- recipes

export async function listCraftRecipes(): Promise<CraftListResult<CraftRecipeConfig>> {
  const client = getServiceClient();
  if (!client) return emptyList({ error: PERSISTENCE_UNAVAILABLE });
  const { data, error } = await client
    .from('craft_recipes')
    .select('target_id, config, updated_at')
    .order('target_id');
  if (error) {
    if (isTableMissing(error.code)) return emptyList({ tableMissing: true });
    return emptyList({ error: error.message });
  }
  const result = emptyList<CraftRecipeConfig>();
  for (const row of (data ?? []) as RecipeRow[]) {
    // Item references are validated at write time; here we only check shape.
    const validated = validateCraftRecipeConfig(row.config);
    const config = row.config as CraftRecipeConfig;
    if (validated.ok && config.targetId === row.target_id) {
      result.records[row.target_id] = config;
      if (row.updated_at) result.updatedAt[row.target_id] = row.updated_at;
    } else {
      console.warn(`[craft] stored recipe "${row.target_id}" is invalid; skipping`);
      result.invalidIds.push(row.target_id);
    }
  }
  return result;
}

export async function saveCraftRecipe(config: CraftRecipeConfig): Promise<CraftWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { target_id: config.targetId, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('craft_recipes').upsert(row, { onConflict: 'target_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateCraftCaches();
  return { ok: true, tableMissing: false, error: null };
}

export async function deleteCraftRecipe(targetId: string): Promise<CraftWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('craft_recipes').delete().eq('target_id', targetId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateCraftCaches();
  return { ok: true, tableMissing: false, error: null };
}

// ------------------------------------------------------------------- cache

let itemsCache: { map: Record<string, CraftItemConfig>; expiresAt: number } | null = null;
let recipesCache: { map: Record<string, CraftRecipeConfig>; expiresAt: number } | null = null;

export function invalidateCraftCaches(): void {
  itemsCache = null;
  recipesCache = null;
}

/** Cached itemId → config map for game clients. Errors resolve to {}. */
export async function getCraftItemsCached(): Promise<Record<string, CraftItemConfig>> {
  if (itemsCache && Date.now() < itemsCache.expiresAt) return itemsCache.map;
  const result = await listCraftItems();
  // Sem persistência os embutidos continuam existindo (o jogo os conhece).
  const map = result.error ? builtInCraftItems() : result.records;
  itemsCache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
  return map;
}

/** Cached targetId → recipe map for game clients. Errors resolve to {}. */
export async function getCraftRecipesCached(): Promise<Record<string, CraftRecipeConfig>> {
  if (recipesCache && Date.now() < recipesCache.expiresAt) return recipesCache.map;
  const result = await listCraftRecipes();
  const map = result.error ? {} : result.records;
  recipesCache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
  return map;
}
