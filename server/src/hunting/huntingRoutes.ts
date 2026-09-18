import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import { defaultHuntingConfig, parseHuntingConfig } from '../shared/hunting/HuntingShapes.js';
import { HUNTING_CONFIG_TABLE_SQL, getHuntingConfig, getHuntingConfigCached, saveHuntingConfig } from './huntingConfigRepository.js';
import { PLAYER_HUNTING_TABLE_SQL } from './playerHuntingRepository.js';

export const huntingAdminRouter = Router();
huntingAdminRouter.use(requireSupabaseAdmin);

huntingAdminRouter.get('/', async (_req, res) => {
  const result = await getHuntingConfig();
  if (result.error) return void res.status(500).json({ error: result.error });
  res.json({
    config: result.config ?? defaultHuntingConfig(),
    saved: result.config !== null,
    tableMissing: result.tableMissing,
    tableSql: HUNTING_CONFIG_TABLE_SQL,
    playerTableSql: PLAYER_HUNTING_TABLE_SQL,
  });
});

huntingAdminRouter.put('/', async (req: Request, res: Response) => {
  const config = parseHuntingConfig(req.body);
  const result = await saveHuntingConfig(config);
  if (!result.ok) {
    if (result.tableMissing) return void res.status(503).json({ error: 'Tabela hunting_config ausente no Supabase', tableSql: HUNTING_CONFIG_TABLE_SQL });
    return void res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
  }
  res.json({ config, saved: true });
});

export async function publicHuntingConfigHandler(_req: Request, res: Response): Promise<void> {
  res.json({ config: await getHuntingConfigCached() });
}