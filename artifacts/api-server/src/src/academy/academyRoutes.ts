import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdmin, requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { ACADEMY_BOT_IDS, BOT_NAME_MAX_LEN, isAcademyBotId, isBotLevel, type AcademyBot, type AcademyBotsUpdateRequest } from '../shared/academy/AcademyShapes.js';
import { getBots, saveBots } from './academyBotsRepository.js';
import { listBotGamesForUser } from './botGamesRepository.js';
import { DAILY_REWARD_MAX_GAMBITS, PUZZLE_RATING_MIN, PUZZLE_RATING_MAX, dailyPuzzleDate, isDailySlot, isIsoDate, puzzleThemeLabel, type BattleRewardConfig, type DailyConfigUpsertRequest, type DailyPinUpsertRequest, type PuzzleAdminConfigResponse } from '../shared/academy/PuzzleShapes.js';
import { puzzleSetup } from '../shared/academy/puzzleSolver.js';
import { buildDailyState, invalidateDailyCache, previewDailyPuzzles } from './puzzles/dailyPuzzleService.js';
import { deleteDailyConfig, getBattleRewards, listDailyConfigs, listDailyPins, resolveDailyConfigFor, saveBattleRewards, saveDailyConfig, saveDailyPin } from './puzzles/puzzleConfigRepository.js';
import { checkPuzzleError, countPuzzles, drawPuzzle, getPuzzleById, listThemeCounts, puzzleClient, PuzzleStorageError } from './puzzles/puzzleRepository.js';
import { buildLessonState } from './lessons/lessonRepository.js';
import { academyBoard, academySummary, statsBoards, statsPeriods, type StatsBoard, type StatsPeriod } from './stats/academyStatsService.js';

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

