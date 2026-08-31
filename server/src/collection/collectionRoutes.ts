/**
 * HTTP do Mundo de Coleta.
 *
 * Admin (Supabase JWT):
 *   - GET /api/admin/collection-world-config   → { config|null, tableMissing, tableSql? }
 *   - PUT /api/admin/collection-world-config   → { config }
 * Público (read-only, cacheado — o runtime do mapa lê ao entrar no mundo):
 *   - GET /api/collection-world-config         → { config|null }
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import {
  COLLECTION_CONFIG_ID,
  validateCollectionWorldConfig,
  type CollectionWorldConfig,
  type ResourceHurtbox,
} from '../shared/collection/CollectionShapes.js';
import {
  COLLECTION_TABLE_SQL,
  getCollectionConfig,
  getCollectionConfigCached,
  saveCollectionConfig,
} from './collectionRepository.js';

export const collectionAdminRouter = Router();
collectionAdminRouter.use(requireSupabaseAdmin);

collectionAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await getCollectionConfig();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    config: result.config,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    ...(result.tableMissing ? { tableSql: COLLECTION_TABLE_SQL } : {}),
  });
});

collectionAdminRouter.put('/', async (req: Request, res: Response) => {
  const validated = validateCollectionWorldConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'CollectionWorldConfig inválido', details: validated.errors });
    return;
  }
  const body = req.body as CollectionWorldConfig;
  // Cópia normalizada — campos desconhecidos nunca entram no jsonb.
  const config: CollectionWorldConfig = {
    configId: COLLECTION_CONFIG_ID,
    mineralCounts: Object.fromEntries(
      Object.entries(body.mineralCounts).map(([k, v]) => [k, Math.round(v)]),
    ),
    hurtboxes: Object.fromEntries(
      Object.entries(body.hurtboxes).map(([k, hb]) => [
        k,
        {
          offsetX: hb.offsetX,
          offsetY: hb.offsetY,
          width: hb.width,
          height: hb.height,
        } satisfies ResourceHurtbox,
      ]),
    ),
    // Campos opcionais novos (itens por quebra + cooldown de respawn).
    ...(body.dropCounts
      ? {
          dropCounts: Object.fromEntries(
            Object.entries(body.dropCounts).map(([k, v]) => [k, Math.round(v)]),
          ),
        }
      : {}),
    ...(body.respawnSeconds
      ? {
          respawnSeconds: Object.fromEntries(
            Object.entries(body.respawnSeconds).map(([k, v]) => [k, Math.round(v)]),
          ),
        }
      : {}),
    ...(body.fleeRadius
      ? {
          fleeRadius: Object.fromEntries(
            Object.entries(body.fleeRadius).map(([k, v]) => [k, Math.round(v)]),
          ),
        }
      : {}),
    ...(body.fleeSpeed
      ? {
          fleeSpeed: Object.fromEntries(
            Object.entries(body.fleeSpeed).map(([k, v]) => [k, Math.round(v)]),
          ),
        }
      : {}),
  };
  const result = await saveCollectionConfig(config);
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json({
        error: 'Tabela collection_world_config ausente no Supabase',
        tableMissing: true,
        tableSql: COLLECTION_TABLE_SQL,
      });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  res.json({ config });
});

/** Snapshot público read-only (cacheado 30s). */
export async function publicCollectionConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getCollectionConfigCached();
  res.json({ config });
}
