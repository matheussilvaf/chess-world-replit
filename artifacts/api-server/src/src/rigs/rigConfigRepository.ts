/**
 * RigConfigRepository — server-side persistence for rig configs.
 *
 * Storage: Supabase table `rig_configs` (rig_id text PK, config jsonb,
 * updated_at). Accessed ONLY with the service-role client — the table has RLS
 * enabled with no policies, so game clients can never write (or even read)
 * it directly; all access goes through the HTTP routes in ./routes.ts.
 *
 * Table creation is a manual, operator-run migration (PostgREST cannot run
 * DDL). Until the SQL below is executed the repository reports
 * `tableMissing: true` (Postgres 42P01 / PostgREST PGRST205) and writes fail
 * loudly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_RIG_ID,
  defaultRigConfig,
  validateRigConfig,
  type RigConfig,
} from '../shared/combat/RigShapes.js';

export const RIG_TABLE_SQL = `CREATE TABLE IF NOT EXISTS rig_configs (
  rig_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rig_configs ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

let supabase: SupabaseClient | null = null;
let unavailableLogged = false;

function getClient(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!unavailableLogged) {
      console.warn('[rigConfig] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — rig configs unavailable');
      unavailableLogged = true;
    }
    return null;
  }
  supabase = createClient(url, key);
  return supabase;
}

interface RigRow {
  rig_id: string;
  config: unknown;
  updated_at?: string;
}

export interface RigListResult {
  rigs: RigConfig[];
  /** rig_id → updated_at (ISO) for the UI's "última data de salvamento". */
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  /** Persistence unavailable (missing env) or query failure. */
  error: string | null;
  /** IDs whose stored JSON failed strict validation (skipped, never silently "fixed"). */
  invalidIds: string[];
}

export interface RigWriteResult {
  ok: boolean;
  tableMissing: boolean;
  conflict: boolean;
  error: string | null;
}

function isTableMissing(code: string | undefined): boolean {
  // 42P01: Postgres "relation does not exist" (raw SQL paths).
  // PGRST205: PostgREST "table not in schema cache" — what the REST API
  // actually returns for a missing table.
  return code === '42P01' || code === 'PGRST205';
}

// ------------------------------------------------------------ public read cache
// Game clients hit GET /api/rigs/:rigId on every rig-carrying spawn; cache
// like characterConfigService (30s staleness after an editor save is fine).

interface CacheEntry {
  config: RigConfig | null;
  expiresAt: number;
}
const readCache = new Map<string, CacheEntry>();

function invalidateCache(rigId: string): void {
  readCache.delete(rigId);
}

// ------------------------------------------------------------ operations

/**
 * List every rig, validating each stored config. Seeds the default rig
 * (time-elements-humanoid-v1) when the table exists but has no rows, so the
 * initial rig always exists (spec §3). When the table is missing, returns the
 * in-memory default so the editor can render — saves still fail loudly until
 * the operator runs RIG_TABLE_SQL.
 */
export async function listRigs(): Promise<RigListResult> {
  const client = getClient();
  if (!client) {
    return {
      rigs: [defaultRigConfig()],
      updatedAt: {},
      tableMissing: false,
      error: 'Persistência não configurada (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes)',
      invalidIds: [],
    };
  }

  const { data, error } = await client.from('rig_configs').select('rig_id, config, updated_at').order('rig_id');
  if (error) {
    if (isTableMissing(error.code)) {
      return { rigs: [defaultRigConfig()], updatedAt: {}, tableMissing: true, error: null, invalidIds: [] };
    }
    return { rigs: [], updatedAt: {}, tableMissing: false, error: error.message, invalidIds: [] };
  }

  const rigs: RigConfig[] = [];
  const updatedAt: Record<string, string> = {};
  const invalidIds: string[] = [];
  for (const row of (data ?? []) as RigRow[]) {
    const result = validateRigConfig(row.config);
    if (result.ok) {
      rigs.push(result.config);
      if (row.updated_at) updatedAt[result.config.rigId] = row.updated_at;
    } else {
      console.warn(`[rigConfig] stored rig "${row.rig_id}" is invalid (${result.errors.length} errors); skipping`);
      invalidIds.push(row.rig_id);
    }
  }

  // Seed the initial rig once the table exists and is truly empty.
  if (rigs.length === 0 && invalidIds.length === 0) {
    const seed = defaultRigConfig();
    const write = await saveRig(seed, { mustNotExist: true });
    if (write.ok) {
      rigs.push(seed);
      updatedAt[seed.rigId] = new Date().toISOString();
      console.log(`[rigConfig] seeded default rig "${DEFAULT_RIG_ID}"`);
    } else if (!write.conflict) {
      return { rigs: [seed], updatedAt: {}, tableMissing: write.tableMissing, error: write.error, invalidIds };
    }
  }

  return { rigs, updatedAt, tableMissing: false, error: null, invalidIds };
}

