/**
 * CollectionRepository — config do Mundo de Coleta (documento único em jsonb).
 *
 * Storage: Supabase `collection_world_config` (config_id text PK, config jsonb,
 * updated_at), service-role only — mesmo padrão de craft_items/weapon_families.
 */
import {
  COLLECTION_CONFIG_ID,
  validateCollectionWorldConfig,
  type CollectionWorldConfig,
} from '../shared/collection/CollectionShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const COLLECTION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS collection_world_config (
  config_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE collection_world_config ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

export interface CollectionReadResult {
  config: CollectionWorldConfig | null;
  updatedAt: string | null;
  tableMissing: boolean;
  error: string | null;
}

export interface CollectionWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

export async function getCollectionConfig(): Promise<CollectionReadResult> {
  const client = getServiceClient();
  if (!client) return { config: null, updatedAt: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client
    .from('collection_world_config')
    .select('config_id, config, updated_at')
    .eq('config_id', COLLECTION_CONFIG_ID)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { config: null, updatedAt: null, tableMissing: true, error: null };
    return { config: null, updatedAt: null, tableMissing: false, error: error.message };
  }
  if (!data) return { config: null, updatedAt: null, tableMissing: false, error: null };
  const validated = validateCollectionWorldConfig(data.config);
  if (!validated.ok) {
    console.warn('[collection] config armazenada inválida; ignorando:', validated.errors[0]);
    return { config: null, updatedAt: null, tableMissing: false, error: null };
  }
  return {
    config: data.config as CollectionWorldConfig,
    updatedAt: (data as { updated_at?: string }).updated_at ?? null,
    tableMissing: false,
    error: null,
  };
}

export async function saveCollectionConfig(config: CollectionWorldConfig): Promise<CollectionWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { config_id: COLLECTION_CONFIG_ID, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('collection_world_config').upsert(row, { onConflict: 'config_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateCollectionCache();
  return { ok: true, tableMissing: false, error: null };
}

// ------------------------------------------------------------------- cache

let cache: { config: CollectionWorldConfig | null; expiresAt: number } | null = null;

export function invalidateCollectionCache(): void {
  cache = null;
}

/** Snapshot cacheado p/ clientes do jogo (erros → null; o mapa usa defaults). */
export async function getCollectionConfigCached(): Promise<CollectionWorldConfig | null> {
  if (cache && Date.now() < cache.expiresAt) return cache.config;
  const result = await getCollectionConfig();
  const config = result.error ? null : result.config;
  cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}
