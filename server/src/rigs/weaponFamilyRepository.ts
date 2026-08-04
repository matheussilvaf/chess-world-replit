/**
 * WeaponFamilyRepository — persistent weapon-family catalog (spec §7).
 *
 * Storage: Supabase table `weapon_families` (family_id text PK, config jsonb,
 * updated_at), service-role only. A row exists ONLY for families the admin
 * explicitly configured (display name / profile association). Family + variant
 * DISCOVERY is dynamic (generator manifest scan on the client) and is never
 * persisted here — new PNGs need zero code or data changes.
 *
 * The server cannot scan the PNGs itself (assets ship with the web app, not
 * with the Colyseus server), so familyId values are validated by FORMAT only.
 */
import {
  validateWeaponFamilyConfig,
  type WeaponFamilyConfig,
} from '../shared/combat/WeaponShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from './serviceSupabase.js';

export const WEAPON_FAMILY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS weapon_families (
  family_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE weapon_families ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

interface FamilyRow {
  family_id: string;
  config: unknown;
  updated_at?: string;
}

export interface FamilyListResult {
  families: Record<string, WeaponFamilyConfig>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  error: string | null;
  invalidIds: string[];
}

export interface FamilyWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

export async function listWeaponFamilies(): Promise<FamilyListResult> {
  const client = getServiceClient();
  if (!client) {
    return { families: {}, updatedAt: {}, tableMissing: false, error: PERSISTENCE_UNAVAILABLE, invalidIds: [] };
  }
  const { data, error } = await client
    .from('weapon_families')
    .select('family_id, config, updated_at')
    .order('family_id');
  if (error) {
    if (isTableMissing(error.code)) {
      return { families: {}, updatedAt: {}, tableMissing: true, error: null, invalidIds: [] };
    }
    return { families: {}, updatedAt: {}, tableMissing: false, error: error.message, invalidIds: [] };
  }

  const families: Record<string, WeaponFamilyConfig> = {};
  const updatedAt: Record<string, string> = {};
  const invalidIds: string[] = [];
  for (const row of (data ?? []) as FamilyRow[]) {
    const result = validateWeaponFamilyConfig(row.config);
    if (result.ok && result.config.familyId === row.family_id) {
      families[row.family_id] = result.config;
      if (row.updated_at) updatedAt[row.family_id] = row.updated_at;
    } else {
      console.warn(`[weapons] stored family "${row.family_id}" is invalid; skipping`);
      invalidIds.push(row.family_id);
    }
  }
  return { families, updatedAt, tableMissing: false, error: null, invalidIds };
}

// Cached association map for the public runtime route (30s staleness is fine).
let familiesCache: { map: Record<string, WeaponFamilyConfig>; expiresAt: number } | null = null;

export function invalidateFamiliesCache(): void {
  familiesCache = null;
}

/** Cached familyId → config map for game clients. Errors resolve to {}. */
export async function getWeaponFamiliesCached(): Promise<Record<string, WeaponFamilyConfig>> {
  if (familiesCache && Date.now() < familiesCache.expiresAt) return familiesCache.map;
  const result = await listWeaponFamilies();
  const map = result.error ? {} : result.families;
  familiesCache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
  return map;
}

/** Upsert one family row (validation happens at the route). */
export async function saveWeaponFamily(config: WeaponFamilyConfig): Promise<FamilyWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { family_id: config.familyId, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('weapon_families').upsert(row, { onConflict: 'family_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateFamiliesCache();
  return { ok: true, tableMissing: false, error: null };
}
