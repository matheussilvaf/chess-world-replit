/**
 * Inventário de coleta — HTTP (jogador autenticado; NÃO exige admin).
 *   - GET  /api/collection/inventory → { items, tableMissing, tableSql?,
 *                                        durabilityColumnMissing?, durabilitySql? }
 *   - POST /api/collection/collect   → { items } — incrementa totais.
 *     Body: { items: [{ itemKey, qty }] } (o cliente agrega e envia em lote).
 *   - POST /api/collection/tool-wear → { items, broken } — desgaste de
 *     ferramentas. Body: { wear: [{ itemKey, hits }], requestId? } (lote
 *     agregado; cada golpe que conectou = 1). Ao zerar a durabilidade a cópia
 *     quebra. `requestId` torna o lote idempotente: a mesma conta reenviando o
 *     mesmo id (resposta perdida, retry) NÃO gasta de novo — recebe o snapshot
 *     atual e as quebras do lote original.
 *
 * Itens de ferramenta carregam `durability` (restante da cópia em uso; ausente
 * = cheia) quando a coluna existe; sem ela o servidor devolve o SQL da migração.
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { INVENTORY_ITEM_KEYS, yieldItemKeyFor } from '../shared/collection/CollectionShapes.js';
import { TOOL_WEAR_MAX_ENTRIES, TOOL_WEAR_MAX_HITS_PER_ENTRY, isToolItemKey } from '../shared/collection/ToolWear.js';
import { parseWeaponRef } from '../shared/characters/PlayerCharacterShapes.js';
import { DEFAULT_TOOL_DURABILITY, getWeaponVariantTool, type WeaponFamilyConfig } from '../shared/combat/WeaponShapes.js';
import { isInventoryItemId } from '../shared/craft/CraftShapes.js';
import { getWeaponFamiliesCached } from '../rigs/weaponFamilyRepository.js';
import { AppliedRequests } from './appliedRequests.js';
import { progressService } from '../progress/progressService.js';
import {
  INVENTORY_DURABILITY_SQL,
  INVENTORY_TABLE_SQL,
  addToInventory,
  getInventory,
  wearTools,
  type InventoryReadResult,
  type ToolWearResult,
} from './inventoryRepository.js';

export const collectionInventoryRouter = Router();
collectionInventoryRouter.use(requireSupabaseAuth);

/** Só chaves que podem existir numa pilha (o nó `hand_stone` rende `mineral:pedra`). */
const COLLECTIBLE = new Set(INVENTORY_ITEM_KEYS);

const TABLE_MISSING_BODY = {
  error: 'Tabela collection_inventory ausente no Supabase',
  tableMissing: true,
  tableSql: INVENTORY_TABLE_SQL,
};
const COLUMN_MISSING_BODY = {
  error: 'Coluna durability ausente em collection_inventory (durabilidade de ferramentas)',
  durabilityColumnMissing: true,
  durabilitySql: INVENTORY_DURABILITY_SQL,
};

/**
 * Idempotência do desgaste por conta+requestId: a fila do cliente re-tenta com
 * backoff até 60 s; 10 min de memória cobrem essa janela com folga.
 */
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const appliedWear = new AppliedRequests<ToolWearResult>({
  ttlMs: 10 * 60_000,
  maxEntries: 5000,
  isSuccess: (result) => result.ok,
});

/** Campos de aviso da migração de durabilidade, anexados a qualquer snapshot. */
function durabilityFlags(read: InventoryReadResult) {
  return read.durabilityColumnMissing ? { durabilityColumnMissing: true, durabilitySql: INVENTORY_DURABILITY_SQL } : {};
}

/** Durabilidade máxima configurada no admin para uma ref de ferramenta (padrão 100). */
export function toolMaxDurability(families: Record<string, WeaponFamilyConfig>, itemKey: string): number {
  const parsed = parseWeaponRef(itemKey);
  if (!parsed || parsed.category !== 'crafttools') return DEFAULT_TOOL_DURABILITY;
  const durability = getWeaponVariantTool(families[parsed.familyId] ?? null, parsed.variantId ?? 'default')?.durability;
  return typeof durability === 'number' && Number.isFinite(durability) && durability >= 1 ? Math.floor(durability) : DEFAULT_TOOL_DURABILITY;
}

collectionInventoryRouter.get('/inventory', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId as string;
  const result = await getInventory(userId);
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    items: result.items,
    tableMissing: result.tableMissing,
    ...(result.tableMissing ? { tableSql: INVENTORY_TABLE_SQL } : {}),
    ...durabilityFlags(result),
  });
});

