import { Router, Request, Response, NextFunction } from 'express';
import * as service from './service.js';
import { PRESETS } from './presets.js';
import { checkPersistenceHealth, isPersistenceAvailable } from './persistence.js';
import { getEngineStatus, getEngineDiagnostics, runFixtureTest, resetEngineCache } from './engine.js';
import type { GameResult, RoundMode, Color } from './types.js';
import { createClient } from '@supabase/supabase-js';

export const tournamentRouter = Router();

// --- Auth middleware ---
// Validates Supabase JWT from Authorization header
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const token = authHeader.replace('Bearer ', '');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server auth not configured' });
    return;
  }
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    (req as any).userId = data.user.id;
    next();
  } catch (e: any) {
    res.status(401).json({ error: 'Auth verification failed' });
  }
}

// --- Health check (no auth required) ---
tournamentRouter.get('/health', async (_req, res) => {
  resetEngineCache();
  const [engineStatus, dbHealth] = await Promise.all([
    getEngineStatus(),
    isPersistenceAvailable() ? checkPersistenceHealth() : Promise.resolve({ ok: false, error: 'Not configured' }),
  ]);

  res.json({
    server: true,
    tournamentService: true,
    database: dbHealth.ok,
    databaseError: dbHealth.error || null,
    pairingEngine: engineStatus.available,
    engineVersion: engineStatus.version,
    engineError: engineStatus.error || null,
    checkerAvailable: engineStatus.checkerAvailable,
    platform: engineStatus.platform,
    arch: engineStatus.arch,
  });
});

// --- Detailed engine diagnostics (no auth - non-sensitive) ---
tournamentRouter.get('/engine-diagnostics', async (_req, res) => {
  resetEngineCache();
  const [diag, fixture] = await Promise.all([
    getEngineDiagnostics(),
    runFixtureTest().catch((e: any) => ({
      dutchOk: false,
      checkerOk: false,
      dutchOutput: '',
      checkerOutput: '',
      dutchError: e.message,
      checkerError: null,
      durationMs: 0,
    })),
  ]);

  // For frontend: only non-sensitive info
  res.json({
    platform: diag.platform,
    arch: diag.arch,
    fileExists: diag.fileExists,
    fileSize: diag.fileSize,
    filePermissions: diag.filePermissions,
    executableBit: diag.executableBit,
    diagnosis: diag.diagnosis,
    spawnErrorCode: diag.spawnErrorCode,
    exitCode: diag.exitCode,
    signal: diag.signal,
    timedOut: diag.timedOut,
    durationMs: diag.durationMs,
    stdout: diag.stdout.slice(0, 500),
    stderr: diag.stderr.slice(0, 500),
    fixture: {
      dutchOk: fixture.dutchOk,
      checkerOk: fixture.checkerOk,
      dutchError: fixture.dutchError,
      checkerError: fixture.checkerError,
      durationMs: fixture.durationMs,
    },
  });
});

// All mutation routes require auth
tournamentRouter.use(requireAuth);

// Engine status (detailed, requires auth)
tournamentRouter.get('/engine-status', async (_req, res) => {
  resetEngineCache();
  const status = await getEngineStatus();
  res.json(status);
});

// Presets
tournamentRouter.get('/presets', (_req, res) => {
  res.json(PRESETS);
});

// List test tournaments
tournamentRouter.get('/tournaments', async (_req, res) => {
  const list = await service.listTournaments();
  res.json(list);
});

