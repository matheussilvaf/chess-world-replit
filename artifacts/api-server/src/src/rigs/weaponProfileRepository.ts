/**
 * WeaponProfileRepository — persistence for WeaponHitboxProfiles (spec §6).
 *
 * Storage: Supabase table `weapon_hitbox_profiles` (profile_id text PK,
 * config jsonb, updated_at), service-role only — same model as rig_configs.
 * Profiles carry hitboxes + damage; the server (Colyseus) remains the damage
 * authority and reads profiles ONLY through this repository, never trusting
 * client-sent profile data.
 */
import {
  validateWeaponHitboxProfile,
  type WeaponHitboxProfile,
} from '../shared/combat/WeaponShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from './serviceSupabase.js';

export const WEAPON_PROFILE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS weapon_hitbox_profiles (
  profile_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE weapon_hitbox_profiles ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

interface ProfileRow {
  profile_id: string;
  config: unknown;
  updated_at?: string;
}

export interface ProfileListResult {
  profiles: WeaponHitboxProfile[];
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  error: string | null;
  invalidIds: string[];
}

export interface ProfileGetResult {
  profile: WeaponHitboxProfile | null;
  tableMissing: boolean;
  error: string | null;
}

export interface ProfileWriteResult {
  ok: boolean;
  tableMissing: boolean;
  conflict: boolean;
  error: string | null;
}

export async function listWeaponProfiles(): Promise<ProfileListResult> {
  const client = getServiceClient();
  if (!client) {
    return { profiles: [], updatedAt: {}, tableMissing: false, error: PERSISTENCE_UNAVAILABLE, invalidIds: [] };
  }
  const { data, error } = await client
    .from('weapon_hitbox_profiles')
    .select('profile_id, config, updated_at')
    .order('profile_id');
  if (error) {
    if (isTableMissing(error.code)) {
      return { profiles: [], updatedAt: {}, tableMissing: true, error: null, invalidIds: [] };
    }
    return { profiles: [], updatedAt: {}, tableMissing: false, error: error.message, invalidIds: [] };
  }

  const profiles: WeaponHitboxProfile[] = [];
  const updatedAt: Record<string, string> = {};
  const invalidIds: string[] = [];
  for (const row of (data ?? []) as ProfileRow[]) {
    // Structural validation only — the owning rig may live in another table.
    const result = validateWeaponHitboxProfile(row.config);
    if (result.ok && result.config.id === row.profile_id) {
      profiles.push(result.config);
      if (row.updated_at) updatedAt[row.profile_id] = row.updated_at;
    } else {
      console.warn(`[weapons] stored profile "${row.profile_id}" is invalid; skipping`);
      invalidIds.push(row.profile_id);
    }
  }
  return { profiles, updatedAt, tableMissing: false, error: null, invalidIds };
}

/** Fresh (uncached) read — used by the admin editor and delete checks. */
export async function getWeaponProfile(profileId: string): Promise<ProfileGetResult> {
  const client = getServiceClient();
  if (!client) return { profile: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client
    .from('weapon_hitbox_profiles')
    .select('config')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { profile: null, tableMissing: true, error: null };
    return { profile: null, tableMissing: false, error: error.message };
  }
  if (!data?.config) return { profile: null, tableMissing: false, error: null };
  const result = validateWeaponHitboxProfile(data.config);
  if (!result.ok) {
    return { profile: null, tableMissing: false, error: `Perfil salvo inválido: ${result.errors.slice(0, 3).join('; ')}` };
  }
  return { profile: result.config, tableMissing: false, error: null };
}

// ------------------------------------------------------------ public read cache

interface CacheEntry {
  profile: WeaponHitboxProfile | null;
  expiresAt: number;
}
const readCache = new Map<string, CacheEntry>();

function invalidateProfileCache(profileId: string): void {
  readCache.delete(profileId);
}

/**
 * Cached read for game clients / combat resolution. Missing table or invalid
 * stored JSON resolve to null (no hitbox, no damage) — never a crash.
 */
export async function getWeaponProfileCached(profileId: string): Promise<WeaponHitboxProfile | null> {
  const cached = readCache.get(profileId);
  if (cached && Date.now() < cached.expiresAt) return cached.profile;
  const { profile } = await getWeaponProfile(profileId);
  readCache.set(profileId, { profile, expiresAt: Date.now() + CACHE_TTL_MS });
  return profile;
}

/** Insert (mustNotExist) or upsert a profile. Config must already be validated. */
export async function saveWeaponProfile(
  config: WeaponHitboxProfile,
  opts: { mustNotExist?: boolean } = {},
): Promise<ProfileWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, conflict: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { profile_id: config.id, config, updated_at: new Date().toISOString() };
  const query = opts.mustNotExist
    ? client.from('weapon_hitbox_profiles').insert(row)
    : client.from('weapon_hitbox_profiles').upsert(row, { onConflict: 'profile_id' });
  const { error } = await query;
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, conflict: false, error: null };
    if (error.code === '23505') return { ok: false, tableMissing: false, conflict: true, error: null };
    return { ok: false, tableMissing: false, conflict: false, error: error.message };
  }
  invalidateProfileCache(config.id);
  return { ok: true, tableMissing: false, conflict: false, error: null };
}

export async function deleteWeaponProfile(profileId: string): Promise<ProfileWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, conflict: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('weapon_hitbox_profiles').delete().eq('profile_id', profileId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, conflict: false, error: null };
    return { ok: false, tableMissing: false, conflict: false, error: error.message };
  }
  invalidateProfileCache(profileId);
  return { ok: true, tableMissing: false, conflict: false, error: null };
}
