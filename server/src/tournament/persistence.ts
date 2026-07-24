import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Tournament } from './types.js';

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

export function isPersistenceAvailable(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function checkPersistenceHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getClient();
    const { error } = await client.from('swiss_tournaments').select('id').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function loadAllTestTournaments(): Promise<Tournament[]> {
  const client = getClient();
  const { data, error } = await client
    .from('swiss_tournaments')
    .select('*')
    .eq('is_test', true)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to load tournaments: ${error.message}`);
  return (data || []).map(row => row.data as Tournament);
}

export async function loadTournament(id: string): Promise<Tournament | null> {
  const client = getClient();
  const { data, error } = await client
    .from('swiss_tournaments')
    .select('data')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load tournament: ${error.message}`);
  if (!data) return null;
  return data.data as Tournament;
}

export async function saveTournamentToDb(tournament: Tournament, createdBy?: string, isTest = true): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('swiss_tournaments')
    .upsert({
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      is_test: isTest,
      data: tournament,
      created_by: createdBy || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) throw new Error(`Failed to save tournament: ${error.message}`);
}

export async function deleteTournamentFromDb(id: string): Promise<boolean> {
  const client = getClient();
  const { error } = await client
    .from('swiss_tournaments')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete tournament: ${error.message}`);
  return true;
}
