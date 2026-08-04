/**
 * Shared service-role Supabase access for the weapon catalog repositories.
 * Same access model as rigConfigRepository: tables have RLS enabled with NO
 * policies, so ONLY the service-role key (never game clients) can touch them.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let unavailableLogged = false;

export function getServiceClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!unavailableLogged) {
      console.warn('[weapons] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — weapon catalog unavailable');
      unavailableLogged = true;
    }
    return null;
  }
  client = createClient(url, key);
  return client;
}

export function isTableMissing(code: string | undefined): boolean {
  // 42P01: Postgres "relation does not exist"; PGRST205: PostgREST missing
  // table in schema cache (what the REST API actually returns).
  return code === '42P01' || code === 'PGRST205';
}

export const PERSISTENCE_UNAVAILABLE = 'Persistência não configurada (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes)';
