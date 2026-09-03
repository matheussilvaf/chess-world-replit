/**
 * Inventário autoritativo. IDs aceitos são todos os ids canônicos do
 * CraftShapes. As mutações são serializadas por usuário neste processo e
 * recusam qualquer saldo negativo.
 *
 * Limitação PostgREST: read/modify/upsert não é uma transação entre processos.
 * Para atomicidade distribuída seria necessário um RPC SQL com locks; esta fila
 * protege todas as superfícies deste servidor, mas não múltiplas instâncias.
 */
import { classifyCraftEntityId } from '../shared/craft/CraftShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const INVENTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS collection_inventory (
  user_id text NOT NULL,
  item_key text NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);
ALTER TABLE collection_inventory ENABLE ROW LEVEL SECURITY;`;

export interface InventoryItem { itemKey: string; qty: number; }
export interface InventoryReadResult { items: InventoryItem[]; tableMissing: boolean; error: string | null; }
export interface InventoryWriteResult extends InventoryReadResult { ok: boolean; }

const userQueues = new Map<string, Promise<void>>();
function serializeUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = userQueues.get(userId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const marker = run.then(() => undefined, () => undefined);
  userQueues.set(userId, marker);
  void marker.finally(() => { if (userQueues.get(userId) === marker) userQueues.delete(userId); });
  return run;
}

export async function getInventory(userId: string): Promise<InventoryReadResult> {
  const client = getServiceClient();
  if (!client) return { items: [], tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client.from('collection_inventory').select('item_key, qty').eq('user_id', userId).order('item_key');
  if (error) return isTableMissing(error.code)
    ? { items: [], tableMissing: true, error: null }
    : { items: [], tableMissing: false, error: error.message };
  return { items: (data ?? []).map((r) => ({ itemKey: String(r.item_key), qty: Number(r.qty) || 0 })), tableMissing: false, error: null };
}

/** Applies positive and negative deltas as one serialized inventory operation. */
export async function applyInventoryDeltas(userId: string, deltas: InventoryItem[]): Promise<InventoryWriteResult> {
  return serializeUser(userId, async () => {
    const totals = new Map<string, number>();
    for (const delta of deltas) {
      if (!delta || classifyCraftEntityId(delta.itemKey) === null || !Number.isSafeInteger(delta.qty) || delta.qty === 0) {
        return { ok: false, items: [], tableMissing: false, error: 'Delta de inventário inválido' };
      }
      totals.set(delta.itemKey, (totals.get(delta.itemKey) ?? 0) + delta.qty);
    }
    const keys = [...totals.keys()];
    if (keys.length === 0) return { ok: true, items: [], tableMissing: false, error: null };
    const client = getServiceClient();
    if (!client) return { ok: false, items: [], tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
    const { data, error } = await client.from('collection_inventory').select('item_key, qty').eq('user_id', userId).in('item_key', keys);
    if (error) return isTableMissing(error.code)
      ? { ok: false, items: [], tableMissing: true, error: null }
      : { ok: false, items: [], tableMissing: false, error: error.message };
    const current = new Map((data ?? []).map((r) => [String(r.item_key), Number(r.qty) || 0]));
    const rows: { user_id: string; item_key: string; qty: number; updated_at: string }[] = [];
    for (const [itemKey, delta] of totals) {
      const qty = (current.get(itemKey) ?? 0) + delta;
      if (!Number.isSafeInteger(qty) || qty < 0) return { ok: false, items: [], tableMissing: false, error: `Saldo insuficiente: ${itemKey}` };
      rows.push({ user_id: userId, item_key: itemKey, qty, updated_at: new Date().toISOString() });
    }
    const { error: writeError } = await client.from('collection_inventory').upsert(rows, { onConflict: 'user_id,item_key' });
    if (writeError) return isTableMissing(writeError.code)
      ? { ok: false, items: [], tableMissing: true, error: null }
      : { ok: false, items: [], tableMissing: false, error: writeError.message };
    return { ok: true, items: rows.map((r) => ({ itemKey: r.item_key, qty: r.qty })), tableMissing: false, error: null };
  });
}

export function addToInventory(userId: string, adds: InventoryItem[]): Promise<InventoryWriteResult> {
  return applyInventoryDeltas(userId, adds);
}
export function consumeFromInventory(userId: string, items: InventoryItem[]): Promise<InventoryWriteResult> {
  return applyInventoryDeltas(userId, items.map((item) => ({ ...item, qty: -item.qty })));
}