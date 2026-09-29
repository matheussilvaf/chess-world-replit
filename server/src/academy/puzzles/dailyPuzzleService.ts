import { awardGambitsAtomic } from '../../rating/ratingRepository.js';
import { getRatingConfigCached } from '../../rating/ratingConfigRepository.js';
import { gambitDayStart } from '../../shared/rating/RatingShapes.js';
import {
  DAILY_PUZZLE_LIVES, DAILY_PUZZLE_SLOTS, dailyPuzzleDate, dailyPuzzleNextReset, dailyRewardFor,
  type DailySlot, type DailyStatePayload,
} from '../../shared/academy/PuzzleShapes.js';
import { pinsForDate, resolveDailyConfigFor } from './puzzleConfigRepository.js';
import { checkPuzzleError, drawPuzzle, getPuzzleById, getPuzzlesByIds, puzzleClient, PuzzleStorageError, type PuzzleRow } from './puzzleRepository.js';

export interface DailyDraw { date: string; slot: DailySlot; puzzle: PuzzleRow; rewardGambits: number; pinned: boolean }
interface StoredDraw { puzzle_date: string; slot: DailySlot; puzzle_id: string; reward_gambits: number; pinned: boolean }
export interface DailyAttempt { slot: DailySlot; status: 'in_progress' | 'solved' | 'failed'; livesLeft: number; earnedGambits: number }
// Cache por processo com validade curta: um pin feito pelo admin em outra instância aparece em até 1 min.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { draws: DailyDraw[]; expiresAt: number }>();
const pending = new Map<string, Promise<DailyDraw[]>>();
export function invalidateDailyCache(date: string): void { cache.delete(date); }

