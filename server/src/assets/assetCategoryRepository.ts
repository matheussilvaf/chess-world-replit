/**
 * AssetCategoryRepository — categorias de permissão de assets
 * (spec: /admin/assets-controller).
 *
 * Storage: tabela Supabase `asset_categories` (category_id text PK, config
 * jsonb, updated_at), service-role only — mesmo padrão de craft_items.
 *
 * O jogo ainda não consome estas categorias; elas são metadados de
 * permissão/organização que features futuras (criação de personagem, loja,
 * level up) vão referenciar. A DESCOBERTA dos assets (quais PNGs existem) é
 * dinâmica no cliente via manifest do gerador; aqui só se valida FORMATO.
 */
import {
  validateAssetCategoryConfig,
  type AssetCategoryConfig,
} from '../shared/assets/AssetCategoryShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const ASSET_CATEGORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS asset_categories (
  category_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

interface CategoryRow {
  category_id: string;
  config: unknown;
  updated_at?: string;
}

export interface AssetCategoryListResult {
  records: Record<string, AssetCategoryConfig>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  error: string | null;
  invalidIds: string[];
}

export interface AssetCategoryWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

const emptyList = (over: Partial<AssetCategoryListResult> = {}): AssetCategoryListResult => ({
  records: {},
  updatedAt: {},
  tableMissing: false,
  error: null,
  invalidIds: [],
  ...over,
});

export async function listAssetCategories(): Promise<AssetCategoryListResult> {
  const client = getServiceClient();
  if (!client) return emptyList({ error: PERSISTENCE_UNAVAILABLE });
  const { data, error } = await client
    .from('asset_categories')
    .select('category_id, config, updated_at')
    .order('category_id');
  if (error) {
    if (isTableMissing(error.code)) return emptyList({ tableMissing: true });
    return emptyList({ error: error.message });
  }
  const result = emptyList();
  for (const row of (data ?? []) as CategoryRow[]) {
    const validated = validateAssetCategoryConfig(row.config);
    const config = row.config as AssetCategoryConfig;
    if (validated.ok && config.categoryId === row.category_id) {
      result.records[row.category_id] = config;
      if (row.updated_at) result.updatedAt[row.category_id] = row.updated_at;
    } else {
      console.warn(`[assets] stored category "${row.category_id}" is invalid; skipping`);
      result.invalidIds.push(row.category_id);
    }
  }
  return result;
}

export async function saveAssetCategory(config: AssetCategoryConfig): Promise<AssetCategoryWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { category_id: config.categoryId, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('asset_categories').upsert(row, { onConflict: 'category_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateAssetCategoryCache();
  return { ok: true, tableMissing: false, error: null };
}

export async function deleteAssetCategory(categoryId: string): Promise<AssetCategoryWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('asset_categories').delete().eq('category_id', categoryId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateAssetCategoryCache();
  return { ok: true, tableMissing: false, error: null };
}

// ------------------------------------------------------------------- cache

let categoriesCache: { map: Record<string, AssetCategoryConfig>; expiresAt: number } | null = null;
// Geração evita a corrida "miss em voo × write": um list iniciado ANTES de um
// invalidate não pode publicar seu resultado (pré-write) no cache depois.
let cacheGeneration = 0;

export function invalidateAssetCategoryCache(): void {
  categoriesCache = null;
  cacheGeneration += 1;
}

/** Mapa categoryId → config, cacheado, para leitura pública. Erros viram {}. */
export async function getAssetCategoriesCached(): Promise<Record<string, AssetCategoryConfig>> {
  if (categoriesCache && Date.now() < categoriesCache.expiresAt) return categoriesCache.map;
  const generationAtStart = cacheGeneration;
  const result = await listAssetCategories();
  const map = result.error ? {} : result.records;
  if (cacheGeneration === generationAtStart) {
    categoriesCache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return map;
}
