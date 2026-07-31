/**
 * Server-side loader for character combat configs (Supabase table
 * `character_configs`, `config` jsonb column written by /admin/characters).
 *
 * - Uses the service-role client (server only, same pattern as tournament
 *   persistence).
 * - ~30s TTL cache: combat reads are hot (one lookup per hitbox frame) while
 *   configs change rarely; a 30s staleness window after an editor save is
 *   acceptable.
 * - Tolerates a missing `config` column (Postgres 42703) until the operator
 *   runs the migration SQL — combat then simply resolves no boxes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  validateCharacterConfig,
  type CharacterConfigV1,
} from '../shared/combat/CharacterCombatShapes.js';

const CONFIG_TTL_MS = 30_000;
const SWITCH_TTL_MS = 60_000;

let supabase: SupabaseClient | null = null;
let unavailableLogged = false;

function getClient(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!unavailableLogged) {
      console.warn('[characterConfig] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — combat configs unavailable');
      unavailableLogged = true;
    }
    return null;
  }
  supabase = createClient(url, key);
  return supabase;
}

interface CacheEntry {
  config: CharacterConfigV1 | null;
  expiresAt: number;
}

const configCache = new Map<string, CacheEntry>();

/** Load (with cache) the validated combat config for a character, or null. */
export async function getCharacterConfig(characterId: string): Promise<CharacterConfigV1 | null> {
  const cached = configCache.get(characterId);
  if (cached && Date.now() < cached.expiresAt) return cached.config;

  let config: CharacterConfigV1 | null = null;
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('character_configs')
        .select('config')
        .eq('character_id', characterId)
        .maybeSingle();
      if (error) {
        // 42703 = undefined column: `config` not migrated yet. Cache the miss
        // so attacks do not hammer Supabase.
        if (error.code !== '42703') {
          console.warn(`[characterConfig] load ${characterId} failed: ${error.message}`);
        }
      } else if (data?.config) {
        const result = validateCharacterConfig(data.config);
        if (result.ok) {
          config = result.config;
        } else {
          console.warn(
            `[characterConfig] stored config for ${characterId} is invalid (${result.errors.length} errors); ignoring`,
          );
        }
      }
    } catch (e) {
      console.warn(`[characterConfig] load ${characterId} threw:`, e instanceof Error ? e.message : e);
    }
  }
  configCache.set(characterId, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  return config;
}

let switchCache: { value: boolean; expiresAt: number } | null = null;

/**
 * game_settings.character_switch_enabled with ~60s cache. Missing column /
 * table / row ⇒ false (switching stays dev-only until the SQL is run).
 */
export async function isCharacterSwitchEnabled(): Promise<boolean> {
  if (switchCache && Date.now() < switchCache.expiresAt) return switchCache.value;
  let value = false;
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('game_settings')
        .select('character_switch_enabled')
        .limit(1)
        .maybeSingle();
      if (!error && data && typeof (data as Record<string, unknown>).character_switch_enabled === 'boolean') {
        value = (data as Record<string, unknown>).character_switch_enabled as boolean;
      }
    } catch {
      // default false
    }
  }
  switchCache = { value, expiresAt: Date.now() + SWITCH_TTL_MS };
  return value;
}
