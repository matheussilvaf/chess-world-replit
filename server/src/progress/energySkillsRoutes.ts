/**
 * HTTP de energia + habilidades.
 *
 * Admin (Supabase JWT):
 *   - GET /api/admin/energy-skills-config → { config, updatedAt, tableMissing, tableSql?, progressTableSql }
 *   - PUT /api/admin/energy-skills-config → { config }
 * Jogador autenticado (não-admin):
 *   - GET  /api/progress/me       → ProgressSnapshot
 *   - POST /api/progress/activity → ProgressSnapshot — body { events, requestId }
 *     (lote agregado de golpes/nós vindos do mapa; `requestId` obrigatório e
 *     idempotente; o serviço ainda aplica um teto de eventos por minuto).
 * Público (read-only, cacheado):
 *   - GET /api/energy-skills-config → { config } (o HUD lê limiares/velocidade).
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin, requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { AppliedRequests } from '../collection/appliedRequests.js';
import { parseActivityEvents, parseEnergySkillsConfig, type ProgressSnapshot } from '../shared/progress/EnergySkillsShapes.js';
import {
  ENERGY_SKILLS_TABLE_SQL,
  getEnergySkillsConfig,
  getEnergySkillsConfigCached,
  saveEnergySkillsConfig,
} from './energySkillsRepository.js';
import { PLAYER_PROGRESS_TABLE_SQL } from './playerProgressRepository.js';
import { progressService } from './progressService.js';

// ------------------------------------------------------------------- admin

export const energySkillsAdminRouter = Router();
energySkillsAdminRouter.use(requireSupabaseAdmin);

energySkillsAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await getEnergySkillsConfig();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    config: result.config,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    ...(result.tableMissing ? { tableSql: ENERGY_SKILLS_TABLE_SQL } : {}),
    progressTableSql: PLAYER_PROGRESS_TABLE_SQL,
  });
});

energySkillsAdminRouter.put('/', async (req: Request, res: Response) => {
  const parsed = parseEnergySkillsConfig(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: 'Configuração de energia/habilidades inválida', details: parsed.errors });
    return;
  }
  const result = await saveEnergySkillsConfig(parsed.config);
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json({ error: 'Tabela energy_skills_config ausente no Supabase', tableMissing: true, tableSql: ENERGY_SKILLS_TABLE_SQL });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  res.json({ config: parsed.config });
});

// ----------------------------------------------------------------- jogador

export const progressRouter = Router();
progressRouter.use(requireSupabaseAuth);

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const appliedActivity = new AppliedRequests<ProgressSnapshot>({
  ttlMs: 10 * 60_000,
  maxEntries: 5_000,
  isSuccess: () => true,
});

progressRouter.get('/me', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId as string;
  res.json(await progressService.getSnapshot(userId));
});

progressRouter.post('/activity', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId as string;
  const body = req.body as { events?: unknown; requestId?: unknown };
  const parsed = parseActivityEvents(body?.events);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  // requestId obrigatório: o lote é idempotente (retry do cliente não conta duas vezes).
  const requestId = typeof body?.requestId === 'string' && REQUEST_ID_RE.test(body.requestId) ? body.requestId : null;
  if (!requestId) {
    res.status(400).json({ error: 'requestId obrigatório (1..64 caracteres [A-Za-z0-9_-])' });
    return;
  }
  const snapshot = await appliedActivity.run(`${userId}:${requestId}`, () => progressService.applyActivity(userId, parsed.events));
  res.json(snapshot);
});

// ----------------------------------------------------------------- público

export async function publicEnergySkillsConfigHandler(_req: Request, res: Response): Promise<void> {
  res.json({ config: await getEnergySkillsConfigCached() });
}
