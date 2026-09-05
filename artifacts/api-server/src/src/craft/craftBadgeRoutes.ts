/**
 * Badges dos itens de craft (admin — Supabase JWT):
 *   - GET /api/admin/craft-badges          → { badges, tableMissing, tableSql? }
 *   - PUT /api/admin/craft-badges/:itemId  → body { badges: string[] } (vazia = remove)
 * O público lê as badges dentro de GET /api/craft-data (craftRoutes).
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import { isBadgeableItemId, normalizeCraftBadges } from '../shared/craft/CraftBadges.js';
import { CRAFT_BADGES_TABLE_SQL, listCraftBadges, saveCraftBadges } from './craftBadgeRepository.js';

export const craftBadgesAdminRouter = Router();
craftBadgesAdminRouter.use(requireSupabaseAdmin);

craftBadgesAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listCraftBadges();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    badges: result.records,
    tableMissing: result.tableMissing,
    ...(result.tableMissing ? { tableSql: CRAFT_BADGES_TABLE_SQL } : {}),
  });
});

craftBadgesAdminRouter.put('/:itemId', async (req: Request, res: Response) => {
  const itemId = req.params.itemId;
  if (!isBadgeableItemId(itemId)) {
    res.status(400).json({ error: 'itemId não é um item da página de receitas' });
    return;
  }
  const body = req.body as { badges?: unknown };
  const normalized = normalizeCraftBadges(body?.badges ?? []);
  if (!normalized.ok) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  const result = await saveCraftBadges(itemId, normalized.badges);
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json({ error: 'Tabela craft_item_badges ausente no Supabase', tableMissing: true, tableSql: CRAFT_BADGES_TABLE_SQL });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  res.json({ itemId, badges: normalized.badges });
});
