/**
 * Config de energia + habilidades (documento único em jsonb).
 *
 * Storage: Supabase `energy_skills_config` (config_id text PK, config jsonb,
 * updated_at), service-role only — mesmo padrão de collection_world_config.
 */
import {
  DEFAULT_ENERGY_SKILLS_CONFIG,
  ENERGY_SKILLS_CONFIG_ID,
  parseEnergySkillsConfig,
  type EnergySkillsConfig,
} from '../shared/progress/EnergySkillsShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const ENERGY_SKILLS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS energy_skills_config (
  config_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE energy_skills_config ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

export interface EnergySkillsReadResult {
  config: EnergySkillsConfig | null;
  updatedAt: string | null;
  tableMissing: boolean;
  error: string | null;
}

export interface EnergySkillsWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

export async function getEnergySkillsConfig(): Promise<EnergySkillsReadResult> {
  const client = getServiceClient();
  if (!client) return { config: null, updatedAt: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client
    .from('energy_skills_config')
    .select('config_id, config, updated_at')
    .eq('config_id', ENERGY_SKILLS_CONFIG_ID)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { config: null, updatedAt: null, tableMissing: true, error: null };
    return { config: null, updatedAt: null, tableMissing: false, error: error.message };
  }
  if (!data) return { config: null, updatedAt: null, tableMissing: false, error: null };
  const parsed = parseEnergySkillsConfig(data.config);
  if (!parsed.ok) {
    console.warn('[progress] config de energia/skills armazenada inválida; usando defaults:', parsed.errors[0]);
    return { config: null, updatedAt: null, tableMissing: false, error: null };
  }
  return {
    config: parsed.config,
    updatedAt: (data as { updated_at?: string }).updated_at ?? null,
    tableMissing: false,
    error: null,
  };
}

export async function saveEnergySkillsConfig(config: EnergySkillsConfig): Promise<EnergySkillsWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { config_id: ENERGY_SKILLS_CONFIG_ID, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('energy_skills_config').upsert(row, { onConflict: 'config_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateEnergySkillsCache();
  return { ok: true, tableMissing: false, error: null };
}

// ------------------------------------------------------------------- cache

let cache: { config: EnergySkillsConfig; expiresAt: number } | null = null;

export function invalidateEnergySkillsCache(): void {
  cache = null;
}

/** Config efetiva (salva ou defaults), cacheada 30 s. Nunca falha. */
export async function getEnergySkillsConfigCached(): Promise<EnergySkillsConfig> {
  if (cache && Date.now() < cache.expiresAt) return cache.config;
  let config = DEFAULT_ENERGY_SKILLS_CONFIG;
  try {
    const result = await getEnergySkillsConfig();
    if (result.config) config = result.config;
  } catch (error) {
    console.warn(`[progress] config de energia/skills indisponível: ${error instanceof Error ? error.message : String(error)}`);
  }
  cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}
