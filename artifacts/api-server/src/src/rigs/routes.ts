/**
 * Rig config HTTP surface.
 *
 * - `rigsAdminRouter` → mounted at /api/admin/rigs. EVERY route (including
 *   reads) requires a valid Supabase JWT — no anonymous access (spec §19).
 * - `publicRigConfigHandler` → GET /api/rigs/:rigId. Read-only route for game
 *   clients: returns only the validated, cached rig config.
 */
import { Router, type Request, type Response } from 'express';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import {
  RIG_TABLE_SQL,
  deleteRig,
  getRig,
  getRigCached,
  listRigs,
  saveRig,
} from './rigConfigRepository.js';
import { RIG_ID_RE, validateRigConfig } from '../shared/combat/RigShapes.js';

export const rigsAdminRouter = Router();
rigsAdminRouter.use(requireSupabaseAuth);

function badRigId(res: Response, rigId: string): boolean {
  if (RIG_ID_RE.test(rigId)) return false;
  res.status(400).json({ error: `rigId inválido: "${rigId}" (use minúsculas, números e hífens)` });
  return true;
}

// List all rigs (seeds the default rig when the table is empty).
rigsAdminRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listRigs();
  if (result.error) {
    res.status(500).json({ error: result.error, tableMissing: result.tableMissing, tableSql: RIG_TABLE_SQL });
    return;
  }
  res.json({
    rigs: result.rigs,
    updatedAt: result.updatedAt,
    tableMissing: result.tableMissing,
    invalidIds: result.invalidIds,
    ...(result.tableMissing ? { tableSql: RIG_TABLE_SQL } : {}),
  });
});

// Create (fails on duplicate ID).
rigsAdminRouter.post('/', async (req: Request, res: Response) => {
  const validated = validateRigConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'RigConfig inválido', details: validated.errors });
    return;
  }
  const write = await saveRig(validated.config, { mustNotExist: true });
  if (write.tableMissing) {
    res.status(503).json({ error: 'Tabela rig_configs não existe no Supabase', tableMissing: true, tableSql: RIG_TABLE_SQL });
    return;
  }
  if (write.conflict) {
    res.status(409).json({ error: `Já existe um rig com o ID "${validated.config.rigId}"` });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao salvar o rig' });
    return;
  }
  res.status(201).json({ rig: validated.config });
});

// Read one (fresh, for the editor).
rigsAdminRouter.get('/:rigId', async (req: Request, res: Response) => {
  const rigId = String(req.params.rigId ?? '');
  if (badRigId(res, rigId)) return;
  const result = await getRig(rigId);
  if (result.error) {
    res.status(500).json({ error: result.error });
    return;
  }
  if (!result.rig) {
    res.status(404).json({
      error: `Rig "${rigId}" não encontrado`,
      tableMissing: result.tableMissing,
      ...(result.tableMissing ? { tableSql: RIG_TABLE_SQL } : {}),
    });
    return;
  }
  res.json({ rig: result.rig, tableMissing: result.tableMissing });
});

// Update (upsert — also how "Renomear" persists, since the ID stays).
rigsAdminRouter.put('/:rigId', async (req: Request, res: Response) => {
  const rigId = String(req.params.rigId ?? '');
  if (badRigId(res, rigId)) return;
  const validated = validateRigConfig(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'RigConfig inválido', details: validated.errors });
    return;
  }
  if (validated.config.rigId !== rigId) {
    res.status(400).json({ error: `rigId do corpo ("${validated.config.rigId}") difere da URL ("${rigId}")` });
    return;
  }
  const write = await saveRig(validated.config);
  if (write.tableMissing) {
    res.status(503).json({ error: 'Tabela rig_configs não existe no Supabase', tableMissing: true, tableSql: RIG_TABLE_SQL });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao salvar o rig' });
    return;
  }
  res.json({ rig: validated.config });
});

// Delete (client asks for confirmation before calling).
rigsAdminRouter.delete('/:rigId', async (req: Request, res: Response) => {
  const rigId = String(req.params.rigId ?? '');
  if (badRigId(res, rigId)) return;
  const write = await deleteRig(rigId);
  if (write.tableMissing) {
    res.status(503).json({ error: 'Tabela rig_configs não existe no Supabase', tableMissing: true, tableSql: RIG_TABLE_SQL });
    return;
  }
  if (!write.ok) {
    res.status(500).json({ error: write.error ?? 'Falha ao excluir o rig' });
    return;
  }
  res.json({ ok: true });
});

/**
 * Public, read-only rig lookup for game clients (no auth, cached, validated).
 * Game clients never talk to the rig_configs table directly.
 */
export async function publicRigConfigHandler(req: Request, res: Response): Promise<void> {
  const rigId = String(req.params.rigId ?? '');
  if (!RIG_ID_RE.test(rigId)) {
    res.status(400).json({ error: 'rigId inválido' });
    return;
  }
  const rig = await getRigCached(rigId);
  if (!rig) {
    res.status(404).json({ error: `Nenhum rig válido para "${rigId}"` });
    return;
  }
  res.json(rig);
}
