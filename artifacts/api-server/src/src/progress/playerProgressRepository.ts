/**
 * Progresso persistido do jogador: energia atual, XP total por habilidade e
 * contadores de golpes (para custos "a cada N golpes").
 *
 * Storage: Supabase `player_progress` (user_id uuid PK, energy int, skills
 * jsonb, counters jsonb, updated_at), service-role only. Linha ausente =
 * jogador novo (energia cheia, XP zero). Tabela ausente é tolerada: o
 * progressService segue em memória e o admin recebe o SQL.
 */
import { SKILL_IDS, type SkillId } from '../shared/progress/EnergySkillsShapes.js';
import { UUID_RE } from '../characters/playerCharacterRepository.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const PLAYER_PROGRESS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS player_progress (
  user_id uuid PRIMARY KEY,
  energy integer NOT NULL,
  skills jsonb NOT NULL DEFAULT '{}'::jsonb,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_progress ENABLE ROW LEVEL SECURITY;`;

export interface PlayerProgressRecord {
  /** Energia atual (o teto é a config global; pode estar acima após o admin baixar o máximo — o serviço limita). */
  energy: number;
  /** skillId → XP total. */
  skills: Partial<Record<SkillId, number>>;
  /** Contadores de golpes ainda não cobrados (ex.: `tool:pickaxe`, `creature`). */
  counters: Record<string, number>;
}

export interface PlayerProgressReadResult {
  record: PlayerProgressRecord | null;
  tableMissing: boolean;
  error: string | null;
}

export interface PlayerProgressWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

interface ProgressRow {
  user_id: string;
  energy: number;
  skills: unknown;
  counters: unknown;
}

function sanitizeNumberMap(input: unknown, allowKey: (key: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!allowKey(key) || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue;
    out[key] = Math.floor(raw);
  }
  return out;
}

export function isPersistableUserId(userId: string): boolean {
  return UUID_RE.test(userId);
}

export async function getPlayerProgress(userId: string): Promise<PlayerProgressReadResult> {
  const client = getServiceClient();
  if (!client) return { record: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  if (!isPersistableUserId(userId)) return { record: null, tableMissing: false, error: null };
  const { data, error } = await client
    .from('player_progress')
    .select('user_id, energy, skills, counters')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { record: null, tableMissing: true, error: null };
    return { record: null, tableMissing: false, error: error.message };
  }
  if (!data) return { record: null, tableMissing: false, error: null };
  const row = data as ProgressRow;
  return {
    record: {
      energy: Number.isFinite(row.energy) ? Math.max(0, Math.floor(row.energy)) : 0,
      skills: sanitizeNumberMap(row.skills, (key) => (SKILL_IDS as readonly string[]).includes(key)),
      counters: sanitizeNumberMap(row.counters, (key) => /^[a-z_]+(:[a-z0-9_:-]+)?$/.test(key)),
    },
    tableMissing: false,
    error: null,
  };
}

export async function savePlayerProgress(userId: string, record: PlayerProgressRecord): Promise<PlayerProgressWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  if (!isPersistableUserId(userId)) return { ok: false, tableMissing: false, error: 'userId não persistível' };
  const row = {
    user_id: userId,
    energy: Math.max(0, Math.floor(record.energy)),
    skills: record.skills,
    counters: record.counters,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('player_progress').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  return { ok: true, tableMissing: false, error: null };
}
