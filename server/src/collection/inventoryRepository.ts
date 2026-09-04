/**
 * Inventário autoritativo. IDs aceitos são todos os ids canônicos do
 * CraftShapes. As mutações são serializadas por usuário neste processo e
 * recusam qualquer saldo negativo.
 *
 * Limitação PostgREST: read/modify/upsert não é uma transação entre processos.
 * Para atomicidade distribuída seria necessário um RPC SQL com locks; esta fila
 * protege todas as superfícies deste servidor, mas não múltiplas instâncias.
 */
import { RESOURCE_YIELD_ITEM_KEYS, isYieldOnlyResourceKey, yieldItemKeyFor } from '../shared/collection/CollectionShapes.js';
import { applyToolWear, isToolItemKey } from '../shared/collection/ToolWear.js';
import { isInventoryItemId } from '../shared/craft/CraftShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const INVENTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS collection_inventory (
  user_id text NOT NULL,
  item_key text NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  durability integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);
ALTER TABLE collection_inventory ENABLE ROW LEVEL SECURITY;`;

/** Migração para tabelas criadas antes da durabilidade (NULL = cópia cheia). */
export const INVENTORY_DURABILITY_SQL = 'ALTER TABLE collection_inventory ADD COLUMN IF NOT EXISTS durability integer;';

export interface InventoryItem {
  itemKey: string;
  qty: number;
  /** Ferramentas: durabilidade restante da cópia em uso; ausente/null = cheia. */
  durability?: number | null;
}
export interface InventoryReadResult {
  items: InventoryItem[];
  tableMissing: boolean;
  /** Coluna `durability` ainda não migrada: o desgaste não persiste (barras ocultas no cliente). */
  durabilityColumnMissing?: boolean;
  error: string | null;
}
export interface InventoryWriteResult extends InventoryReadResult { ok: boolean; }

export interface ToolWearEntry { itemKey: string; hits: number; }
export interface ToolWearResult extends InventoryWriteResult {
  /** Cópias quebradas neste lote, por ferramenta. */
  broken: Array<{ itemKey: string; count: number }>;
}

// Coluna `durability` ausente (42703 no select / PGRST204 no upsert): lembrar
// por um tempo para não pagar duas consultas por leitura enquanto o admin não
// roda o ALTER TABLE; depois do prazo, tenta de novo sozinho.
const COLUMN_MISS_TTL_MS = 60_000;
let durabilityColumnMissingUntil = 0;
function isColumnMissing(code: string | undefined): boolean {
  return code === '42703' || code === 'PGRST204';
}
function hasDurabilityColumn(): boolean {
  return Date.now() >= durabilityColumnMissingUntil;
}
function markDurabilityColumnMissing(): void {
  durabilityColumnMissingUntil = Date.now() + COLUMN_MISS_TTL_MS;
}

const userQueues = new Map<string, Promise<void>>();
function serializeUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = userQueues.get(userId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const marker = run.then(() => undefined, () => undefined);
  userQueues.set(userId, marker);
  void marker.finally(() => { if (userQueues.get(userId) === marker) userQueues.delete(userId); });
  return run;
}

/**
 * Snapshot do inventário. Pilhas de chaves LEGADAS — nós que hoje rendem outro
 * item (`hand_stone` → `mineral:pedra`) e que já foram creditados como item —
 * são fundidas na pilha do item rendido na primeira leitura que as encontrar,
 * para nunca coexistirem duas "pedras" no inventário nem em receitas.
 */
export async function getInventory(userId: string): Promise<InventoryReadResult> {
  const read = await readInventory(userId);
  if (read.error || read.tableMissing) return read;
  if (!read.items.some(isLegacyStack)) return read;
  const merged = await mergeLegacyItems(userId);
  return merged ? readInventory(userId) : read;
}

/** Pilha de chave legada com saldo — só essas disparam a fusão (linhas zeradas são inertes). */
function isLegacyStack(item: InventoryItem): boolean {
  return isYieldOnlyResourceKey(item.itemKey) && item.qty > 0;
}

interface InventoryRow { item_key: unknown; qty: unknown; durability?: unknown }

function toItem(row: InventoryRow): InventoryItem {
  const item: InventoryItem = { itemKey: String(row.item_key), qty: Number(row.qty) || 0 };
  // Só ferramentas com saldo carregam durabilidade; null (cheia) fica implícito.
  if (isToolItemKey(item.itemKey) && item.qty > 0 && typeof row.durability === 'number' && Number.isFinite(row.durability)) {
    item.durability = row.durability;
  }
  return item;
}

async function readInventory(userId: string): Promise<InventoryReadResult> {
  const client = getServiceClient();
  if (!client) return { items: [], tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const select = (columns: string) => client.from('collection_inventory').select(columns).eq('user_id', userId).order('item_key');
  let withDurability = hasDurabilityColumn();
  let { data, error } = await select(withDurability ? 'item_key, qty, durability' : 'item_key, qty');
  if (error && withDurability && isColumnMissing(error.code)) {
    markDurabilityColumnMissing();
    withDurability = false;
    ({ data, error } = await select('item_key, qty'));
  }
  if (error) return isTableMissing(error.code)
    ? { items: [], tableMissing: true, error: null }
    : { items: [], tableMissing: false, error: error.message };
  return {
    // Linhas legadas zeradas (restos de uma fusão) nunca chegam ao cliente.
    items: ((data ?? []) as unknown as InventoryRow[])
      .map(toItem)
      .filter((item) => !(isYieldOnlyResourceKey(item.itemKey) && item.qty <= 0)),
    tableMissing: false,
    durabilityColumnMissing: !withDurability,
    error: null,
  };
}

/**
 * Move as pilhas legadas para o item rendido, serializado com as demais
 * mutações do usuário. A movimentação é UM único upsert (legada → 0, alvo +=
 * saldo): um INSERT … ON CONFLICT só, logo atômico — ou tudo entra ou nada
 * muda, sem janela de perda nem de crédito duplo. As linhas zeradas são
 * apagadas depois, em melhor esforço (se sobrar, é inerte). Retorna false se
 * nada mudou.
 */
function mergeLegacyItems(userId: string): Promise<boolean> {
  return serializeUser(userId, async () => {
    const client = getServiceClient();
    if (!client) return false;
    const legacyKeys = Object.keys(RESOURCE_YIELD_ITEM_KEYS);
    const { data, error } = await client.from('collection_inventory').select('item_key, qty').eq('user_id', userId).in('item_key', legacyKeys);
    if (error) {
      console.warn('[inventory] falha ao ler pilhas legadas:', error.message);
      return false;
    }
    const legacyRows = (data ?? [])
      .map((r) => ({ itemKey: String(r.item_key), qty: Number(r.qty) || 0 }))
      .filter((row) => row.qty > 0);
    if (legacyRows.length === 0) return false;
    const credits = new Map<string, number>();
    for (const row of legacyRows) {
      const target = yieldItemKeyFor(row.itemKey);
      credits.set(target, (credits.get(target) ?? 0) + row.qty);
    }
    const targets = [...credits.keys()];
    const { data: currentRows, error: readError } = await client.from('collection_inventory').select('item_key, qty').eq('user_id', userId).in('item_key', targets);
    if (readError) {
      console.warn('[inventory] falha ao ler pilhas de destino da fusão:', readError.message);
      return false;
    }
    const current = new Map((currentRows ?? []).map((r) => [String(r.item_key), Number(r.qty) || 0]));
    const updatedAt = new Date().toISOString();
    const rows = [
      ...legacyRows.map((row) => ({ user_id: userId, item_key: row.itemKey, qty: 0, updated_at: updatedAt })),
      ...targets.map((itemKey) => ({
        user_id: userId,
        item_key: itemKey,
        qty: (current.get(itemKey) ?? 0) + (credits.get(itemKey) ?? 0),
        updated_at: updatedAt,
      })),
    ];
    const { error: writeError } = await client.from('collection_inventory').upsert(rows, { onConflict: 'user_id,item_key' });
    if (writeError) {
      console.warn('[inventory] fusão de pilhas legadas falhou (nada mudou):', writeError.message);
      return false;
    }
    console.info(`[inventory] pilhas legadas fundidas user=${userId} ${JSON.stringify([...credits])}`);
    const { error: cleanupError } = await client.from('collection_inventory').delete().eq('user_id', userId).in('item_key', legacyRows.map((r) => r.itemKey)).eq('qty', 0);
    if (cleanupError) console.warn('[inventory] limpeza das linhas legadas zeradas falhou (inerte):', cleanupError.message);
    return true;
  });
}

/** Applies positive and negative deltas as one serialized inventory operation. */
export async function applyInventoryDeltas(userId: string, deltas: InventoryItem[]): Promise<InventoryWriteResult> {
  return serializeUser(userId, async () => {
    const totals = new Map<string, number>();
    for (const delta of deltas) {
      // Chave de NÓ legada (hand_stone) vira o item rendido; só itens de inventário sofrem delta.
      const itemKey = typeof delta?.itemKey === 'string' ? yieldItemKeyFor(delta.itemKey) : '';
      if (!isInventoryItemId(itemKey) || !Number.isSafeInteger(delta.qty) || delta.qty === 0) {
        return { ok: false, items: [], tableMissing: false, error: 'Delta de inventário inválido' };
      }
      totals.set(itemKey, (totals.get(itemKey) ?? 0) + delta.qty);
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
    const rows: { user_id: string; item_key: string; qty: number; durability?: null; updated_at: string }[] = [];
    for (const [itemKey, delta] of totals) {
      const qty = (current.get(itemKey) ?? 0) + delta;
      if (!Number.isSafeInteger(qty) || qty < 0) return { ok: false, items: [], tableMissing: false, error: `Saldo insuficiente: ${itemKey}` };
      const row: (typeof rows)[number] = { user_id: userId, item_key: itemKey, qty, updated_at: new Date().toISOString() };
      // Pilha de ferramenta zerada (gasta numa receita / solta no chão): a
      // durabilidade da cópia em uso morre com ela — a próxima cópia nasce cheia.
      if (qty === 0 && isToolItemKey(itemKey) && hasDurabilityColumn()) row.durability = null;
      rows.push(row);
    }
    let { error: writeError } = await client.from('collection_inventory').upsert(rows, { onConflict: 'user_id,item_key' });
    if (writeError && isColumnMissing(writeError.code) && rows.some((r) => 'durability' in r)) {
      markDurabilityColumnMissing();
      for (const row of rows) delete row.durability;
      ({ error: writeError } = await client.from('collection_inventory').upsert(rows, { onConflict: 'user_id,item_key' }));
    }
    if (writeError) return isTableMissing(writeError.code)
      ? { ok: false, items: [], tableMissing: true, error: null }
      : { ok: false, items: [], tableMissing: false, error: writeError.message };
    return { ok: true, items: rows.map((r) => ({ itemKey: r.item_key, qty: r.qty })), tableMissing: false, error: null };
  });
}

/**
 * Desgaste de ferramentas (golpes que conectaram no Mundo de Coleta), em lote
 * agregado pelo cliente. Autoritativo: a durabilidade restante vive na linha
 * da pilha; ao zerar, a cópia quebra (qty − 1) e a próxima nasce cheia — ver
 * applyToolWear. `maxDurabilityFor` resolve o máximo configurado no admin.
 * Sem a coluna migrada, nada é gravado e o chamador recebe
 * `durabilityColumnMissing` para mostrar o SQL ao administrador.
 */
export async function wearTools(
  userId: string,
  wear: ToolWearEntry[],
  maxDurabilityFor: (itemKey: string) => number,
): Promise<ToolWearResult> {
  return serializeUser(userId, async () => {
    const fail = (partial: Partial<ToolWearResult>): ToolWearResult => ({
      ok: false, items: [], tableMissing: false, broken: [], error: null, ...partial,
    });
    const totals = new Map<string, number>();
    for (const entry of wear) {
      const itemKey = entry?.itemKey;
      if (!isToolItemKey(itemKey) || !isInventoryItemId(itemKey) || !Number.isSafeInteger(entry.hits) || entry.hits <= 0) {
        return fail({ error: 'Desgaste de ferramenta inválido' });
      }
      totals.set(itemKey, (totals.get(itemKey) ?? 0) + entry.hits);
    }
    if (totals.size === 0) return { ok: true, items: [], tableMissing: false, broken: [], error: null };
    if (!hasDurabilityColumn()) return fail({ durabilityColumnMissing: true });
    const client = getServiceClient();
    if (!client) return fail({ error: PERSISTENCE_UNAVAILABLE });
    const keys = [...totals.keys()];
    const { data, error } = await client.from('collection_inventory').select('item_key, qty, durability').eq('user_id', userId).in('item_key', keys);
    if (error) {
      if (isColumnMissing(error.code)) {
        markDurabilityColumnMissing();
        return fail({ durabilityColumnMissing: true });
      }
      return isTableMissing(error.code) ? fail({ tableMissing: true }) : fail({ error: error.message });
    }
    const current = new Map(
      ((data ?? []) as unknown as InventoryRow[]).map((r) => [
        String(r.item_key),
        { qty: Number(r.qty) || 0, remaining: typeof r.durability === 'number' ? r.durability : null },
      ]),
    );
    const updatedAt = new Date().toISOString();
    const rows: { user_id: string; item_key: string; qty: number; durability: number | null; updated_at: string }[] = [];
    const broken: ToolWearResult['broken'] = [];
    for (const [itemKey, hits] of totals) {
      const stack = current.get(itemKey);
      if (!stack || stack.qty <= 0) continue; // sem cópia na pilha (cliente defasado): nada a gastar
      const next = applyToolWear(stack, hits, maxDurabilityFor(itemKey));
      rows.push({ user_id: userId, item_key: itemKey, qty: next.qty, durability: next.remaining, updated_at: updatedAt });
      if (next.broken > 0) broken.push({ itemKey, count: next.broken });
    }
    if (rows.length > 0) {
      const { error: writeError } = await client.from('collection_inventory').upsert(rows, { onConflict: 'user_id,item_key' });
      if (writeError) {
        if (isColumnMissing(writeError.code)) {
          markDurabilityColumnMissing();
          return fail({ durabilityColumnMissing: true });
        }
        return isTableMissing(writeError.code) ? fail({ tableMissing: true }) : fail({ error: writeError.message });
      }
    }
    return {
      ok: true,
      items: rows.map((r) => ({ itemKey: r.item_key, qty: r.qty, durability: r.qty > 0 ? r.durability : null })),
      tableMissing: false,
      broken,
      error: null,
    };
  });
}

export function addToInventory(userId: string, adds: InventoryItem[]): Promise<InventoryWriteResult> {
  return applyInventoryDeltas(userId, adds);
}
export function consumeFromInventory(userId: string, items: InventoryItem[]): Promise<InventoryWriteResult> {
  return applyInventoryDeltas(userId, items.map((item) => ({ ...item, qty: -item.qty })));
}