import {
  HUNTING_CONFIG_TABLE_SQL,
  defaultHuntingConfig,
  parseHuntingConfig,
  type HuntingConfig,
} from '../shared/hunting/HuntingShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export { HUNTING_CONFIG_TABLE_SQL };
const CACHE_TTL_MS = 30_000;
let cache: { config: HuntingConfig; expiresAt: number } | null = null;

export interface HuntingConfigRead {
  config: HuntingConfig | null;
  tableMissing: boolean;
  error: string | null;
}

export async function getHuntingConfig(): Promise<HuntingConfigRead> {
  const client = getServiceClient();
  if (!client) return { config: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client.from('hunting_config').select('config').eq('config_id', 'default').maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { config: null, tableMissing: true, error: null };
    return { config: null, tableMissing: false, error: error.message };
  }
  return { config: data ? parseHuntingConfig(data.config) : null, tableMissing: false, error: null };
}

export async function saveHuntingConfig(config: HuntingConfig): Promise<{ ok: boolean; tableMissing: boolean; error: string | null }> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('hunting_config').upsert(
    { config_id: 'default', config, updated_at: new Date().toISOString() },
    { onConflict: 'config_id' },
  );
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateHuntingConfigCache();
  return { ok: true, tableMissing: false, error: null };
}

export function invalidateHuntingConfigCache(): void { cache = null; }

export async function getHuntingConfigCached(force = false): Promise<HuntingConfig> {
  if (!force && cache && Date.now() < cache.expiresAt) return cache.config;
  let config = defaultHuntingConfig();
  try {
    const result = await getHuntingConfig();
    if (result.config) config = result.config;
  } catch (error) {
    console.warn('[hunting] config indisponível:', error instanceof Error ? error.message : error);
  }
  cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}