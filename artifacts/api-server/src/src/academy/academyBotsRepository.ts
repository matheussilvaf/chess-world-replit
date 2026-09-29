import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';
import { mergeAcademyBots, type AcademyBot } from '../shared/academy/AcademyShapes.js';

let cache: { bots: AcademyBot[]; schemaMissing: boolean; expires: number } | null = null;

export async function getBots(): Promise<{ bots: AcademyBot[]; schemaMissing: boolean }> {
  if (cache && cache.expires > Date.now()) return { bots: cache.bots, schemaMissing: cache.schemaMissing };
  const client = getServiceClient();
  if (!client) throw new Error(PERSISTENCE_UNAVAILABLE);
  const { data, error } = await client.from('academy_bots').select('id,name,level');
  if (error && !isTableMissing(error.code)) throw new Error(error.message);
  const value = { bots: mergeAcademyBots(error ? [] : (data ?? []) as AcademyBot[]), schemaMissing: !!error };
  cache = { ...value, expires: Date.now() + 30_000 };
  return value;
}

export async function saveBots(bots: AcademyBot[]): Promise<{ ok: boolean; error: string | null; schemaMissing: boolean }> {
  const client = getServiceClient();
  if (!client) return { ok: false, error: PERSISTENCE_UNAVAILABLE, schemaMissing: false };
  const { error } = await client.from('academy_bots').upsert(bots.map(({ id, name, level }) => ({ id, name, level, updated_at: new Date().toISOString() })));
  if (error) return { ok: false, error: error.message, schemaMissing: isTableMissing(error.code) };
  cache = null;
  return { ok: true, error: null, schemaMissing: false };
}