async function readDraws(date: string): Promise<StoredDraw[]> {
  const { data, error } = await puzzleClient().from('academy_daily_puzzles').select('*').eq('puzzle_date', date);
  checkPuzzleError(error);
  return (data ?? []) as StoredDraw[];
}
export async function storedDailyPuzzles(date: string): Promise<DailyDraw[] | null> {
  const rows = await readDraws(date);
  if (!rows.length) return null;
  const puzzles = new Map((await getPuzzlesByIds(rows.map((r) => r.puzzle_id))).map((p) => [p.puzzleId, p]));
  return rows.map((r) => {
    const puzzle = puzzles.get(r.puzzle_id);
    if (!puzzle) throw new PuzzleStorageError(`Puzzle diário ${r.puzzle_id} não encontrado.`);
    return { date, slot: r.slot, puzzle, rewardGambits: r.reward_gambits, pinned: r.pinned };
  }).sort((a, b) => a.slot - b.slot);
}
async function generate(date: string, persist: boolean): Promise<DailyDraw[]> {
  const existing = await readDraws(date);
  if (existing.length === 3) return (await storedDailyPuzzles(date))!;
  const [config, pins] = await Promise.all([resolveDailyConfigFor(date), pinsForDate(date)]);
  const from = new Date(`${date}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 90);
  const { data: recent, error } = await puzzleClient().from('academy_daily_puzzles').select('puzzle_id')
    .gte('puzzle_date', from.toISOString().slice(0, 10)).lt('puzzle_date', date);
  checkPuzzleError(error);
  const excluded = new Set<string>((recent ?? []).map((r) => r.puzzle_id));
  const drawn: DailyDraw[] = [];
  for (const slot of DAILY_PUZZLE_SLOTS) {
    const already = existing.find((r) => r.slot === slot);
    if (already) {
      const puzzle = await getPuzzleById(already.puzzle_id);
      if (!puzzle) throw new PuzzleStorageError(`Puzzle diário ${already.puzzle_id} não encontrado.`);
      drawn.push({ date, slot, puzzle, rewardGambits: already.reward_gambits, pinned: already.pinned });
      excluded.add(puzzle.puzzleId);
      continue;
    }
    const settings = config.slots.find((s) => s.slot === slot);
    if (!settings) throw new PuzzleStorageError(`Configuração ausente do slot ${slot}.`);
    const pin = pins.find((p) => p.slot === slot);
    let puzzle = pin?.puzzleId ? await getPuzzleById(pin.puzzleId) : null;
    const pinned = !!puzzle;
    if (!puzzle) puzzle = await drawPuzzle({ ratingMin: settings.ratingMin, ratingMax: settings.ratingMax, theme: settings.theme, excludeIds: [...excluded] });
    if (!puzzle) throw new PuzzleStorageError(`Nenhum puzzle disponível para o slot ${slot}.`);
    excluded.add(puzzle.puzzleId);
    drawn.push({ date, slot, puzzle, rewardGambits: settings.rewardGambits, pinned });
  }
  if (!persist) return drawn;
  const { error: writeError } = await puzzleClient().from('academy_daily_puzzles').upsert(drawn.filter((d) => !existing.some((r) => r.slot === d.slot)).map((d) => ({
    puzzle_date: date, slot: d.slot, puzzle_id: d.puzzle.puzzleId, rating: d.puzzle.rating, themes: d.puzzle.themes,
    theme: config.slots.find((s) => s.slot === d.slot)?.theme ?? '', rating_min: config.slots.find((s) => s.slot === d.slot)?.ratingMin,
    rating_max: config.slots.find((s) => s.slot === d.slot)?.ratingMax, reward_gambits: d.rewardGambits, pinned: d.pinned,
  })), { onConflict: 'puzzle_date,slot', ignoreDuplicates: true });
  checkPuzzleError(writeError);
  return (await storedDailyPuzzles(date))!;
}
export async function previewDailyPuzzles(date: string): Promise<{ slots: DailyDraw[]; drawn: boolean }> {
  const saved = await storedDailyPuzzles(date);
  return saved ? { slots: saved, drawn: true } : { slots: await generate(date, false), drawn: false };
}
export async function getDailyPuzzles(date: string, now = Date.now()): Promise<DailyDraw[]> {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > now) return cached.draws;
  if (!pending.has(date)) pending.set(date, generate(date, true).then((result) => {
    cache.set(date, { draws: result, expiresAt: Date.now() + CACHE_TTL_MS });
    for (const key of cache.keys()) if (key !== date) cache.delete(key);
    return result;
  }).finally(() => pending.delete(date)));
  return pending.get(date)!;
}
export async function getAttempts(userId: string, date: string): Promise<DailyAttempt[]> {
  const { data, error } = await puzzleClient().from('academy_daily_attempts').select('*').eq('user_id', userId).eq('puzzle_date', date);
  checkPuzzleError(error);
  return (data ?? []).map((r) => ({ slot: r.slot, status: r.status, livesLeft: r.lives_left, earnedGambits: r.earned_gambits }));
}
export async function startAttempt(userId: string, date: string, slot: DailySlot, puzzleId: string): Promise<DailyAttempt> {
  const { error } = await puzzleClient().from('academy_daily_attempts').upsert({
    user_id: userId, puzzle_date: date, slot, puzzle_id: puzzleId, lives_left: DAILY_PUZZLE_LIVES, status: 'in_progress',
  }, { onConflict: 'user_id,puzzle_date,slot', ignoreDuplicates: true });
  checkPuzzleError(error);
  const attempt = (await getAttempts(userId, date)).find((r) => r.slot === slot)!;
  if (attempt.status !== 'in_progress') throw new PuzzleStorageError('daily_done');
  return attempt;
}
export async function registerWrongMove(userId: string, date: string, slot: DailySlot): Promise<DailyAttempt> {
  const existing = (await getAttempts(userId, date)).find((r) => r.slot === slot);
  if (!existing || existing.status !== 'in_progress') throw new PuzzleStorageError('daily_done');
  const lives = Math.max(0, existing.livesLeft - 1);
  const { data, error } = await puzzleClient().from('academy_daily_attempts')
    .update({ lives_left: lives, status: lives ? 'in_progress' : 'failed', finished_at: lives ? null : new Date().toISOString() })
    .eq('user_id', userId).eq('puzzle_date', date).eq('slot', slot).eq('status', 'in_progress').eq('lives_left', existing.livesLeft)
    .select('slot,status,lives_left,earned_gambits').maybeSingle();
  checkPuzzleError(error);
  if (!data) throw new PuzzleStorageError('Tentativa alterada por outra sessão. Abra o puzzle novamente.');
  return { slot, status: data.status, livesLeft: data.lives_left, earnedGambits: data.earned_gambits };
}
export async function registerSolved(userId: string, date: string, slot: DailySlot, base: number): Promise<{ rewardGambits: number; gambitsBalance: number | null; livesLeft: number }> {
  const now = Date.now();
  // Primeiro a transição condicional da tentativa (só uma sessão vence a corrida); só depois o crédito.
  // O prêmio segue as vidas gravadas no banco, não o que a sessão em memória acreditava ter.
  const { data, error } = await puzzleClient().from('academy_daily_attempts')
    .update({ status: 'solved', finished_at: new Date(now).toISOString() })
    .eq('user_id', userId).eq('puzzle_date', date).eq('slot', slot).eq('status', 'in_progress')
    .select('lives_left').maybeSingle();
  checkPuzzleError(error);
  if (!data) throw new PuzzleStorageError('daily_done');
  const livesLeft: number = data.lives_left;
  const config = await getRatingConfigCached();
  const result = await awardGambitsAtomic({
    matchId: `daily:${date}:${slot}`, playerId: userId, amount: dailyRewardFor(base, livesLeft), kind: 'daily_puzzle',
    dayStartIso: new Date(gambitDayStart(now, config.gambits.dayOffsetHours)).toISOString(), dailyCap: null, awardedAtIso: new Date(now).toISOString(),
  });
  if (result.error || result.schemaMissing || result.status === 'profile_missing') throw new PuzzleStorageError(result.error ?? 'Não foi possível creditar Gambitos.', result.schemaMissing);
  const reward = result.amount;
  const { error: rewardError } = await puzzleClient().from('academy_daily_attempts').update({ earned_gambits: reward })
    .eq('user_id', userId).eq('puzzle_date', date).eq('slot', slot);
  checkPuzzleError(rewardError);
  return { rewardGambits: reward, gambitsBalance: result.balance, livesLeft };
}
export async function buildDailyState(userId: string, now = Date.now()): Promise<DailyStatePayload> {
  const date = dailyPuzzleDate(now);
  const [draws, attempts] = await Promise.all([getDailyPuzzles(date), getAttempts(userId, date)]);
  return { date, nextResetAt: dailyPuzzleNextReset(now), serverNow: now, schemaMissing: false,
    slots: draws.map((d) => {
      const a = attempts.find((row) => row.slot === d.slot);
      return { puzzleId: d.puzzle.puzzleId, rating: d.puzzle.rating, themes: d.puzzle.themes,
        slot: d.slot, rewardGambits: d.rewardGambits, status: a?.status ?? 'available',
        livesLeft: a?.livesLeft ?? DAILY_PUZZLE_LIVES, earnedGambits: a?.earnedGambits ?? 0 };
    }) };
}