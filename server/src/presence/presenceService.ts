import { getServiceClient } from '../rigs/serviceSupabase.js';

const activeSessions = new Map<string, Set<string>>();
let lastErrorLogAt = 0;

function logError(error: unknown): void {
  const now = Date.now();
  if (now - lastErrorLogAt < 60_000) return;
  lastErrorLogAt = now;
  console.warn(`[presence] atualização falhou: ${error instanceof Error ? error.message : String(error)}`);
}

async function safely(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    logError(error);
  }
}

class PresenceService {
  join(userId: string, sessionId: string, region: string): void {
    const sessions = activeSessions.get(userId) ?? new Set<string>();
    sessions.add(sessionId);
    activeSessions.set(userId, sessions);
    void safely(async () => {
      const db = getServiceClient();
      if (!db) return;
      const now = new Date().toISOString();
      // Update antes do insert preserva x/y já conhecidos.
      const updated = await db.from('player_presence')
        .update({ region, status: 'online', updated_at: now })
        .eq('user_id', userId)
        .select('user_id');
      if (updated.error) throw new Error(updated.error.message);
      if ((updated.data?.length ?? 0) > 0) return;
      const inserted = await db.from('player_presence').insert({
        user_id: userId,
        region,
        status: 'online',
        updated_at: now,
      });
      if (inserted.error) throw new Error(inserted.error.message);
    });
  }

  heartbeat(players: Array<{ userId: string; region: string }>): void {
    const unique = [...new Map(players.map((player) => [player.userId, player])).values()];
    if (unique.length === 0) return;
    void safely(async () => {
      const db = getServiceClient();
      if (!db) return;
      const updatedAt = new Date().toISOString();
      const result = await db.from('player_presence').upsert(
        unique.map(({ userId, region }) => ({
          user_id: userId,
          region,
          status: 'online',
          updated_at: updatedAt,
        })),
        { onConflict: 'user_id' },
      );
      if (result.error) throw new Error(result.error.message);
    });
  }

  leave(userId: string, sessionId: string): void {
    const sessions = activeSessions.get(userId);
    sessions?.delete(sessionId);
    if (sessions?.size === 0) activeSessions.delete(userId);
    const leaveStartedAt = new Date().toISOString();
    // A troca de sala pode sobrepor join/leave; dê tempo para a nova sessão registrar.
    setTimeout(() => {
      if (activeSessions.has(userId)) return;
      void safely(async () => {
        const db = getServiceClient();
        if (!db) return;
        const result = await db.from('player_presence')
          .update({ status: 'offline', updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .lte('updated_at', leaveStartedAt);
        if (result.error) throw new Error(result.error.message);
      });
    }, 2_000).unref?.();
  }
}

export const presenceService = new PresenceService();