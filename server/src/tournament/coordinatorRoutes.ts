import { Router, Request, Response } from 'express';
import {
  loadConfig,
  saveConfig,
  getCurrentInstance,
  getLatestCompletedInstance,
  getRegistrations,
  registerPlayer,
  unregisterPlayer,
  getPairings,
  getStandings,
  type TournamentConfig,
} from './coordinator.js';
import { getEngineStatus } from './engine.js';
import { createClient } from '@supabase/supabase-js';

export const coordinatorRouter = Router();

async function requireAuth(req: Request, res: Response, next: Function): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const token = authHeader.replace('Bearer ', '');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.status(500).json({ error: 'Server auth not configured' }); return; }

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) { res.status(401).json({ error: 'Invalid token' }); return; }
    (req as any).userId = data.user.id;
    (req as any).userEmail = data.user.email;
    next();
  } catch {
    res.status(401).json({ error: 'Auth verification failed' });
  }
}

// --- Public routes (no auth needed for reading tournament state) ---

coordinatorRouter.get('/state', async (_req, res) => {
  try {
    const [current, lastCompleted, config] = await Promise.all([
      getCurrentInstance(),
      getLatestCompletedInstance(),
      loadConfig(),
    ]);

    let registrations: any[] = [];
    let pairings: any[] = [];
    let standings: any[] = [];

    if (current) {
      registrations = await getRegistrations(current.id);
      if (current.currentRound > 0) {
        pairings = await getPairings(current.id, current.currentRound);
      }
      if (current.status !== 'registration_open') {
        standings = await getStandings(current.id);
      }
    }

    let lastStandings: any[] = [];
    if (lastCompleted) {
      lastStandings = await getStandings(lastCompleted.id);
    }

    res.json({
      serverNow: new Date().toISOString(),
      config,
      current,
      lastCompleted,
      registrations,
      pairings,
      standings,
      lastStandings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

coordinatorRouter.get('/config', async (_req, res) => {
  try {
    const config = await loadConfig();
    const engineStatus = await getEngineStatus();
    res.json({ config, engineStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin allowlist for config writes: comma-separated emails in ADMIN_EMAILS.
// When set, only those users may change tournament config. When unset:
// allowed in development (with a loud warning), rejected otherwise (fail
// closed) so a production deploy is never open to every authenticated user.
function requireAdmin(req: Request, res: Response, next: Function): void {
  const raw = (process.env.ADMIN_EMAILS || '').trim();
  const email = String((req as any).userEmail || '').toLowerCase();
  if (raw) {
    const allowed = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (email && allowed.includes(email)) { next(); return; }
    res.status(403).json({ error: 'Acesso restrito a administradores' });
    return;
  }
  if (process.env.NODE_ENV === 'development') {
    console.warn('[Coordinator] ADMIN_EMAILS not set — allowing config write for any authenticated user (development only). Set ADMIN_EMAILS before going live.');
    next();
    return;
  }
  res.status(403).json({ error: 'ADMIN_EMAILS não configurado no servidor' });
}

// --- Auth-required routes ---

coordinatorRouter.use(requireAuth);

coordinatorRouter.post('/config', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const config: TournamentConfig = req.body;
    await saveConfig(config, userId);
    const updated = await loadConfig();
    res.json({ ok: true, config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

coordinatorRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { tournamentId, username, rating } = req.body;
    const playerId = (req as any).userId;
    const result = await registerPlayer(tournamentId, playerId, username, rating || 1200);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

coordinatorRouter.post('/unregister', async (req: Request, res: Response) => {
  try {
    const { tournamentId } = req.body;
    const playerId = (req as any).userId;
    const result = await unregisterPlayer(tournamentId, playerId);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// NOTE: the old POST /report-result route was removed on purpose. Results are
// server-authoritative: WorldRoom reports every end condition in-process and
// the coordinator sweeps forfeits. An HTTP result route is purely a cheat
// vector — do not reintroduce it.