const route = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (e) {
    console.warn('[academy-puzzles]', e);
    res.status(e instanceof PuzzleStorageError && e.schemaMissing ? 503 : 503).json({
      error: e instanceof Error ? e.message : String(e), schemaMissing: e instanceof PuzzleStorageError && e.schemaMissing,
    });
  }
};
const bad = (res: Response, message: string) => res.status(400).json({ error: message });
const validDate = (value: unknown): value is string =>
  isIsoDate(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validFilter = (raw: any) => {
  const min = Number(raw.ratingMin ?? PUZZLE_RATING_MIN);
  const max = Number(raw.ratingMax ?? PUZZLE_RATING_MAX);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < PUZZLE_RATING_MIN || max > PUZZLE_RATING_MAX || min >= max ||
    (raw.theme != null && (typeof raw.theme !== 'string' || raw.theme.length > 80 || !/^[a-zA-Z]*$/.test(raw.theme))))
    return null;
  return { ratingMin: min, ratingMax: max, theme: raw.theme || '' };
};
const preview = (p: Awaited<ReturnType<typeof getPuzzleById>>) => p ? ({
  puzzleId: p.puzzleId, rating: p.rating, themes: p.themes, fen: p.fen,
  setupMove: puzzleSetup(p).setupMove, playerColor: puzzleSetup(p).playerColor,
  solutionLength: puzzleSetup(p).solutionLength, gameUrl: p.gameUrl,
}) : null;
let themesCache: { until: number; value: unknown } | null = null;
academyRouter.get('/puzzles/themes', route(async (_req, res) => {
  if (!themesCache || themesCache.until < Date.now()) {
    themesCache = { until: Date.now() + 300_000, value: { themes: (await listThemeCounts()).map((r) => ({ ...r, label: puzzleThemeLabel(r.theme) })), schemaMissing: false } };
  }
  res.set('Cache-Control', 'public, max-age=300').json(themesCache.value);
}));
academyRouter.get('/daily/me', requireSupabaseAuth, route(async (req, res) => {
  res.json(await buildDailyState((req as Request & { userId: string }).userId));
}));
academyRouter.get('/lessons/me', requireSupabaseAuth, route(async (req, res) => {
  res.json(await buildLessonState((req as Request & { userId: string }).userId));
}));
academyRouter.get('/stats/board', requireSupabaseAuth, route(async (req, res) => {
  const { board, period } = req.query;
  const page = Number(req.query.page ?? 1);
  const size = Number(req.query.size ?? 8);
  if (typeof board !== 'string' || !statsBoards.includes(board as StatsBoard) ||
    typeof period !== 'string' || !statsPeriods.includes(period as StatsPeriod) ||
    !Number.isInteger(page) || page < 1 || page > 500 ||
    !Number.isInteger(size) || size < 1 || size > 10) {
    bad(res, 'Ranking, período ou paginação inválidos.'); return;
  }
  res.json(await academyBoard(board as StatsBoard, period as StatsPeriod, page, size, (req as Request & { userId: string }).userId));
}));
academyRouter.get('/stats/summary', requireSupabaseAuth, route(async (req, res) => {
  res.json(await academySummary((req as Request & { userId: string }).userId));
}));
academyRouter.get('/battles/me', requireSupabaseAuth, route(async (req, res) => {
  const id = (req as Request & { userId: string }).userId;
  const { data, error } = await puzzleClient().from('academy_puzzle_battles').select('*')
    .or(`player_a.eq.${id},player_b.eq.${id}`).order('finished_at', { ascending: false }).limit(50);
  checkPuzzleError(error);
  res.json({ battles: (data ?? []).map((r) => {
    const a = r.player_a === id;
    return { id: r.id, mode: r.mode, band: r.band, showThemes: r.show_themes,
      opponentName: a ? r.player_b_name : r.player_a_name,
      outcome: !r.winner_id ? 'draw' : r.winner_id === id ? 'win' : 'loss',
      reason: r.reason, mySolved: a ? r.a_solved : r.b_solved, opponentSolved: a ? r.b_solved : r.a_solved,
      rewardGambits: a ? r.a_reward : r.b_reward, startedAt: r.started_at, finishedAt: r.finished_at };
  }), schemaMissing: false });
}));
// Toda escrita do admin devolve o documento completo: o painel substitui o estado pela resposta.
async function adminConfigDocument(): Promise<PuzzleAdminConfigResponse> {
  const today = dailyPuzzleDate();
  const [configSets, activeToday, pins, battleRewards] = await Promise.all([
    listDailyConfigs(), resolveDailyConfigFor(today), listDailyPins(), getBattleRewards(),
  ]);
  return { configSets, activeToday, pins, battleRewards, today, schemaMissing: false };
}
academyAdminRouter.get('/puzzles/config', route(async (_req, res) => {
  res.json(await adminConfigDocument());
}));
academyAdminRouter.put('/puzzles/config/daily', route(async (req, res) => {
  const body = req.body as DailyConfigUpsertRequest;
  if (!body || !validDate(body.effectiveFrom) || !Array.isArray(body.slots) || body.slots.length !== 3 ||
    new Set(body.slots.map((s) => s?.slot)).size !== 3 ||
    !body.slots.every((s) => isDailySlot(s?.slot) && validFilter(s) && typeof s.theme === 'string' &&
      Number.isInteger(s.rewardGambits) && s.rewardGambits >= 0 && s.rewardGambits <= DAILY_REWARD_MAX_GAMBITS) ||
    typeof body.showThemes !== 'boolean')
    { bad(res, 'Informe data ISO, três slots válidos com rating, tema e recompensa, e se o tema é exibido.'); return; }
  await saveDailyConfig({ effectiveFrom: body.effectiveFrom, slots: body.slots, showThemes: body.showThemes, updatedAt: null });
  res.json(await adminConfigDocument());
}));
academyAdminRouter.delete('/puzzles/config/daily/:effectiveFrom', route(async (req, res) => {
  const date = req.params.effectiveFrom;
  if (!validDate(date) || date <= dailyPuzzleDate()) { bad(res, 'Só é possível excluir agendamentos futuros.'); return; }
  await deleteDailyConfig(date);
  res.json(await adminConfigDocument());
}));
academyAdminRouter.put('/puzzles/pins', route(async (req, res) => {
  const body = req.body as DailyPinUpsertRequest;
  if (!body || !validDate(body.date) || !isDailySlot(body.slot) ||
    typeof body.puzzleId !== 'string' || body.puzzleId.length > 80) { bad(res, 'Data, slot ou ID do puzzle inválido.'); return; }
  const puzzle = body.puzzleId ? await getPuzzleById(body.puzzleId) : null;
  if (body.puzzleId && !puzzle) { bad(res, 'Puzzle não encontrado ou inválido.'); return; }
  if (puzzle) {
    // Um sorteio já disputado não muda: trocaria o puzzle debaixo de tentativas registradas.
    const { count, error: attemptsError } = await puzzleClient().from('academy_daily_attempts')
      .select('user_id', { count: 'exact', head: true }).eq('puzzle_date', body.date).eq('slot', body.slot);
    checkPuzzleError(attemptsError);
    if ((count ?? 0) > 0) { bad(res, `O slot ${body.slot} de ${body.date} já tem tentativas; fixe o puzzle em outra data ou slot.`); return; }
  }
  await saveDailyPin(body);
  if (puzzle) {
    const { error } = await puzzleClient().from('academy_daily_puzzles').update({
      puzzle_id: puzzle.puzzleId, rating: puzzle.rating, themes: puzzle.themes, pinned: true,
    }).eq('puzzle_date', body.date).eq('slot', body.slot);
    checkPuzzleError(error);
  }
  invalidateDailyCache(body.date);
  res.json(await adminConfigDocument());
}));
academyAdminRouter.put('/puzzles/config/battles', route(async (req, res) => {
  const body = req.body as BattleRewardConfig;
  if (!body || typeof body.enabled !== 'boolean' || ![body.winGambits, body.drawGambits, body.lossGambits]
    .every((n) => Number.isInteger(n) && n >= 0 && n <= DAILY_REWARD_MAX_GAMBITS) ||
    (body.dailyCapGambits !== null && (!Number.isInteger(body.dailyCapGambits) || body.dailyCapGambits < 0 || body.dailyCapGambits > 100000)))
    { bad(res, 'Configuração de recompensa inválida.'); return; }
  await saveBattleRewards(body);
  res.json(await adminConfigDocument());
}));
academyAdminRouter.get('/puzzles/count', route(async (req, res) => {
  const filter = validFilter(req.query);
  if (!filter) { bad(res, 'Filtro de puzzles inválido.'); return; }
  res.json({ count: await countPuzzles(filter) });
}));
academyAdminRouter.post('/puzzles/preview', route(async (req, res) => {
  const filter = validFilter(req.body ?? {});
  if (!filter) { bad(res, 'Filtro de puzzles inválido.'); return; }
  const [count, puzzle] = await Promise.all([countPuzzles(filter), drawPuzzle(filter)]);
  res.json({ count, puzzle: preview(puzzle) });
}));
academyAdminRouter.get('/puzzles/lookup/:puzzleId', route(async (req, res) => {
  if (!/^[\w-]{1,80}$/.test(req.params.puzzleId)) { bad(res, 'ID do puzzle inválido.'); return; }
  const puzzle = await getPuzzleById(req.params.puzzleId);
  res.json({ puzzle: preview(puzzle), count: puzzle ? 1 : 0 });
}));
academyAdminRouter.get('/puzzles/daily/:date', route(async (req, res) => {
  if (!validDate(req.params.date)) { bad(res, 'Data ISO inválida.'); return; }
  const { slots, drawn } = await previewDailyPuzzles(req.params.date);
  res.json({ date: req.params.date, drawn, slots: slots.map((s) => ({
    slot: s.slot, puzzleId: s.puzzle.puzzleId, rating: s.puzzle.rating, themes: s.puzzle.themes,
    pinned: s.pinned, rewardGambits: s.rewardGambits,
  })) });
}));