// Get tournament
tournamentRouter.get('/tournaments/:id', async (req, res) => {
  const t = await service.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// Create tournament
tournamentRouter.post('/tournaments', async (req, res) => {
  const { name } = req.body;
  const userId = (req as any).userId;
  const t = await service.createTournament(name || 'Swiss Test', userId);
  res.json(t);
});

// Delete tournament
tournamentRouter.delete('/tournaments/:id', async (req, res) => {
  await service.deleteTournament(req.params.id);
  res.json({ ok: true });
});

// Add player
tournamentRouter.post('/tournaments/:id/players', async (req, res) => {
  try {
    const { name, rating } = req.body;
    const player = await service.addPlayer(req.params.id, name, rating);
    res.json(player);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Remove player
tournamentRouter.delete('/tournaments/:id/players/:playerId', async (req, res) => {
  try {
    await service.removePlayer(req.params.id, req.params.playerId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Update player
tournamentRouter.put('/tournaments/:id/players/:playerId', async (req, res) => {
  try {
    const { name, rating } = req.body;
    await service.updatePlayer(req.params.id, req.params.playerId, name, rating);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Clear players
tournamentRouter.delete('/tournaments/:id/players', async (req, res) => {
  try {
    await service.clearPlayers(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Load preset
tournamentRouter.post('/tournaments/:id/load-preset', async (req, res) => {
  try {
    const { presetIndex } = req.body;
    const preset = PRESETS[presetIndex];
    if (!preset) return res.status(400).json({ error: 'Invalid preset index' });

    await service.clearPlayers(req.params.id);
    for (const p of preset.players) {
      await service.addPlayer(req.params.id, p.name, p.rating);
    }
    const t = await service.getTournament(req.params.id);
    res.json(t);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Set round mode
tournamentRouter.post('/tournaments/:id/round-mode', async (req, res) => {
  try {
    const { mode, manualCount } = req.body;
    await service.setRoundMode(req.params.id, mode as RoundMode, manualCount);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Set initial color
tournamentRouter.post('/tournaments/:id/initial-color', async (req, res) => {
  try {
    const { color } = req.body;
    await service.setInitialColor(req.params.id, color as Color | 'random');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Get round info
tournamentRouter.get('/tournaments/:id/round-info', async (req, res) => {
  const t = await service.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const playerCount = t.players.filter(p => p.status === 'active').length;
  const info = service.getRoundInfo(playerCount, t.config.roundMode, t.config.totalRounds || undefined);
  res.json(info);
});

// Start tournament
tournamentRouter.post('/tournaments/:id/start', async (req, res) => {
  const result = await service.startTournament(req.params.id);
  if (!result.success) {
    return res.status(400).json({ error: result.error, diagnostics: result.diagnostics });
  }
  const t = await service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t, diagnostics: result.diagnostics });
});

// Generate next round
tournamentRouter.post('/tournaments/:id/next-round', async (req, res) => {
  const result = await service.generateNextRound(req.params.id);
  if (!result.success) {
    return res.status(400).json({ error: result.error, diagnostics: result.diagnostics });
  }
  const t = await service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t, diagnostics: result.diagnostics });
});

// Set result
tournamentRouter.post('/tournaments/:id/rounds/:round/boards/:board/result', async (req, res) => {
  try {
    const { result, isPlayed } = req.body;
    await service.setResult(
      req.params.id,
      parseInt(req.params.round),
      parseInt(req.params.board),
      result as GameResult,
      isPlayed !== false
    );
    const t = await service.getTournament(req.params.id);
    res.json({ ok: true, tournament: t });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Finalize round
tournamentRouter.post('/tournaments/:id/rounds/:round/finalize', async (req, res) => {
  const result = await service.finalizeRound(req.params.id, parseInt(req.params.round));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  const t = await service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t, standings: result.standings });
});

// Withdraw player
tournamentRouter.post('/tournaments/:id/players/:playerId/withdraw', async (req, res) => {
  try {
    await service.withdrawPlayer(req.params.id, req.params.playerId);
    const t = await service.getTournament(req.params.id);
    res.json({ ok: true, tournament: t });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Correct round
tournamentRouter.post('/tournaments/:id/rounds/:round/correct', async (req, res) => {
  const result = await service.correctRound(req.params.id, parseInt(req.params.round));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  const t = await service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t });
});

// Get player histories
tournamentRouter.get('/tournaments/:id/histories', async (req, res) => {
  const histories = service.getPlayerHistories(req.params.id);
  if (!histories) return res.status(404).json({ error: 'Not found' });
  const obj: Record<number, any> = {};
  histories.forEach((v, k) => { obj[k] = v; });
  res.json(obj);
});

// Import tournament
tournamentRouter.post('/tournaments/import', async (req, res) => {
  try {
    const userId = (req as any).userId;
    const t = await service.importTournament(req.body, userId);
    res.json(t);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});
