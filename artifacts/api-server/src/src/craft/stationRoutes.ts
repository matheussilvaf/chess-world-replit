/**
 * Estações de criação — HTTP surface (spec: /admin/stations).
 *
 * Admin (Supabase JWT de admin):
 *   - GET /api/admin/craft-stations                → estações mescladas + vínculos
 *   - PUT /api/admin/craft-stations/members/:itemId → { stationId | null }
 *   - PUT /api/admin/craft-stations/:stationId      → StationConfig completo
 * Public (read-only, cacheado — o painel de estação do jogo lê daqui):
 *   - GET /api/craft-stations-data                  → { stations, members }
 *
 * Só as 4 estações fixas existem (STATION_IDS); PUT em outro id é 404.
 * Referência pendurada em rows (item que trocou de estação) é tolerada no
 * jsonb e filtrada na renderização — ver StationShapes.
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import {
  isStationId,
  mergeStationsWithDefaults,
  validateStationConfig,
  validateStationMemberAssignment,
  type StationConfig,
  type StationTabConfig,
} from '../shared/craft/StationShapes.js';
import {
  STATION_TABLES_SQL,
  deleteStationMember,
  getStationsDataCached,
  listStationMembers,
  listStations,
  saveStation,
  saveStationMember,
  type StationWriteResult,
} from './stationRepository.js';

function writeFailed(res: Response, result: StationWriteResult): void {
  if (result.tableMissing) {
    res.status(503).json({
      error: 'Tabelas de estações ausentes no Supabase',
      tableMissing: true,
      tableSql: STATION_TABLES_SQL,
    });
    return;
  }
  res.status(500).json({ error: result.error ?? 'Falha ao persistir' });
}

/** Cópia normalizada campo a campo — nunca persistir campos desconhecidos. */
function normalizeStationConfig(body: StationConfig): StationConfig {
  return {
    stationId: body.stationId,
    name: body.name.trim(),
    icon: body.icon,
    color: body.color.toLowerCase(),
    sortIndex: body.sortIndex,
    tabs: body.tabs.map(
      (tab): StationTabConfig => ({
        id: tab.id,
        name: tab.name.trim(),
        buttonLabel: tab.buttonLabel.trim(),
        rows: tab.rows.map((row) => [...row]).filter((row) => row.length > 0),
      }),
    ),
  };
}

export const stationsAdminRouter = Router();
stationsAdminRouter.use(requireSupabaseAdmin);

stationsAdminRouter.get('/', async (_req: Request, res: Response) => {
  const [stations, members] = await Promise.all([listStations(), listStationMembers()]);
  const error = stations.error ?? members.error;
  if (error) {
    res.status(500).json({ error });
    return;
  }
  const tableMissing = stations.tableMissing || members.tableMissing;
  res.json({
    // Sempre as 4 estações, mesmo com tabela vazia/ausente (defaults de código).
    stations: mergeStationsWithDefaults(stations.records),
    members: members.records,
    updatedAt: stations.updatedAt,
    tableMissing,
    invalidIds: [...stations.invalidIds, ...members.invalidIds],
    ...(tableMissing ? { tableSql: STATION_TABLES_SQL } : {}),
  });
});

// Antes de '/:stationId' por clareza (métodos iguais, profundidades diferentes).
stationsAdminRouter.put('/members/:itemId', async (req: Request, res: Response) => {
  const itemId = String(req.params.itemId ?? '');
  const body = req.body as Record<string, unknown> | null;
  const stationId = body && 'stationId' in body ? body.stationId : undefined;
  if (stationId === undefined) {
    res.status(400).json({ error: 'Corpo esperado: { stationId: string | null }' });
    return;
  }
  const invalid = validateStationMemberAssignment(itemId, stationId);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const result =
    stationId === null
      ? await deleteStationMember(itemId)
      : await saveStationMember(itemId, stationId as string);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ itemId, stationId });
});

stationsAdminRouter.put('/:stationId', async (req: Request, res: Response) => {
  const stationId = String(req.params.stationId ?? '');
  if (!isStationId(stationId)) {
    res.status(404).json({ error: `Estação desconhecida: "${stationId}" (só as 4 fixas existem)` });
    return;
  }
  const validated = validateStationConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'StationConfig inválido', details: validated.errors });
    return;
  }
  const body = req.body as StationConfig;
  if (body.stationId !== stationId) {
    res.status(400).json({ error: `stationId do corpo ("${body.stationId}") difere da URL ("${stationId}")` });
    return;
  }
  const config = normalizeStationConfig(body);
  const result = await saveStation(config);
  if (!result.ok) {
    writeFailed(res, result);
    return;
  }
  res.json({ station: config });
});

// ------------------------------------------------------------------ public

/** Snapshot read-only cacheado para o painel de estação do jogo. */
export async function publicStationsDataHandler(_req: Request, res: Response): Promise<void> {
  res.json(await getStationsDataCached());
}
