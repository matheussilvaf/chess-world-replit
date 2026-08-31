/**
 * Inventário de coleta — itens que o jogador coletou no Mundo de Coleta.
 *
 * Storage: Supabase `collection_inventory` (user_id, item_key, qty, updated_at,
 * PK composto), service-role only — mesmo padrão de collection_world_config.
 * Fase de teste: o incremento confia no cliente (a validação server-authoritative
 * de coleta virá junto com as regras de ferramentas).
 */
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const INVENTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS collection_inventory (
  user_id text NOT NULL,
  item_key text NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);
ALTER TABLE collection_inventory ENABLE ROW LEVEL SECURITY;`;

export interface InventoryItem {
  itemKey: string;
  qty: number;
}

export interface InventoryReadResult {
  items: InventoryItem[];
  tableMissing: boolean;
  error: string | null;
}

export interface InventoryWriteResult {
  ok: boolean;
  /** Totais atualizados apenas das chaves incrementadas. */
  items: InventoryItem[];
  tableMissing: boolean;
  error: string | null;
}

export async function getInventory(userId: string): Promise<InventoryReadResult> {
  const client = getServiceClient();
  if (!client) return { items: [], tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client
    .from('collection_inventory')
    .select('item_key, qty')
    .eq('user_id', userId)
    .order('item_key');
  if (error) {
    if (isTableMissing(error.code)) return { items: [], tableMissing: true, error: null };
    return { items: [], tableMissing: false, error: error.message };
  }
  return {
    items: (data ?? []).map((r) => ({ itemKey: String(r.item_key), qty: Number(r.qty) || 0 })),
    tableMissing: false,
    error: null,
  };
}

/**
 * Incrementa quantidades (lê o total atual e grava a soma). Não é atômico
 * entre requisições concorrentes do mesmo usuário — suficiente na fase de
 * teste; a coleta autoritativa mudará isso.
 */
export async function addToInventory(
  userId: string,
  adds: InventoryItem[],
): Promise<InventoryWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, items: [], tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const keys = adds.map((a) => a.itemKey);
  const { data, error } = await client
    .from('collection_inventory')
    .select('item_key, qty')
    .eq('user_id', userId)
    .in('item_key', keys);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, items: [], tableMissing: true, error: null };
    return { ok: false, items: [], tableMissing: false, error: error.message };
  }
  const current = new Map((data ?? []).map((r) => [String(r.item_key), Number(r.qty) || 0]));
  const now = new Date().toISOString();
  const rows = adds.map((a) => ({
    user_id: userId,
    item_key: a.itemKey,
    qty: (current.get(a.itemKey) ?? 0) + a.qty,
    updated_at: now,
  }));
  const { error: upsertError } = await client
    .from('collection_inventory')
    .upsert(rows, { onConflict: 'user_id,item_key' });
  if (upsertError) {
    if (isTableMissing(upsertError.code)) return { ok: false, items: [], tableMissing: true, error: null };
    return { ok: false, items: [], tableMissing: false, error: upsertError.message };
  }
  return {
    ok: true,
    items: rows.map((r) => ({ itemKey: r.item_key, qty: r.qty })),
    tableMissing: false,
    error: null,
  };
}
