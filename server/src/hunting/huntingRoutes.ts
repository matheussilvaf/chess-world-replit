import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin } from '../auth/supabaseAuth.js';
import { parseMotionConfig } from '../shared/hunting/HuntingMotion.js';
import { defaultHuntingConfig, parseHuntingConfig, type HuntingConfig } from '../shared/hunting/HuntingShapes.js';
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

/**
 * Writes are serialized in this process (read → merge → upsert never interleaves), and the leap
 * (`motion`) is written ONLY through `PUT /motion` (the /dev/caca bench): the full `PUT /` (admin
 * page) keeps the leap already stored, so a stale admin tab can never revert what the bench saved,
 * and the bench never touches the rest of the document.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}
type WriteOutcome = { config: HuntingConfig; error: null; tableMissing: false } | { config: null; error: string | null; tableMissing: boolean };
async function writeConfig(build: (stored: HuntingConfig | null) => HuntingConfig): Promise<WriteOutcome> {
  return serialized(async () => {
    const stored = await getHuntingConfig();
    if (stored.error) return { config: null, error: stored.error, tableMissing: false };
    if (stored.tableMissing) return { config: null, error: null, tableMissing: true };
    const config = build(stored.config);
    const result = await saveHuntingConfig(config);
    if (!result.ok) return { config: null, error: result.error, tableMissing: result.tableMissing };
    return { config, error: null, tableMissing: false };
  });
}
function respond(res: Response, outcome: WriteOutcome): void {
  if (outcome.config) return void res.json({ config: outcome.config, saved: true });
  if (outcome.tableMissing) return void res.status(503).json({ error: 'Tabela hunting_config ausente no Supabase', tableMissing: true, tableSql: HUNTING_CONFIG_TABLE_SQL });
  res.status(500).json({ error: outcome.error ?? 'Falha ao persistir' });
}

/** Full config (admin page). The stored leap is preserved — see `PUT /motion`. */
huntingAdminRouter.put('/', async (req: Request, res: Response) => {
  const incoming = parseHuntingConfig(req.body);
  respond(res, await writeConfig((stored) => ({ ...incoming, motion: stored ? stored.motion : incoming.motion })));
});

/** Leap only (bench /dev/caca): body = HuntingMotionConfig, merged into the stored document. */
huntingAdminRouter.put('/motion', async (req: Request, res: Response) => {
  const motion = parseMotionConfig(req.body);
  respond(res, await writeConfig((stored) => ({ ...(stored ?? defaultHuntingConfig()), motion })));
});

export async function publicHuntingConfigHandler(_req: Request, res: Response): Promise<void> {
  res.json({ config: await getHuntingConfigCached() });
}