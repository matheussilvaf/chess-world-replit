import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin, requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { ACADEMY_BOT_IDS, BOT_NAME_MAX_LEN, isAcademyBotId, isBotLevel, type AcademyBot, type AcademyBotsUpdateRequest } from '../shared/academy/AcademyShapes.js';
import { getBots, saveBots } from './academyBotsRepository.js';
import { listBotGamesForUser } from './botGamesRepository.js';

export const academyRouter = Router();
export const academyAdminRouter = Router();

academyRouter.get('/bots', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'public, max-age=30');
    res.json(await getBots());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

academyAdminRouter.use(requireSupabaseAdmin);
academyAdminRouter.put('/bots', async (req: Request, res: Response) => {
  const input = req.body as Partial<AcademyBotsUpdateRequest> | undefined;
  const bots = input?.bots;
  if (!Array.isArray(bots) || bots.length !== ACADEMY_BOT_IDS.length ||
    new Set(bots.map((bot) => bot?.id)).size !== ACADEMY_BOT_IDS.length ||
    !bots.every((bot) => bot && isAcademyBotId(bot.id) && typeof bot.name === 'string' &&
      bot.name.trim().length >= 1 && bot.name.trim().length <= BOT_NAME_MAX_LEN && isBotLevel(bot.level))) {
    res.status(400).json({ error: 'Informe os quatro bots, com nomes de 1 a 20 caracteres e níveis de 1 a 4.' });
    return;
  }
  const cleaned: AcademyBot[] = bots.map((bot) => ({ id: bot.id, name: bot.name.trim(), level: bot.level }));
  const saved = await saveBots(cleaned);
  if (!saved.ok) {
    res.status(saved.schemaMissing ? 503 : 500).json(saved);
    return;
  }
  res.json({ bots: cleaned, schemaMissing: false });
});

academyRouter.get('/bot-games/me', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    res.json(await listBotGamesForUser((req as Request & { userId: string }).userId, 50));
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});