/**
 * PlayerCharacterRepository — personagem jogável persistente (1 por usuário).
 *
 * Storage: tabela Supabase `player_characters` (user_id uuid PK, class_id,
 * appearance jsonb, equipped_weapon), service-role only — mesmo padrão de
 * craft_items/asset_categories. O WorldRoom carrega no join e o HTTP
 * (/api/me/character) cria/consulta; a arma equipada é atualizada pela sala.
 */
import {
  validatePlayerCharacterConfig,
  type PlayerCharacterConfigV1,
} from '../shared/characters/PlayerCharacterShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const PLAYER_CHARACTER_TABLE_SQL = `CREATE TABLE IF NOT EXISTS player_characters (
  user_id uuid PRIMARY KEY,
  class_id text NOT NULL,
  appearance jsonb NOT NULL,
  equipped_weapon text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_characters ENABLE ROW LEVEL SECURITY;`;

/** Sessões anônimas usam o sessionId do Colyseus como id — nunca vai ao banco. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PlayerCharacterRow {
  user_id: string;
  class_id: string;
  appearance: unknown;
  equipped_weapon: string | null;
}

export interface PlayerCharacterGetResult {
  config: PlayerCharacterConfigV1 | null;
  tableMissing: boolean;
  error: string | null;
}

export interface PlayerCharacterWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

function rowToConfig(row: PlayerCharacterRow): PlayerCharacterConfigV1 | null {
  const validated = validatePlayerCharacterConfig({
    v: 1,
    classId: row.class_id,
    appearance: row.appearance,
    equippedWeapon: row.equipped_weapon,
  });
  if (!validated.ok) {
    console.warn(`[characters] personagem salvo de ${row.user_id} é inválido; ignorando: ${validated.errors[0]}`);
    return null;
  }
  return validated.config;
}

export async function getPlayerCharacter(userId: string): Promise<PlayerCharacterGetResult> {
  const client = getServiceClient();
  if (!client) return { config: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  if (!UUID_RE.test(userId)) return { config: null, tableMissing: false, error: null };
  const { data, error } = await client
    .from('player_characters')
    .select('user_id, class_id, appearance, equipped_weapon')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { config: null, tableMissing: true, error: null };
    return { config: null, tableMissing: false, error: error.message };
  }
  if (!data) return { config: null, tableMissing: false, error: null };
  return { config: rowToConfig(data as PlayerCharacterRow), tableMissing: false, error: null };
}

export async function savePlayerCharacter(
  userId: string,
  config: PlayerCharacterConfigV1,
): Promise<PlayerCharacterWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  if (!UUID_RE.test(userId)) return { ok: false, tableMissing: false, error: 'userId não é um UUID' };
  const row = {
    user_id: userId,
    class_id: config.classId,
    appearance: config.appearance,
    equipped_weapon: config.equippedWeapon,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('player_characters').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  return { ok: true, tableMissing: false, error: null };
}

/** Persiste só a arma equipada (chamado pela sala; a criação usa savePlayerCharacter). */
export async function savePlayerEquippedWeapon(
  userId: string,
  ref: string | null,
): Promise<PlayerCharacterWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  if (!UUID_RE.test(userId)) return { ok: false, tableMissing: false, error: 'userId não é um UUID' };
  const { error } = await client
    .from('player_characters')
    .update({ equipped_weapon: ref, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  return { ok: true, tableMissing: false, error: null };
}