collectionInventoryRouter.post('/collect', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId as string;
  const body = req.body as { items?: Array<{ itemKey?: unknown; qty?: unknown }> };
  if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > 40) {
    res.status(400).json({ error: 'items: lista de 1 a 40 entradas' });
    return;
  }
  // Agrega por chave e valida contra o conjunto conhecido. Clientes antigos
  // ainda mandam a chave do NÓ (hand_stone): credita o item rendido.
  const totals = new Map<string, number>();
  for (const it of body.items) {
    const key = yieldItemKeyFor(String(it?.itemKey ?? ''));
    const qty = Number(it?.qty);
    if (!COLLECTIBLE.has(key)) {
      res.status(400).json({ error: `itemKey desconhecido: ${key}` });
      return;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      res.status(400).json({ error: `qty inválida para ${key} (inteiro 1..99)` });
      return;
    }
    totals.set(key, (totals.get(key) ?? 0) + qty);
  }
  const collected = [...totals.entries()].map(([itemKey, qty]) => ({ itemKey, qty }));
  const result = await addToInventory(userId, collected);
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json(TABLE_MISSING_BODY);
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  // Comida (badge `food`) colhida do chão dá XP de culinária — fora do caminho crítico.
  progressService.recordPickup(userId, collected).catch((error: unknown) => {
    console.warn(`[collect] XP de coleta não registrado: ${error instanceof Error ? error.message : String(error)}`);
  });
  // POST /collect historicamente é consumido como snapshot, não como patch:
  // leia tudo depois do crédito para não fazer o cliente esquecer itens antigos.
  const snapshot = await getInventory(userId);
  if (snapshot.error) {
    res.status(500).json({ error: snapshot.error });
    return;
  }
  if (snapshot.tableMissing) {
    res.status(503).json(TABLE_MISSING_BODY);
    return;
  }
  res.json({ items: snapshot.items, ...durabilityFlags(snapshot) });
});

collectionInventoryRouter.post('/tool-wear', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId as string;
  const body = req.body as { wear?: Array<{ itemKey?: unknown; hits?: unknown }>; requestId?: unknown };
  if (!Array.isArray(body?.wear) || body.wear.length === 0 || body.wear.length > TOOL_WEAR_MAX_ENTRIES) {
    res.status(400).json({ error: `wear: lista de 1 a ${TOOL_WEAR_MAX_ENTRIES} entradas` });
    return;
  }
  if (body.requestId !== undefined && !(typeof body.requestId === 'string' && REQUEST_ID_RE.test(body.requestId))) {
    res.status(400).json({ error: 'requestId inválido (1..64 caracteres [A-Za-z0-9_-])' });
    return;
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : null;
  const totals = new Map<string, number>();
  for (const entry of body.wear) {
    const itemKey = entry?.itemKey;
    const hits = Number(entry?.hits);
    if (!isToolItemKey(itemKey) || !isInventoryItemId(itemKey)) {
      res.status(400).json({ error: `itemKey não é uma ferramenta: ${String(itemKey)}` });
      return;
    }
    if (!Number.isInteger(hits) || hits < 1 || hits > TOOL_WEAR_MAX_HITS_PER_ENTRY) {
      res.status(400).json({ error: `hits inválido para ${itemKey} (inteiro 1..${TOOL_WEAR_MAX_HITS_PER_ENTRY})` });
      return;
    }
    totals.set(itemKey, (totals.get(itemKey) ?? 0) + hits);
  }
  const result = await appliedWear.run(requestId ? `${userId}:${requestId}` : null, async () => {
    const families = await getWeaponFamiliesCached();
    return wearTools(
      userId,
      [...totals.entries()].map(([itemKey, hits]) => ({ itemKey, hits })),
      (itemKey) => toolMaxDurability(families, itemKey),
    );
  });
  if (!result.ok) {
    if (result.durabilityColumnMissing) {
      res.status(503).json(COLUMN_MISSING_BODY);
      return;
    }
    if (result.tableMissing) {
      res.status(503).json(TABLE_MISSING_BODY);
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir o desgaste' });
    return;
  }
  // Snapshot completo (como o /collect): o cliente substitui os totais e a durabilidade.
  const snapshot = await getInventory(userId);
  if (snapshot.error) {
    res.status(500).json({ error: snapshot.error });
    return;
  }
  if (snapshot.tableMissing) {
    res.status(503).json(TABLE_MISSING_BODY);
    return;
  }
  res.json({ items: snapshot.items, broken: result.broken, ...durabilityFlags(snapshot) });
});
