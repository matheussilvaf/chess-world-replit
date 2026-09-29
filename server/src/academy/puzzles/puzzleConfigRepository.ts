import { DEFAULT_BATTLE_REWARDS, DEFAULT_DAILY_SLOT_CONFIGS, type BattleRewardConfig, type DailyConfigSet, type DailyPin, type DailySlotConfig } from '../../shared/academy/PuzzleShapes.js';
import { checkPuzzleError, puzzleClient, PuzzleStorageError } from './puzzleRepository.js';

const configRow = (r: any): DailySlotConfig => ({
  slot: r.slot, ratingMin: r.rating_min, ratingMax: r.rating_max, theme: r.theme, rewardGambits: r.reward_gambits,
});
const defaultSet = (): DailyConfigSet => ({ effectiveFrom: '0001-01-01', slots: DEFAULT_DAILY_SLOT_CONFIGS.map((s) => ({ ...s })), updatedAt: null });

export async function listDailyConfigs(): Promise<DailyConfigSet[]> {
  const { data, error } = await puzzleClient().from('academy_daily_config').select('*').order('effective_from');
  checkPuzzleError(error);
  const sets = new Map<string, DailyConfigSet>();
  for (const r of data ?? []) {
    let set = sets.get(r.effective_from);
    if (!set) { set = { effectiveFrom: r.effective_from, slots: [], updatedAt: r.updated_at }; sets.set(r.effective_from, set); }
    set.slots.push(configRow(r));
  }
  if (!sets.has('0001-01-01')) sets.set('0001-01-01', defaultSet());
  return [...sets.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}
export async function resolveDailyConfigFor(date: string): Promise<DailyConfigSet> {
  try {
    const sets = await listDailyConfigs();
    return [...sets].reverse().find((s) => s.effectiveFrom <= date) ?? defaultSet();
  } catch (error) {
    if (error instanceof PuzzleStorageError && error.schemaMissing) return defaultSet();
    throw error;
  }
}
export async function saveDailyConfig(set: DailyConfigSet): Promise<void> {
  const client = puzzleClient();
  const { error } = await client.from('academy_daily_config').upsert(set.slots.map((s) => ({
    effective_from: set.effectiveFrom, slot: s.slot, rating_min: s.ratingMin, rating_max: s.ratingMax,
    theme: s.theme, reward_gambits: s.rewardGambits, updated_at: new Date().toISOString(),
  })), { onConflict: 'effective_from,slot' });
  checkPuzzleError(error);
}
export async function deleteDailyConfig(date: string): Promise<void> {
  const { error } = await puzzleClient().from('academy_daily_config').delete().eq('effective_from', date);
  checkPuzzleError(error);
}
export async function listDailyPins(): Promise<DailyPin[]> {
  const { data, error } = await puzzleClient().from('academy_daily_pins').select('puzzle_date,slot,puzzle_id').order('puzzle_date', { ascending: false }).limit(300);
  checkPuzzleError(error);
  return (data ?? []).map((r) => ({ date: r.puzzle_date, slot: r.slot, puzzleId: r.puzzle_id }));
}
export async function pinsForDate(date: string): Promise<DailyPin[]> {
  const { data, error } = await puzzleClient().from('academy_daily_pins').select('puzzle_date,slot,puzzle_id').eq('puzzle_date', date);
  checkPuzzleError(error);
  return (data ?? []).map((r) => ({ date: r.puzzle_date, slot: r.slot, puzzleId: r.puzzle_id }));
}
export async function saveDailyPin(pin: DailyPin): Promise<void> {
  const client = puzzleClient();
  const { error } = pin.puzzleId ?
    await client.from('academy_daily_pins').upsert({ puzzle_date: pin.date, slot: pin.slot, puzzle_id: pin.puzzleId }, { onConflict: 'puzzle_date,slot' }) :
    await client.from('academy_daily_pins').delete().eq('puzzle_date', pin.date).eq('slot', pin.slot);
  checkPuzzleError(error);
}
export async function getBattleRewards(): Promise<BattleRewardConfig> {
  const { data, error } = await puzzleClient().from('academy_battle_config').select('*').eq('id', 1).maybeSingle();
  checkPuzzleError(error);
  return data ? { enabled: data.enabled, winGambits: data.win_gambits, drawGambits: data.draw_gambits, lossGambits: data.loss_gambits, dailyCapGambits: data.daily_cap_gambits } : { ...DEFAULT_BATTLE_REWARDS };
}
export async function saveBattleRewards(config: BattleRewardConfig): Promise<void> {
  const { error } = await puzzleClient().from('academy_battle_config').upsert({
    id: 1, enabled: config.enabled, win_gambits: config.winGambits, draw_gambits: config.drawGambits,
    loss_gambits: config.lossGambits, daily_cap_gambits: config.dailyCapGambits, updated_at: new Date().toISOString(),
  });
  checkPuzzleError(error);
}