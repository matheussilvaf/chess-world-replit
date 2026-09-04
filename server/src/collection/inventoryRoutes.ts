/**
 * Inventário de coleta — HTTP (jogador autenticado; NÃO exige admin).
 *   - GET  /api/collection/inventory → { items, tableMissing, tableSql? }
 *   - POST /api/collection/collect   → { items } — incrementa totais.
 *     Body: { items: [{ itemKey, qty }] } (o cliente agrega e envia em lote).
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { INVENTORY_ITEM_KEYS, yieldItemKeyFor } from '../shared/collection/CollectionShapes.js';
import { INVENTORY_TABLE_SQL, addToInventory, getInventory } from './inventoryRepository.js';

export const collectionInventoryRouter = Router();
collectionInventoryRouter.use(requireSupabaseAuth);

/** Só chaves que podem existir numa pilha (o nó `hand_stone` rende `mineral:pedra`). */
const COLLECTIBLE = new Set(INVENTORY_ITEM_KEYS);

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
  const result = await addToInventory(
    userId,
    [...totals.entries()].map(([itemKey, qty]) => ({ itemKey, qty })),
  );
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json({
        error: 'Tabela collection_inventory ausente no Supabase',
        tableMissing: true,
        tableSql: INVENTORY_TABLE_SQL,
      });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  // POST /collect historicamente é consumido como snapshot, não como patch:
  // leia tudo depois do crédito para não fazer o cliente esquecer itens antigos.
  const snapshot = await getInventory(userId);
  if (snapshot.error) {
    res.status(500).json({ error: snapshot.error });
    return;
  }
  if (snapshot.tableMissing) {
    res.status(503).json({
      error: 'Tabela collection_inventory ausente no Supabase',
      tableMissing: true,
      tableSql: INVENTORY_TABLE_SQL,
    });
    return;
  }
  res.json({ items: snapshot.items });
});