export interface RigGetResult {
  rig: RigConfig | null;
  tableMissing: boolean;
  error: string | null;
}

/** Fresh (uncached) read — used by the admin editor. */
export async function getRig(rigId: string): Promise<RigGetResult> {
  const client = getClient();
  if (!client) {
    return {
      rig: rigId === DEFAULT_RIG_ID ? defaultRigConfig() : null,
      tableMissing: false,
      error: 'Persistência não configurada',
    };
  }
  const { data, error } = await client.from('rig_configs').select('config').eq('rig_id', rigId).maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) {
      return { rig: rigId === DEFAULT_RIG_ID ? defaultRigConfig() : null, tableMissing: true, error: null };
    }
    return { rig: null, tableMissing: false, error: error.message };
  }
  if (!data?.config) return { rig: null, tableMissing: false, error: null };
  const result = validateRigConfig(data.config);
  if (!result.ok) {
    return { rig: null, tableMissing: false, error: `Config salva inválida: ${result.errors.slice(0, 3).join('; ')}` };
  }
  return { rig: result.config, tableMissing: false, error: null };
}

/**
 * Cached read for game clients (public read-only route). Missing table or
 * invalid stored JSON resolve to null (no boxes) — never a crash.
 */
export async function getRigCached(rigId: string): Promise<RigConfig | null> {
  const cached = readCache.get(rigId);
  if (cached && Date.now() < cached.expiresAt) return cached.config;
  const { rig } = await getRig(rigId);
  readCache.set(rigId, { config: rig, expiresAt: Date.now() + CACHE_TTL_MS });
  return rig;
}

/** Insert (mustNotExist) or upsert a rig. Config must already be validated. */
export async function saveRig(config: RigConfig, opts: { mustNotExist?: boolean } = {}): Promise<RigWriteResult> {
  const client = getClient();
  if (!client) {
    return { ok: false, tableMissing: false, conflict: false, error: 'Persistência não configurada' };
  }
  const row = { rig_id: config.rigId, config, updated_at: new Date().toISOString() };
  const query = opts.mustNotExist
    ? client.from('rig_configs').insert(row)
    : client.from('rig_configs').upsert(row, { onConflict: 'rig_id' });
  const { error } = await query;
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, conflict: false, error: null };
    if (error.code === '23505') return { ok: false, tableMissing: false, conflict: true, error: null };
    return { ok: false, tableMissing: false, conflict: false, error: error.message };
  }
  invalidateCache(config.rigId);
  return { ok: true, tableMissing: false, conflict: false, error: null };
}

export async function deleteRig(rigId: string): Promise<RigWriteResult> {
  const client = getClient();
  if (!client) {
    return { ok: false, tableMissing: false, conflict: false, error: 'Persistência não configurada' };
  }
  const { error } = await client.from('rig_configs').delete().eq('rig_id', rigId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, conflict: false, error: null };
    return { ok: false, tableMissing: false, conflict: false, error: error.message };
  }
  invalidateCache(rigId);
  return { ok: true, tableMissing: false, conflict: false, error: null };
}
