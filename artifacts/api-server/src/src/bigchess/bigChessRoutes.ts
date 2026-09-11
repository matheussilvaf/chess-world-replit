/**
 * HTTP do Big Chess Board.
 *
 * Admin (Supabase JWT):
 *   - GET /api/admin/bigchess-config → { config, saved, updatedAt, tableMissing, tableSql?, tablesSql }
 *   - PUT /api/admin/bigchess-config → { config }
 * Jogador autenticado:
 *   - GET /api/me/wallet → { crowns, tableMissing }
 * Público (read-only, cacheado 30 s):
 *   - GET /api/bigchess-config → { config } (o cliente mostra benefícios/regras nos cards).
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin, requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { DEFAULT_BIGCHESS_CONFIG, parseBigChessConfig } from '../shared/bigchess/BigChessShapes.js';
import {
  BIGCHESS_CONFIG_TABLE_SQL,
  BIGCHESS_TABLES_SQL,
  getBigChessConfig,
  getBigChessConfigCached,
  getWallet,
  saveBigChessConfig,
} from './bigChessRepository.js';

// ------------------------------------------------------------------- admin

export const bigChessAdminRouter = Router();
bigChessAdminRouter.use(requireSupabaseAdmin);

bigChessAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await getBigChessConfig();
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  // Sem tabela/linha: a página edita os DEFAULTS (que o jogo já usa). `saved: false` avisa.
  res.json({
    config: result.config ?? DEFAULT_BIGCHESS_CONFIG,
    saved: result.config !== null,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    ...(result.tableMissing ? { tableSql: BIGCHESS_CONFIG_TABLE_SQL } : {}),
    tablesSql: BIGCHESS_TABLES_SQL,
  });
});

bigChessAdminRouter.put('/', async (req: Request, res: Response) => {
  const parsed = parseBigChessConfig(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: 'Configuração do Big Chess Board inválida', details: parsed.errors });
    return;
  }
  const result = await saveBigChessConfig(parsed.config);
  if (!result.ok) {
    if (result.tableMissing) {
      res.status(503).json({ error: 'Tabela bigchess_config ausente no Supabase', tableMissing: true, tableSql: BIGCHESS_CONFIG_TABLE_SQL });
      return;
    }
    res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
    return;
  }
  res.json({ config: parsed.config });
});

// ----------------------------------------------------------------- jogador

export const walletRouter = Router();
walletRouter.use(requireSupabaseAuth);

walletRouter.get('/', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId as string;
  const result = await getWallet(userId);
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({ crowns: result.crowns, tableMissing: result.tableMissing });
});

// ----------------------------------------------------------------- público

export async function publicBigChessConfigHandler(_req: Request, res: Response): Promise<void> {
  res.json({ config: await getBigChessConfigCached() });
}
