/**
 * HTTP de Rating (Glicko-2) + Gambits e do "Chess Matches Database".
 *
 * Admin (Supabase JWT, admin):
 *   - GET  /api/admin/rating-config            → { config, saved, updatedAt, tableMissing, tableSql?, schemaReady, migrationSql }
 *   - PUT  /api/admin/rating-config            → { config }
 *   - POST /api/admin/rating-config/reset-all  → { count } (todos os jogadores ao estado inicial)
 *   - GET  /api/admin/chess-matches?page&player&result&kind&status&from&to
 *                                              → MatchListResult (20 por página)
 * Público (read-only, cacheado):
 *   - GET /api/rating-config → { config } (o cliente usa os limiares de "provisório").
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import { DEFAULT_RATING_GAMBITS_CONFIG, parseRatingGambitsConfig } from '../shared/rating/RatingShapes.js';
import { listMatchesForAdmin, type MatchListFilters } from './matchRepository.js';
import {
  RATING_CONFIG_TABLE_SQL,
  RATING_MIGRATION_SQL,
  getRatingConfig,
  getRatingConfigCached,
  saveRatingConfig,
} from './ratingConfigRepository.js';
import { ratingSchemaReady, resetAllRatings } from './ratingRepository.js';

export const ratingAdminRouter = Router();
ratingAdminRouter.use(requireSupabaseAdmin);

ratingAdminRouter.get('/', async (_req: Request, res: Response) => {
  const [result, schema] = await Promise.all([getRatingConfig(), ratingSchemaReady()]);
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({
    config: result.config ?? DEFAULT_RATING_GAMBITS_CONFIG,
    saved: result.config !== null,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    ...(result.tableMissing ? { tableSql: RATING_CONFIG_TABLE_SQL } : {}),
    schemaReady: schema.ready,
    schemaError: schema.error,
    migrationSql: RATING_MIGRATION_SQL,
  });
});

ratingAdminRouter.put('/', async (req: Request, res: Response) => {
  const parsed = parseRatingGambitsConfig(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: 'Configuração de rating/gambits inválida', details: parsed.errors });
    return;
  }
  const result = await saveRatingConfig(parsed.config);
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json({ error: 'Tabela chess_rating_config ausente no Supabase', tableMissing: true, tableSql: RATING_MIGRATION_SQL });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  res.json({ config: parsed.config });
});

ratingAdminRouter.post('/reset-all', async (_req: Request, res: Response) => {
  const config = await getRatingConfigCached();
  const result = await resetAllRatings({
    rating: config.rating.initialRating,
    ratingDeviation: config.rating.initialRatingDeviation,
    volatility: config.rating.initialVolatility,
  });
  if (!result.ok) {
    if (result.schemaMissing) {
      res.status(503).json({ error: 'Colunas de rating ausentes em profiles — rode a migração', tableMissing: true, tableSql: RATING_MIGRATION_SQL });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao resetar' });
    return;
  }
  console.log(`[rating] reset em massa: ${result.count} perfis → ${config.rating.initialRating}/${config.rating.initialRatingDeviation}/${config.rating.initialVolatility}`);
  res.json({ count: result.count });
});

// -------------------------------------------------------- matches database

export const chessMatchesAdminRouter = Router();
chessMatchesAdminRouter.use(requireSupabaseAdmin);

const str = (value: unknown, max = 120): string => (typeof value === 'string' ? value.slice(0, max) : '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

chessMatchesAdminRouter.get('/', async (req: Request, res: Response) => {
  const pageRaw = Number(req.query.page);
  const kindRaw = str(req.query.kind);
  const statusRaw = str(req.query.status);
  const from = str(req.query.from, 10);
  const to = str(req.query.to, 10);
  const filters: MatchListFilters = {
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    player: str(req.query.player, 80),
    result: str(req.query.result, 32),
    kind: kindRaw === 'plaza' || kindRaw === 'tournament' ? kindRaw : 'all',
    status: statusRaw === 'playing' || statusRaw === 'finished' ? statusRaw : 'all',
    from: DATE_RE.test(from) ? from : '',
    to: DATE_RE.test(to) ? to : '',
  };
  const result = await listMatchesForAdmin(filters);
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ------------------------------------------------------------------ público

let publicCache: { body: string; expiresAt: number } | null = null;

export async function publicRatingConfigHandler(_req: Request, res: Response): Promise<void> {
  if (!publicCache || Date.now() >= publicCache.expiresAt) {
    const config = await getRatingConfigCached();
    publicCache = { body: JSON.stringify({ config }), expiresAt: Date.now() + 30_000 };
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.type('application/json').send(publicCache.body);
}
