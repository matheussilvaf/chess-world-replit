import {
  PLAYER_HUNTING_TABLE_SQL,
  type PlayerHuntingActive,
  type PlayerHuntingRecord,
} from '../shared/hunting/HuntingShapes.js';
import { getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';
import { UUID_RE } from '../characters/playerCharacterRepository.js';

export { PLAYER_HUNTING_TABLE_SQL };
const fallback = new Map<string, PlayerHuntingRecord>();
const empty = (): PlayerHuntingRecord => ({ active: null, locks: {} });
let warnedMemoryMode = false;

function warnMemoryMode(): void {
  if (warnedMemoryMode) return;
  warnedMemoryMode = true;
  console.warn('[hunting] tabela player_hunting ausente; contratos estão somente em memória');
}

function normalizeActive(value: unknown): PlayerHuntingActive | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<PlayerHuntingActive>;
  if (typeof v.contractId !== 'string' || typeof v.variantId !== 'string' || typeof v.region !== 'string') return null;
  if (![v.quantity, v.killed, v.acceptedAt, v.deadline].every(Number.isFinite)) return null;
  return {
    contractId: v.contractId, variantId: v.variantId, region: v.region,
    quantity: Math.max(1, Math.floor(v.quantity!)), killed: Math.max(0, Math.floor(v.killed!)),
    acceptedAt: v.acceptedAt!, deadline: v.deadline!,
  };
}

function normalizeLocks(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) out[key] = raw;
  }
  return out;
}

export async function getPlayerHunting(userId: string): Promise<{ record: PlayerHuntingRecord; tableMissing: boolean; error: string | null }> {
  if (!UUID_RE.test(userId)) {
    warnMemoryMode();
    return { record: fallback.get(userId) ?? empty(), tableMissing: true, error: null };
  }
  const client = getServiceClient();
  if (!client) {
    warnMemoryMode();
    return { record: fallback.get(userId) ?? empty(), tableMissing: true, error: null };
  }
  const { data, error } = await client.from('player_hunting').select('active, locks').eq('user_id', userId).maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) {
      warnMemoryMode();
      return { record: fallback.get(userId) ?? empty(), tableMissing: true, error: null };
    }
    return { record: fallback.get(userId) ?? empty(), tableMissing: false, error: error.message };
  }
  const record = data ? { active: normalizeActive(data.active), locks: normalizeLocks(data.locks) } : empty();
  fallback.set(userId, record);
  return { record, tableMissing: false, error: null };
}

export async function upsertPlayerHunting(userId: string, record: PlayerHuntingRecord): Promise<{ ok: boolean; tableMissing: boolean; error: string | null }> {
  fallback.set(userId, { active: record.active ? { ...record.active } : null, locks: { ...record.locks } });
  if (!UUID_RE.test(userId)) {
    warnMemoryMode();
    return { ok: true, tableMissing: true, error: null };
  }
  const client = getServiceClient();
  if (!client) {
    warnMemoryMode();
    return { ok: true, tableMissing: true, error: null };
  }
  const { error } = await client.from('player_hunting').upsert(
    { user_id: userId, active: record.active, locks: record.locks, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) {
    if (isTableMissing(error.code)) {
      warnMemoryMode();
      return { ok: true, tableMissing: true, error: null };
    }
    return { ok: false, tableMissing: false, error: error.message };
  }
  return { ok: true, tableMissing: false, error: null };
}

export interface PlayerHuntingCasResult {
  ok: boolean;
  matched: boolean;
  tableMissing: boolean;
  error: string | null;
}

/** Compare-and-set on the active contract identity. */
export async function updateIfActiveMatches(
  userId: string,
  expectedContractId: string | null,
  record: PlayerHuntingRecord,
): Promise<PlayerHuntingCasResult> {
  const current = fallback.get(userId) ?? empty();
  const currentId = current.active?.contractId ?? null;
  if (!UUID_RE.test(userId)) {
    warnMemoryMode();
    if (currentId !== expectedContractId) return { ok: true, matched: false, tableMissing: true, error: null };
    fallback.set(userId, { active: record.active ? { ...record.active } : null, locks: { ...record.locks } });
    return { ok: true, matched: true, tableMissing: true, error: null };
  }
  const client = getServiceClient();
  if (!client) {
    warnMemoryMode();
    if (currentId !== expectedContractId) return { ok: true, matched: false, tableMissing: true, error: null };
    fallback.set(userId, { active: record.active ? { ...record.active } : null, locks: { ...record.locks } });
    return { ok: true, matched: true, tableMissing: true, error: null };
  }

  const inserted = await client.from('player_hunting').insert({
    user_id: userId, active: null, locks: {}, updated_at: new Date().toISOString(),
  });
  if (inserted.error && inserted.error.code !== '23505') {
    if (isTableMissing(inserted.error.code)) {
      warnMemoryMode();
      if (currentId !== expectedContractId) return { ok: true, matched: false, tableMissing: true, error: null };
      fallback.set(userId, { active: record.active ? { ...record.active } : null, locks: { ...record.locks } });
      return { ok: true, matched: true, tableMissing: true, error: null };
    }
    return { ok: false, matched: false, tableMissing: false, error: inserted.error.message };
  }

  let query = client.from('player_hunting').update({
    active: record.active, locks: record.locks, updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  query = expectedContractId === null
    ? query.is('active', null)
    : query.eq('active->>contractId', expectedContractId);
  const { data, error } = await query.select('user_id');
  if (error) {
    if (isTableMissing(error.code)) {
      warnMemoryMode();
      if (currentId !== expectedContractId) return { ok: true, matched: false, tableMissing: true, error: null };
      fallback.set(userId, { active: record.active ? { ...record.active } : null, locks: { ...record.locks } });
      return { ok: true, matched: true, tableMissing: true, error: null };
    }
    return { ok: false, matched: false, tableMissing: false, error: error.message };
  }
  const matched = Array.isArray(data) && data.length === 1;
  if (matched) fallback.set(userId, { active: record.active ? { ...record.active } : null, locks: { ...record.locks } });
  return { ok: true, matched, tableMissing: false, error: null };
}