import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';
import type { BotGameRecord } from '../shared/academy/AcademyShapes.js';

const toRow = (record: Omit<BotGameRecord, 'id'>) => ({
  user_id: record.userId, bot_id: record.botId, bot_name: record.botName,
  bot_level: record.botLevel, player_color: record.playerColor, result: record.result,
  outcome: record.outcome, reason: record.reason, time_minutes: record.timeMinutes,
  increment_seconds: record.incrementSeconds, time_label: record.timeLabel,
  moves_count: record.movesCount, pgn: record.pgn, final_fen: record.finalFen,
  started_at: record.startedAt, finished_at: record.finishedAt,
});

export async function insertBotGame(record: Omit<BotGameRecord, 'id'>): Promise<{ ok: boolean; error: string | null; schemaMissing: boolean }> {
  const client = getServiceClient();
  if (!client) return { ok: false, error: PERSISTENCE_UNAVAILABLE, schemaMissing: false };
  const { error } = await client.from('bot_games').insert(toRow(record));
  return { ok: !error, error: error?.message ?? null, schemaMissing: isTableMissing(error?.code) };
}

export async function listBotGamesForUser(userId: string, limit = 50): Promise<{ games: BotGameRecord[]; schemaMissing: boolean }> {
  const client = getServiceClient();
  if (!client) throw new Error(PERSISTENCE_UNAVAILABLE);
  const { data, error } = await client.from('bot_games').select('*').eq('user_id', userId).order('finished_at', { ascending: false }).limit(Math.min(50, Math.max(1, limit)));
  if (error) {
    if (isTableMissing(error.code)) return { games: [], schemaMissing: true };
    throw new Error(error.message);
  }
  return { games: (data ?? []).map((r) => ({
    id: r.id, userId: r.user_id, botId: r.bot_id, botName: r.bot_name,
    botLevel: r.bot_level, playerColor: r.player_color, result: r.result,
    outcome: r.outcome, reason: r.reason, timeMinutes: r.time_minutes,
    incrementSeconds: r.increment_seconds, timeLabel: r.time_label,
    movesCount: r.moves_count, pgn: r.pgn, finalFen: r.final_fen,
    startedAt: r.started_at, finishedAt: r.finished_at,
  })), schemaMissing: false };
}