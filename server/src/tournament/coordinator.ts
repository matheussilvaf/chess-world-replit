import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as service from './service.js';
import { computeAllHistories } from './tiebreaks.js';
import type { Tournament, GameResult, RoundMode, Color } from './types.js';
import { getEngineStatus } from './engine.js';

// Reference to TournamentRoom for presence checks and sync
let tournamentRoomInstance: { isPlayerPresent(playerId: string): boolean; syncFromCoordinator(): Promise<void> } | null = null;
export function setTournamentRoomInstance(room: { isPlayerPresent(playerId: string): boolean; syncFromCoordinator(): Promise<void> } | null) {
  tournamentRoomInstance = room;
}
function getTournamentRoomInstance() {
  return tournamentRoomInstance;
}

async function notifyRoomSync(): Promise<void> {
  try {
    await tournamentRoomInstance?.syncFromCoordinator();
  } catch (e) {
    console.error('[Coordinator] notifyRoomSync error:', (e as Error).message);
  }
}

// Reference to WorldRoom for checking if match is already active
export interface ForceStartPairing {
  boardId: string;
  whitePlayerId: string;
  blackPlayerId: string;
  baseTimeSeconds: number;
  incrementSeconds: number;
  timeCategory: string;
  timeLabel: string;
}
export interface WorldRoomLike {
  roomName?: string;
  isBoardPlaying(boardId: string): boolean;
  hasPlayerById?(playerId: string): boolean;
  teleportTournamentPlayersToReception(tournamentId: string): void;
  tryForceStartTournamentMatch?(pairing: ForceStartPairing): 'started' | 'already' | 'missing' | 'busy';
}
// Registry instead of a single instance: the 'world' and 'arena' rooms are
// both WorldRoom and used to overwrite each other here (and dispose set null),
// breaking presence checks whenever the "wrong" room registered last.
const worldRooms = new Set<WorldRoomLike>();
export function registerWorldRoom(room: WorldRoomLike) {
  worldRooms.add(room);
}
export function unregisterWorldRoom(room: WorldRoomLike) {
  worldRooms.delete(room);
}
// Back-compat alias (old call sites)
export function setWorldRoomInstance(room: WorldRoomLike | null) {
  if (room) worldRooms.add(room);
}
function anyWorldRoomPlaying(boardId: string): boolean {
  for (const room of worldRooms) {
    try { if (room.isBoardPlaying(boardId)) return true; } catch { /* disposed */ }
  }
  return false;
}
function teleportTournamentPlayers(tournamentId: string): void {
  for (const room of worldRooms) {
    try {
      room.teleportTournamentPlayersToReception(tournamentId);
    } catch (e) {
      console.error('[Coordinator] teleport dispatch error:', (e as Error).message);
    }
  }
}

export interface TournamentConfig {
  intervalSeconds: number;
  timeControl: {
    category: string;
    baseTimeSeconds: number;
    incrementSeconds: number;
    displayLabel: string;
  };
  swissConfig: {
    roundMode: RoundMode;
    initialColor: Color | 'random';
    manualRoundCount: number | null;
    scoring: string;
    tiebreaks: string[];
  };
  /** When true, each new tournament cycle rolls random settings. Persisted inside swiss_config JSONB (no DDL access to add a column). */
  randomize?: boolean;
  /**
   * Seconds a player has to reconnect (or arrive) before a W.O. is awarded.
   * Persisted inside swiss_config JSONB (no DDL access to add a column).
   * Default: 30.
   */
  woTimeoutSeconds?: number;
  /**
   * Maximum draw offers a player can make per match.
   * Persisted inside swiss_config JSONB (no DDL access to add a column).
   * Default: 2.
   */
  maxDrawOffers?: number;
}

export interface TournamentInstance {
  id: string;
  status: string;
  startsAt: string;
  startedAt: string | null;
  completedAt: string | null;
  configSnapshot: TournamentConfig | null;
  currentRound: number;
  totalRounds: number;
  playerCount: number;
  arenaLayout: ArenaLayout | null;
  swissTournamentId: string | null;
  transitionLock: string | null;
}

export interface ArenaLayout {
  modules: ArenaModule[];
  tables: ArenaTable[];
}

export interface ArenaModule {
  instanceId: string;
  type: 'double' | 'single' | 'end';
  order: number;
}

export interface ArenaTable {
  runtimeTableId: string;
  tableNumber: number;
  moduleInstanceId: string;
  localSlotId: string;
}

export interface Registration {
  id: string;
  tournamentId: string;
  playerId: string;
  username: string;
  rating: number;
  registeredAt: string;
}

export interface PairingRecord {
  id: string;
  tournamentId: string;
  roundId: string;
  roundNumber: number;
  boardNumber: number;
  whitePlayerId: string | null;
  blackPlayerId: string | null;
  whiteUsername: string | null;
  blackUsername: string | null;
  tableNumber: number;
  runtimeTableId: string | null;
  result: string | null;
  resultReason: string | null;
  isBye: boolean;
  byePlayerId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  presenceDeadline: string | null;
}

let supabase: SupabaseClient | null = null;
let coordinatorTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

function getClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    supabase = createClient(url, key);
  }
  return supabase;
}

// --- Coordinator lifecycle ---

export async function startCoordinator(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log('[Coordinator] Starting tournament coordinator...');
  await tick();
}

export function stopCoordinator(): void {
  isRunning = false;
  if (coordinatorTimer) {
    clearTimeout(coordinatorTimer);
    coordinatorTimer = null;
  }
  console.log('[Coordinator] Stopped.');
}

async function tick(): Promise<void> {
  if (!isRunning) return;
  try {
    await processTransitions();
  } catch (err) {
    console.error('[Coordinator] Tick error:', (err as Error).message);
  }
  coordinatorTimer = setTimeout(() => tick(), 5000);
}

// --- Core state machine ---

async function processTransitions(): Promise<void> {
  const db = getClient();

  // Skip decoy instances (config_snapshot.decoy = true). A decoy is an inert
  // round_active row with an ancient starts_at: coordinators WITHOUT this
  // filter (stale deployments running old code against the same DB) pick it
  // as "the oldest active instance" every tick and idle on it harmlessly,
  // instead of corrupting live tournaments they no longer understand.
  const { data: active } = await db
    .from('tournament_instances')
    .select('*')
    .not('status', 'in', '("completed","cancelled_insufficient_players")')
    .is('config_snapshot->decoy', null)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!active) {
    await ensureNextCycleExists();
    return;
  }

  const instance = mapInstance(active);
  const now = new Date();

  switch (instance.status) {
    case 'registration_open':
      if (new Date(instance.startsAt) <= now) {
        await transitionToStarting(instance);
      }
      break;

    case 'starting':
      await transitionToRoundActive(instance);
      break;

    case 'round_active':
      if (!(await ensureEngineOwnership(instance))) break;
      await checkRoundCompletion(instance);
      await ensureMatchesStarted(instance);
      await checkPresenceDeadlines(instance);
      break;

    case 'between_rounds':
      if (!(await ensureEngineOwnership(instance))) break;
      {
        // Skip if the round countdown is still ticking — clients show the
        // pill, coordinator holds off until the deadline passes.
        const nextRoundAt = (instance.configSnapshot as Record<string, unknown> | null)?.next_round_at as string | undefined;
        if (nextRoundAt && Date.now() < new Date(nextRoundAt).getTime()) break;
      }
      await transitionToNextRound(instance);
      break;

    case 'finalizing':
      if (!(await ensureEngineOwnership(instance))) break;
      await transitionToCompleted(instance);
      break;
  }
}

// --- State transitions ---

async function transitionToStarting(instance: TournamentInstance): Promise<void> {
  const db = getClient();

  const { data: regs } = await db
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', instance.id);

  const registrations = regs || [];

  if (registrations.length < 2) {
    await atomicTransition(instance.id, 'registration_open', 'cancelled_insufficient_players');
    console.log('[Coordinator] Tournament cancelled - insufficient players');
    await ensureNextCycleExists();
    return;
  }

  const locked = await atomicTransition(instance.id, 'registration_open', 'starting');
  if (!locked) return;

  // Re-read the row AFTER winning the CAS: saveConfig may have rescheduled
  // starts_at and/or cleared config_snapshot (randomize toggled) between this
  // tick's read and the lock. Using the stale in-memory row could start a
  // rescheduled tournament early or resurrect a cleared snapshot.
  const { data: freshRow, error: freshErr } = await db
    .from('tournament_instances')
    .select('starts_at, config_snapshot')
    .eq('id', instance.id)
    .single();
  if (freshErr || !freshRow) {
    console.error('[Coordinator] Re-read after lock failed, releasing:', freshErr?.message);
    await atomicTransition(instance.id, 'starting', 'registration_open');
    return;
  }
  if (freshRow.starts_at && new Date(freshRow.starts_at).getTime() > Date.now()) {
    // Rescheduled into the future while we were locking — undo and wait.
    console.log('[Coordinator] Start aborted: instance was rescheduled to the future');
    await atomicTransition(instance.id, 'starting', 'registration_open');
    return;
  }

  // Prefer the snapshot rolled when this cycle was created (randomize mode).
  // Fall back to rolling now (randomize turned on after the cycle existed)
  // or to the live config (normal mode).
  const liveConfig = await loadConfig();
  const snapshot = (freshRow.config_snapshot as TournamentConfig | null)
    || (liveConfig.randomize ? rollRandomConfig(liveConfig) : liveConfig);
  await db
    .from('tournament_instances')
    .update({
      config_snapshot: snapshot,
      player_count: registrations.length,
      started_at: new Date().toISOString(),
    })
    .eq('id', instance.id);

  console.log(`[Coordinator] Tournament ${instance.id} starting with ${registrations.length} players`);
}

async function transitionToRoundActive(instance: TournamentInstance): Promise<void> {
  const db = getClient();
  const config = instance.configSnapshot || await loadConfig();

  // Stuck detection: if tournament has been 'starting' for > 60s, cancel it
  if (instance.startedAt) {
    const elapsed = Date.now() - new Date(instance.startedAt).getTime();
    if (elapsed > 60_000) {
      console.error(`[Coordinator] Tournament ${instance.id} stuck in 'starting' for ${Math.round(elapsed/1000)}s, cancelling`);
      await atomicTransition(instance.id, 'starting', 'cancelled_insufficient_players');
      await db.from('tournament_instances').update({ completed_at: new Date().toISOString() }).eq('id', instance.id);
      await ensureNextCycleExists();
      return;
    }
  }

  const engineStatus = await getEngineStatus();
  if (!engineStatus.available) {
    console.error('[Coordinator] Engine unavailable, cannot start tournament. Error:', engineStatus.error);
    return;
  }

  const { data: regs } = await db
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', instance.id);

  if (!regs || regs.length < 2) {
    await atomicTransition(instance.id, 'starting', 'cancelled_insufficient_players');
    await ensureNextCycleExists();
    return;
  }

  // Claim priority: the coordinator that HOSTS the registered players should
  // own the engine. Presence (W.O.) and force-start are local knowledge of
  // the server whose rooms hold the players; when a player-less coordinator
  // claims the engine, W.O. deadlocks — the owner sees nobody (presence
  // unknown → skip) while the hosting server is gated out of the sweep.
  // A coordinator hosting none of the registrants defers for a grace period;
  // if nobody claimed by then (all registrants offline), it proceeds anyway.
  if (!instance.swissTournamentId) {
    const hosted = regs.filter((r: any) => hostsPlayer(r.player_id ?? r.user_id)).length;
    if (hosted === 0) {
      const startingSince = instance.transitionLock ? new Date(instance.transitionLock).getTime() : 0;
      const wait = Date.now() - startingSince;
      if (wait < CLAIM_GRACE_MS) {
        console.log(`[Coordinator] Deferring engine claim for ${instance.id}: hosting 0/${regs.length} registrants (${Math.round(wait / 1000)}s/${CLAIM_GRACE_MS / 1000}s grace)`);
        return;
      }
      console.warn(`[Coordinator] Claiming ${instance.id} despite hosting 0/${regs.length} registrants — grace expired`);
    }
  }

  let swissId = instance.swissTournamentId;

  if (!swissId) {
    try {
      console.log(`[Coordinator] Creating swiss tournament for ${instance.id} with ${regs.length} players`);
      const swissT = await service.createTournament(`Tournament-${instance.id}`, undefined);
      swissId = swissT.id;
      console.log(`[Coordinator] Swiss tournament created: ${swissId}`);

      const initialColor = config.swissConfig.initialColor;
      await service.setInitialColor(swissId, initialColor);
      await service.setRoundMode(swissId, config.swissConfig.roundMode, config.swissConfig.manualRoundCount || undefined);

      for (const reg of regs) {
        await service.addPlayer(swissId, reg.username, reg.rating);
      }
      console.log(`[Coordinator] Added ${regs.length} players to swiss tournament`);

      const startResult = await service.startTournament(swissId);
      if (!startResult.success) {
        console.error('[Coordinator] Swiss start failed:', startResult.error);
        await atomicTransition(instance.id, 'starting', 'cancelled_insufficient_players');
        await db.from('tournament_instances').update({ completed_at: new Date().toISOString() }).eq('id', instance.id);
        await ensureNextCycleExists();
        return;
      }
      console.log(`[Coordinator] Swiss tournament started successfully`);

      const swissT2 = await service.getTournament(swissId);
      if (!swissT2) return;

      const layout = computeArenaLayout(instance.id, Math.floor(regs.length / 2));

      // Claim the swiss engine with a CAS (only if still unset). In a
      // split-brain scenario (two coordinators on the same DB) each side
      // creates its own engine, and each engine may roll a different
      // initialColor. Pairings MUST be published from the engine that wins
      // this claim, otherwise the published colors diverge from the engine
      // that later scores the results and the champion comes out inverted.
      const { data: claimed } = await db
        .from('tournament_instances')
        .update({
          swiss_tournament_id: swissId,
          total_rounds: swissT2.config.totalRounds,
          current_round: 1,
          arena_layout: layout,
          // Claiming the engine also takes the ownership lease: identity in
          // config_snapshot.engine_owner, liveness in transition_lock.
          transition_lock: new Date().toISOString(),
          config_snapshot: { ...(instance.configSnapshot ?? {}), engine_owner: COORDINATOR_ID },
        })
        .eq('id', instance.id)
        .is('swiss_tournament_id', null)
        .select('id');

      if (!claimed || claimed.length === 0) {
        console.warn(`[Coordinator] Swiss engine claim lost for ${instance.id} — another coordinator attached first; discarding local engine ${swissId}`);
        await service.deleteTournament(swissId);
        return;
      }
      ownedEngines.add(swissId);

      await createRoundRecords(instance.id, swissId, swissT2, 1, layout, regs);
      await atomicTransition(instance.id, 'starting', 'round_active');

      console.log(`[Coordinator] Round 1 started for tournament ${instance.id}`);
    } catch (err: any) {
      console.error(`[Coordinator] Error starting swiss tournament:`, err.message, err.stack);
      return;
    }
  } else {
    await atomicTransition(instance.id, 'starting', 'round_active');
  }
}

async function checkRoundCompletion(instance: TournamentInstance): Promise<void> {
  await lockedAdvanceRound(instance.id);
}

// Server-side guarantee that paired matches actually start. The client-side
// auto-seat flow can silently die (tab throttled, hook race, dropped message);
// when a pairing sits unstarted while both players are online, the arena room
// starts the match itself — clients follow via the match_started broadcast.
const FORCE_START_GRACE_MS = 12_000;
const unstartedSince = new Map<string, number>();
let unstartedTournamentId: string | null = null;

async function ensureMatchesStarted(instance: TournamentInstance): Promise<void> {
  const db = getClient();

  if (unstartedTournamentId !== instance.id) {
    unstartedSince.clear();
    unstartedTournamentId = instance.id;
  }

  const { data: pending } = await db
    .from('tournament_pairings')
    .select('*')
    .eq('tournament_id', instance.id)
    .eq('round_number', instance.currentRound)
    .is('result', null)
    .is('started_at', null)
    .eq('is_bye', false);

  const pendingList = pending || [];
  const pendingIds = new Set<string>(pendingList.map((p: any) => p.id));
  for (const key of Array.from(unstartedSince.keys())) {
    if (!pendingIds.has(key)) unstartedSince.delete(key);
  }
  if (pendingList.length === 0) return;

  const now = Date.now();
  const tc = instance.configSnapshot?.timeControl
    || { category: 'blitz', baseTimeSeconds: 300, incrementSeconds: 0, displayLabel: '5+0' };

  for (const p of pendingList) {
    if (!p.runtime_table_id || !p.white_player_id || !p.black_player_id) continue;

    const firstSeen = unstartedSince.get(p.id);
    if (!firstSeen) {
      unstartedSince.set(p.id, now);
      continue;
    }
    if (now - firstSeen < FORCE_START_GRACE_MS) continue;
    if (anyWorldRoomPlaying(p.runtime_table_id)) {
      unstartedSince.delete(p.id);
      continue;
    }

    for (const room of worldRooms) {
      if (room.roomName !== 'arena' || !room.tryForceStartTournamentMatch) continue;
      let outcome: string | undefined;
      try {
        outcome = room.tryForceStartTournamentMatch({
          boardId: p.runtime_table_id,
          whitePlayerId: p.white_player_id,
          blackPlayerId: p.black_player_id,
          baseTimeSeconds: tc.baseTimeSeconds,
          incrementSeconds: tc.incrementSeconds,
          timeCategory: tc.category,
          timeLabel: tc.displayLabel,
        });
      } catch (e) {
        console.error('[Coordinator] Force-start dispatch error:', (e as Error).message);
      }
      if (outcome === 'started' || outcome === 'already') {
        console.log(`[Coordinator] Force-started board ${p.board_number} (${outcome}): clients did not seat within ${FORCE_START_GRACE_MS / 1000}s`);
        unstartedSince.delete(p.id);
        break;
      }
    }
  }
}

async function checkPresenceDeadlines(instance: TournamentInstance): Promise<void> {
  const db = getClient();
  const now = new Date().toISOString();

  const { data: expired } = await db
    .from('tournament_pairings')
    .select('*')
    .eq('tournament_id', instance.id)
    .eq('round_number', instance.currentRound)
    .is('result', null)
    .not('presence_deadline', 'is', null)
    .lte('presence_deadline', now);

  if (!expired || expired.length === 0) return;

  let anyUpdated = false;

  for (const p of expired) {
    if (p.is_bye || p.result) continue;

    if (p.runtime_table_id && anyWorldRoomPlaying(p.runtime_table_id)) {
      // Board is actively playing: push the deadline forward instead of
      // clearing it. A null deadline drops the pairing out of this sweep
      // FOREVER (`presence_deadline is null` never matches again), so a
      // crash after clearing left rounds stuck in round_active with no
      // result and no watchdog. Re-arming is equally W.O.-safe while the
      // game runs and self-heals if the game dies without reporting.
      await db
        .from('tournament_pairings')
        .update({ presence_deadline: new Date(Date.now() + 120_000).toISOString() })
        .eq('id', p.id)
        .is('result', null);
      continue;
    }

    let result: string;
    let reason: string;

    const whitePresence = p.white_player_id ? await isPlayerPresent(p.white_player_id) : false;
    const blackPresence = p.black_player_id ? await isPlayerPresent(p.black_player_id) : false;

    if (whitePresence === null || blackPresence === null) {
      // This coordinator cannot observe presence (no room instance). Leave
      // the expired deadline untouched — a coordinator that actually hosts
      // the players will forfeit or re-arm on its own tick.
      continue;
    }

    const whitePresent = whitePresence === true;
    const blackPresent = blackPresence === true;

    if (whitePresent && blackPresent) {
      // Both present but the board hasn't started (the playing case is
      // handled above). Re-arm the deadline instead of clearing it: players
      // who register, stay in the room, but never seat would otherwise leave
      // the round stuck in round_active forever (no deadline, no result).
      await db
        .from('tournament_pairings')
        .update({ presence_deadline: new Date(Date.now() + 120_000).toISOString() })
        .eq('id', p.id)
        .is('result', null);
      continue;
    } else if (whitePresent && !blackPresent) {
      result = '+/-';
      reason = 'forfeit';
    } else if (!whitePresent && blackPresent) {
      result = '-/+';
      reason = 'forfeit';
    } else {
      result = '-/-';
      reason = 'forfeit';
    }

    const { data: updated, error: forfeitErr } = await db
      .from('tournament_pairings')
      .update({
        result,
        result_reason: reason,
        completed_at: new Date().toISOString(),
      })
      .eq('id', p.id)
      .is('result', null)
      .select('id')
      .maybeSingle();

    if (forfeitErr) {
      console.error(`[Coordinator] Forfeit update FAILED on board ${p.board_number}:`, forfeitErr.message);
    }
    console.log(`[Coordinator] Forfeit on board ${p.board_number}: ${result}`);
    if (updated) anyUpdated = true;
  }

  if (anyUpdated) {
    await lockedAdvanceRound(instance.id);
  }
}

// Round generation must be serialized per tournament: the tick path and the
// inline advance path (result report -> lockedAdvanceRound -> inline call)
// used to run generateNextRound concurrently; the loser saw the freshly
// pushed unfinalized round, got 'Current round not yet finalized', and the
// failure branch finalized the tournament mid-event (the premature-completion
// bug reproduced by the 3-player e2e, same mechanism as the production R3 case).
const roundGenLocks = new Map<string, Promise<void>>();

async function transitionToNextRound(instance: TournamentInstance): Promise<void> {
  const prev = roundGenLocks.get(instance.id) ?? Promise.resolve();
  const p = prev.then(async () => {
    try {
      await transitionToNextRoundInner(instance);
    } catch (err: any) {
      console.error('[Coordinator] transitionToNextRound error:', err.message);
    }
  });
  roundGenLocks.set(instance.id, p);
  await p;
  if (roundGenLocks.get(instance.id) === p) roundGenLocks.delete(instance.id);
}

async function transitionToNextRoundInner(instance: TournamentInstance): Promise<void> {
  const db = getClient();

  if (!instance.swissTournamentId) return;

  // Re-read the live status with config_snapshot so we can inspect the
  // round countdown flag written on the previous tick.
  const { data: liveRow } = await db
    .from('tournament_instances')
    .select('status, current_round, config_snapshot')
    .eq('id', instance.id)
    .maybeSingle();
  if (!liveRow || liveRow.status !== 'between_rounds') return;
  if (liveRow.current_round !== instance.currentRound) return;

  // ── ROUND COUNTDOWN ──────────────────────────────────────────────────────
  // If next_round_at is already set (pairings were generated on a previous
  // tick), either keep waiting or fire the transition once the clock expires.
  const snap = liveRow.config_snapshot as Record<string, unknown> | null ?? {};
  const existingNextRoundAt = snap.next_round_at as string | undefined;
  if (existingNextRoundAt) {
    if (Date.now() < new Date(existingNextRoundAt).getTime()) {
      return; // Still counting down — clients show the timer, coordinator waits
    }
    // Countdown expired → clear the flag, then flip to round_active
    const cleared: Record<string, unknown> = { ...snap, engine_owner: COORDINATOR_ID };
    delete cleared.next_round_at;
    await db.from('tournament_instances').update({ config_snapshot: cleared }).eq('id', instance.id);
    const won = await atomicTransition(instance.id, 'between_rounds', 'round_active');
    if (won) {
      console.log(`[Coordinator] Round ${liveRow.current_round as number} started for tournament ${instance.id}`);
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const nextRoundResult = await service.generateNextRound(instance.swissTournamentId);
  if (!nextRoundResult.success) {
    const errMsg = nextRoundResult.error || 'unknown';
    // Only finalize on TERMINAL conditions. Transient failures (races,
    // engine hiccups) must leave the instance in between_rounds so the next
    // tick retries — finalizing here is what ended tournaments at R2 with
    // rounds still owed to the players.
    const terminal = /all rounds completed|fewer than 2 active players|tournament not active|tournament not found|no pairing possible/i.test(errMsg);
    if (terminal) {
      console.log(`[Coordinator] No further rounds for ${instance.id} (${errMsg}); finalizing`);
      await atomicTransition(instance.id, 'between_rounds', 'finalizing');
    } else {
      console.error('[Coordinator] Generate next round failed (transient, will retry):', errMsg);
    }
    return;
  }

  const swissT = await service.getTournament(instance.swissTournamentId);
  if (!swissT) return;

  const nextRound = instance.currentRound + 1;
  const layout = instance.arenaLayout;
  if (!layout) return;

  const { data: regs } = await db
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', instance.id);

  await createRoundRecords(instance.id, instance.swissTournamentId, swissT, nextRound, layout, regs || []);

  // ── SET COUNTDOWN ─────────────────────────────────────────────────────────
  // Write next_round_at into config_snapshot so TournamentRoom can surface a
  // 5-second countdown pill on the client. We do NOT call atomicTransition
  // yet; the next tick's existingNextRoundAt branch fires round_active once
  // the deadline passes.
  const nextRoundAt = new Date(Date.now() + 5_000).toISOString();
  const updatedSnap = { ...snap, engine_owner: COORDINATOR_ID, next_round_at: nextRoundAt };
  await db
    .from('tournament_instances')
    .update({ current_round: nextRound, config_snapshot: updatedSnap })
    .eq('id', instance.id);

  console.log(`[Coordinator] Round ${nextRound} pairings ready for ${instance.id}, starting in 5 s`);
}

async function transitionToCompleted(instance: TournamentInstance): Promise<void> {
  const db = getClient();

  const wonTransition = await atomicTransition(instance.id, 'finalizing', 'completed');
  if (wonTransition) {
    // Only the CAS winner writes the final artifacts. Standings/completed_at
    // used to be written unconditionally BEFORE the CAS, so a losing (or
    // foreign, stale-engine) coordinator could overwrite them afterwards.
    // Standings rows already exist from each round's finalize; this save is
    // the final refresh.
    if (instance.swissTournamentId) {
      await saveStandings(instance.id, instance.swissTournamentId);
    }
    await db
      .from('tournament_instances')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', instance.id);
    console.log(`[Coordinator] Tournament ${instance.id} completed`);
    // Move any players still inside the arena modules back to the reception
    // before the client removes the modules from the map. Only the tick that
    // wins the CAS teleports, so players are not teleported twice.
    teleportTournamentPlayers(instance.id);
  }

  await ensureNextCycleExists();
}

async function tryAdvanceRound(tournamentId: string): Promise<void> {
  const db = getClient();

  const { data: inst } = await db
    .from('tournament_instances')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!inst || inst.status !== 'round_active') return;

  const instance = mapInstance(inst);

  const { data: pairings } = await db
    .from('tournament_pairings')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round_number', instance.currentRound);

  if (!pairings || pairings.length === 0) return;

  const allComplete = pairings.every((p: any) => p.result !== null);
  if (!allComplete) return;

  if (!instance.swissTournamentId) return;

  if (!isEngineOwned(instance.swissTournamentId)) {
    // This server may host the players (results are already in the DB), but
    // another coordinator owns the swiss engine. Applying results to a second
    // in-memory engine copy loses updates (last-write-wins persistence), so
    // leave the advance to the owner's next tick.
    return;
  }
  const swissT = await service.getTournament(instance.swissTournamentId);
  if (!swissT) return;

  for (const p of pairings) {
    if (p.is_bye) continue;
    if (!p.result) continue;

    const round = swissT.rounds.find((r: any) => r.number === instance.currentRound);
    if (!round) continue;

    const pairing = round.pairings.find((pr: any) => pr.board === p.board_number);
    if (!pairing || pairing.result) continue;

    // Split-brain guard: the attached engine may not be the one whose
    // pairings were published (a foreign coordinator can overwrite
    // swiss_tournament_id). The published pairing row is the source of truth
    // for who actually played which color, so if the engine has this board's
    // colors inverted, flip the color-relative result before applying it.
    let engineResult = p.result as GameResult;
    const engineWhiteName = swissT.players.find((pl: any) => pl.tpn === pairing.whiteTpn)?.name;
    if (engineWhiteName && p.white_username && engineWhiteName === p.black_username) {
      const flipped = FLIPPED_RESULTS[engineResult];
      if (flipped) {
        console.warn(`[Coordinator] Engine colors inverted vs published pairing (t=${instance.id.slice(0, 8)} r${instance.currentRound} b${p.board_number}); flipping result ${engineResult} -> ${flipped}`);
        engineResult = flipped;
      }
    }

    const isPlayed = !['forfeit', 'bye'].includes(p.result_reason || '');
    await service.setResult(
      instance.swissTournamentId,
      instance.currentRound,
      p.board_number,
      engineResult,
      isPlayed,
    );
  }

  const finalizeResult = await service.finalizeRound(instance.swissTournamentId, instance.currentRound);
  if (!finalizeResult.success) {
    console.error('[Coordinator] tryAdvanceRound: finalize round failed:', finalizeResult.error);
    return;
  }

  await saveStandings(instance.id, instance.swissTournamentId);

  const { data: roundRow } = await db
    .from('tournament_rounds')
    .select('id')
    .eq('tournament_id', instance.id)
    .eq('round_number', instance.currentRound)
    .maybeSingle();

  if (roundRow) {
    await db
      .from('tournament_rounds')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', roundRow.id);
  }

  const swissT2 = await service.getTournament(instance.swissTournamentId);
  const isFinished = swissT2 && swissT2.status === 'finished';

  if (isFinished) {
    const wonFinalize = await atomicTransition(instance.id, 'round_active', 'finalizing');
    if (wonFinalize) {
      await transitionToCompleted({ ...instance, status: 'finalizing' } as TournamentInstance);
    }
  } else {
    const wonBetween = await atomicTransition(instance.id, 'round_active', 'between_rounds');
    if (wonBetween) {
      await transitionToNextRound({ ...instance, status: 'between_rounds' } as TournamentInstance);
    }
  }

  await notifyRoomSync();
}

// --- Arena layout computation ---

export function computeArenaLayout(tournamentId: string, matchCount: number): ArenaLayout {
  const doubleModuleCount = Math.floor(matchCount / 2);
  const needsSingle = matchCount % 2 !== 0;

  const modules: ArenaModule[] = [];
  let tableNumber = 1;
  const tables: ArenaTable[] = [];

  for (let i = 0; i < doubleModuleCount; i++) {
    const moduleId = `${tournamentId}_double_${i}`;
    modules.push({ instanceId: moduleId, type: 'double', order: i });

    tables.push({
      runtimeTableId: `${tournamentId}_table_${tableNumber}`,
      tableNumber,
      moduleInstanceId: moduleId,
      localSlotId: 'table_slot_left',
    });
    tableNumber++;

    tables.push({
      runtimeTableId: `${tournamentId}_table_${tableNumber}`,
      tableNumber,
      moduleInstanceId: moduleId,
      localSlotId: 'table_slot_right',
    });
    tableNumber++;
  }

  if (needsSingle) {
    const moduleId = `${tournamentId}_single_0`;
    modules.push({ instanceId: moduleId, type: 'single', order: doubleModuleCount });

    tables.push({
      runtimeTableId: `${tournamentId}_table_${tableNumber}`,
      tableNumber,
      moduleInstanceId: moduleId,
      localSlotId: 'table_slot_center',
    });
    tableNumber++;
  }

  const endOrder = doubleModuleCount + (needsSingle ? 1 : 0);
  modules.push({ instanceId: `${tournamentId}_end_0`, type: 'end', order: endOrder });

  return { modules, tables };
}

// --- Helper functions ---

async function createRoundRecords(
  instanceId: string,
  swissId: string,
  swissT: Tournament,
  roundNumber: number,
  layout: ArenaLayout,
  registrations: any[],
): Promise<void> {
  const db = getClient();

  const round = swissT.rounds.find(r => r.number === roundNumber);
  if (!round) return;

  const { data: existingRound } = await db
    .from('tournament_rounds')
    .select('id')
    .eq('tournament_id', instanceId)
    .eq('round_number', roundNumber)
    .maybeSingle();

  let roundId: string;
  if (existingRound) {
    roundId = existingRound.id;
  } else {
    const { data: newRound, error: roundErr } = await db
      .from('tournament_rounds')
      .insert({
        tournament_id: instanceId,
        round_number: roundNumber,
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (roundErr || !newRound) {
      // Throw so the tick aborts BEFORE the round_active transition and
      // retries next cycle (createRoundRecords is idempotent).
      throw new Error(`round insert failed for ${instanceId} r${roundNumber}: ${roundErr?.message ?? 'no row returned'}`);
    }
    roundId = newRound.id;
  }

  const playerMap = new Map<number, { playerId: string; username: string }>();
  for (const player of swissT.players) {
    if (!player.tpn) continue;
    const reg = registrations.find(r => r.username === player.name);
    if (reg) {
      playerMap.set(player.tpn, { playerId: reg.player_id, username: reg.username });
    }
  }

  const now = new Date();
  const presenceDeadline = new Date(now.getTime() + 120_000).toISOString();

  for (const pairing of round.pairings) {
    const white = playerMap.get(pairing.whiteTpn);
    const black = playerMap.get(pairing.blackTpn);
    const table = layout.tables.find(t => t.tableNumber === pairing.board);

    const { data: existing } = await db
      .from('tournament_pairings')
      .select('id')
      .eq('tournament_id', instanceId)
      .eq('round_number', roundNumber)
      .eq('board_number', pairing.board)
      .maybeSingle();

    if (existing) continue;

    const { error: pairErr } = await db
      .from('tournament_pairings')
      .insert({
        tournament_id: instanceId,
        round_id: roundId,
        round_number: roundNumber,
        board_number: pairing.board,
        white_player_id: white?.playerId || null,
        black_player_id: black?.playerId || null,
        white_username: white?.username || null,
        black_username: black?.username || null,
        table_number: table?.tableNumber || pairing.board,
        runtime_table_id: table?.runtimeTableId || null,
        is_bye: false,
        presence_deadline: presenceDeadline,
      });
    if (pairErr) {
      // A missing pairing would leave the round permanently incomplete.
      // Abort before the round_active transition; the tick retries and this
      // function is idempotent (existing pairings are skipped).
      throw new Error(`pairing insert failed (${instanceId} r${roundNumber} b${pairing.board}): ${pairErr.message}`);
    }
  }

  if (round.bye) {
    const byePlayer = playerMap.get(round.bye.tpn);
    if (byePlayer) {
      const { data: existing } = await db
        .from('tournament_pairings')
        .select('id')
        .eq('tournament_id', instanceId)
        .eq('round_number', roundNumber)
        .eq('is_bye', true)
        .maybeSingle();

      if (!existing) {
        const { error: byeErr } = await db
          .from('tournament_pairings')
          .insert({
            tournament_id: instanceId,
            round_id: roundId,
            round_number: roundNumber,
            board_number: 0,
            table_number: 0,
            is_bye: true,
            bye_player_id: byePlayer.playerId,
            result: 'bye',
            result_reason: 'bye',
            completed_at: new Date().toISOString(),
          });
        if (byeErr) {
          throw new Error(`bye pairing insert failed (${instanceId} r${roundNumber}): ${byeErr.message}`);
        }
      }
    }
  }
}

// Color-relative results, flipped. Used when the attached swiss engine has a
// board's colors inverted relative to the published pairing (split-brain).
const FLIPPED_RESULTS: Partial<Record<GameResult, GameResult>> = {
  '1-0': '0-1',
  '0-1': '1-0',
  '+/-': '-/+',
  '-/+': '+/-',
};

async function saveStandings(instanceId: string, swissId: string): Promise<void> {
  const db = getClient();
  const swissT = await service.getTournament(swissId);
  if (!swissT || swissT.standings.length === 0) return;

  const histories = computeAllHistories(swissT);

  const { data: regs } = await db
    .from('tournament_registrations')
    .select('player_id, username')
    .eq('tournament_id', instanceId);

  const usernameToUuid = new Map<string, string>();
  if (regs) {
    for (const r of regs) {
      usernameToUuid.set(r.username, r.player_id);
    }
  }

  const rows = swissT.standings.map((s, i) => {
    const history = histories.get(s.tpn);
    const realPlayerId = usernameToUuid.get(s.name) || s.playerId;

    let wins = 0;
    let draws = 0;
    let losses = 0;
    if (history) {
      wins = history.wins + history.winsByForfeit;
      draws = history.draws;
      losses = history.losses + history.lossesByForfeit + history.doubleAbsences;
    }

    return {
      tournament_id: instanceId,
      player_id: realPlayerId,
      username: s.name,
      rating: s.rating,
      position: s.position,
      points: s.points,
      wins,
      draws,
      losses,
      buchholz: s.tiebreak.buchholz,
      buchholz_cut1: s.tiebreak.buchholzCut1,
      sonneborn_berger: s.tiebreak.sonnebornBerger,
      progressive: s.tiebreak.progressiveScore,
      is_champion: i === 0,
    };
  });

  const { error: deleteError } = await db
    .from('tournament_standings')
    .delete()
    .eq('tournament_id', instanceId);

  if (deleteError) {
    console.error('[Coordinator] saveStandings delete error:', deleteError.message);
  }

  if (rows.length > 0) {
    const { error: insertError } = await db.from('tournament_standings').insert(rows);
    if (insertError) {
      console.error('[Coordinator] saveStandings insert error:', insertError.message);
    }
  }
}

async function atomicTransition(id: string, fromStatus: string, toStatus: string): Promise<boolean> {
  const db = getClient();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('tournament_instances')
    .update({ status: toStatus, transition_lock: now })
    .eq('id', id)
    .eq('status', fromStatus)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    console.warn(`[Coordinator] Transition ${fromStatus} -> ${toStatus} failed for ${id}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Randomize mode: pools of settings a randomized tournament can roll from.
// Interval pool mirrors the options offered in the admin UI.
const RANDOM_INTERVALS = [60, 3600, 7200, 10800, 14400, 21600, 28800, 36000, 54000, 86400];
const RANDOM_TIME_CONTROLS: TournamentConfig['timeControl'][] = [
  { category: 'bullet', baseTimeSeconds: 60, incrementSeconds: 0, displayLabel: '1+0' },
  { category: 'bullet', baseTimeSeconds: 60, incrementSeconds: 1, displayLabel: '1+1' },
  { category: 'bullet', baseTimeSeconds: 120, incrementSeconds: 1, displayLabel: '2+1' },
  { category: 'blitz', baseTimeSeconds: 180, incrementSeconds: 0, displayLabel: '3+0' },
  { category: 'blitz', baseTimeSeconds: 180, incrementSeconds: 2, displayLabel: '3+2' },
  { category: 'blitz', baseTimeSeconds: 300, incrementSeconds: 0, displayLabel: '5+0' },
  { category: 'rapid', baseTimeSeconds: 600, incrementSeconds: 0, displayLabel: '10+0' },
  { category: 'rapid', baseTimeSeconds: 600, incrementSeconds: 5, displayLabel: '10+5' },
  { category: 'rapid', baseTimeSeconds: 900, incrementSeconds: 10, displayLabel: '15+10' },
];
// 'manual' excluded on purpose: it needs a human-chosen round count.
const RANDOM_ROUND_MODES: RoundMode[] = ['auto-normal', 'auto-fast'];
const RANDOM_INITIAL_COLORS: (Color | 'random')[] = ['random', 'w', 'b'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function rollRandomConfig(base: TournamentConfig): TournamentConfig {
  return {
    intervalSeconds: pickRandom(RANDOM_INTERVALS),
    timeControl: { ...pickRandom(RANDOM_TIME_CONTROLS) },
    swissConfig: {
      ...base.swissConfig,
      roundMode: pickRandom(RANDOM_ROUND_MODES),
      initialColor: pickRandom(RANDOM_INITIAL_COLORS),
      manualRoundCount: null,
    },
    randomize: true,
  };
}

// Serializes concurrent schedulers (completion path + tick) so the
// check-then-insert below can't race and create DUPLICATE pending cycles —
// duplicates make the room and clients disagree about which tournament is
// "current" and silently break registration.
let ensureCycleQueue: Promise<void> = Promise.resolve();

function ensureNextCycleExists(): Promise<void> {
  const run = ensureCycleQueue.then(() => ensureNextCycleExistsInner());
  ensureCycleQueue = run.catch(() => {}); // keep the chain alive on failure
  return run;
}

async function ensureNextCycleExistsInner(): Promise<void> {
  const db = getClient();

  // Plain list query (no .maybeSingle()): if duplicates ever exist, we must
  // still detect them as "pending" instead of erroring into a re-insert.
  const { data: pendingRows } = await db
    .from('tournament_instances')
    .select('id')
    .eq('status', 'registration_open')
    .limit(2);

  if (pendingRows && pendingRows.length > 0) return;

  const config = await loadConfig();
  // Randomize mode: roll this cycle's settings NOW and freeze them in the
  // instance snapshot, so the registration panel can show the real settings.
  const rolled = config.randomize ? rollRandomConfig(config) : null;
  const intervalSeconds = rolled ? rolled.intervalSeconds : config.intervalSeconds;
  const startsAt = new Date(Date.now() + intervalSeconds * 1000).toISOString();

  const row: Record<string, unknown> = {
    status: 'registration_open',
    starts_at: startsAt,
  };
  if (rolled) row.config_snapshot = rolled;

  const { error } = await db
    .from('tournament_instances')
    .insert(row);

  if (error) {
    console.error('[Coordinator] FAILED to schedule next tournament:', error.message);
    return;
  }

  if (rolled) {
    console.log(
      `[Coordinator] Next tournament scheduled at ${startsAt} (randomized: ${rolled.timeControl.displayLabel}, interval ${intervalSeconds}s, ${rolled.swissConfig.roundMode}/${rolled.swissConfig.initialColor})`
    );
  } else {
    console.log(`[Coordinator] Next tournament scheduled at ${startsAt}`);
  }
}

export async function loadConfig(): Promise<TournamentConfig> {
  const db = getClient();
  const { data } = await db
    .from('tournament_config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

  if (!data) {
    return {
      intervalSeconds: 10800,
      timeControl: { category: 'blitz', baseTimeSeconds: 300, incrementSeconds: 0, displayLabel: '5+0' },
      swissConfig: { roundMode: 'auto-normal', initialColor: 'random', manualRoundCount: null, scoring: 'standard', tiebreaks: ['buchholz_cut1', 'buchholz', 'sonneborn_berger', 'progressive'] },
      randomize: false,
    };
  }

  // randomize and woTimeoutSeconds live inside the swiss_config JSONB (no DDL
  // access to add dedicated columns); strip them out so swissConfig stays
  // clean for the engine.
  const rawSwiss = { ...(data.swiss_config || {}) };
  const randomize = !!rawSwiss.randomize;
  const woTimeoutSeconds = typeof rawSwiss.woTimeoutSeconds === 'number' ? rawSwiss.woTimeoutSeconds : 30;
  const maxDrawOffers = typeof rawSwiss.maxDrawOffers === 'number' ? rawSwiss.maxDrawOffers : 2;
  delete rawSwiss.randomize;
  delete rawSwiss.woTimeoutSeconds;
  delete rawSwiss.maxDrawOffers;

  return {
    intervalSeconds: data.interval_seconds,
    timeControl: data.time_control,
    swissConfig: rawSwiss,
    randomize,
    woTimeoutSeconds,
    maxDrawOffers,
  };
}

export async function saveConfig(config: TournamentConfig, userId?: string): Promise<void> {
  const db = getClient();

  await db
    .from('tournament_config')
    .upsert({
      id: 'default',
      interval_seconds: config.intervalSeconds,
      time_control: config.timeControl,
      swiss_config: {
        ...config.swissConfig,
        randomize: !!config.randomize,
        woTimeoutSeconds: config.woTimeoutSeconds ?? 30,
        maxDrawOffers: config.maxDrawOffers ?? 2,
      },
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }, { onConflict: 'id' });

  const { data: active } = await db
    .from('tournament_instances')
    .select('id, status')
    .in('status', ['starting', 'round_active', 'between_rounds', 'finalizing'])
    .maybeSingle();

  if (!active) {
    const { data: pending } = await db
      .from('tournament_instances')
      .select('id')
      .eq('status', 'registration_open')
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pending) {
      if (config.randomize) {
        // Randomize on: (re)roll the upcoming cycle so the panel and the
        // start time reflect randomized settings immediately.
        const rolled = rollRandomConfig(config);
        await db
          .from('tournament_instances')
          .update({
            starts_at: new Date(Date.now() + rolled.intervalSeconds * 1000).toISOString(),
            config_snapshot: rolled,
          })
          .eq('id', pending.id);
      } else {
        // Normal mode: follow the live config again (also clears any
        // previously rolled snapshot from randomize mode).
        const newStartsAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString();
        await db
          .from('tournament_instances')
          .update({ starts_at: newStartsAt, config_snapshot: null })
          .eq('id', pending.id);
      }
    }
  }
}

// --- Query helpers for Room state ---

export async function getCurrentInstance(): Promise<TournamentInstance | null> {
  const db = getClient();

  const { data } = await db
    .from('tournament_instances')
    .select('*')
    .not('status', 'in', '("completed","cancelled_insufficient_players")')
    .is('config_snapshot->decoy', null) // never surface decoy traps (see processTransitions)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return mapInstance(data);
}

export async function getLatestCompletedInstance(): Promise<TournamentInstance | null> {
  const db = getClient();
  // completed_at IS NULL rows (e.g. manually completed orphans) sort FIRST
  // on a plain DESC order in Postgres and would shadow every real tournament
  // here forever — exclude them and pin nullsFirst off.
  const { data } = await db
    .from('tournament_instances')
    .select('*')
    .eq('status', 'completed')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return mapInstance(data);
}

export async function getLatestCancelledInstance(): Promise<TournamentInstance | null> {
  const db = getClient();
  const { data } = await db
    .from('tournament_instances')
    .select('*')
    .eq('status', 'cancelled_insufficient_players')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return mapInstance(data);
}

export async function getRegistrations(tournamentId: string): Promise<Registration[]> {
  const db = getClient();
  const { data } = await db
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('registered_at', { ascending: true });

  return (data || []).map((r: any) => ({
    id: r.id,
    tournamentId: r.tournament_id,
    playerId: r.player_id,
    username: r.username,
    rating: r.rating,
    registeredAt: r.registered_at,
  }));
}

export async function registerPlayer(tournamentId: string, playerId: string, username: string, rating: number): Promise<{ success: boolean; error?: string }> {
  const db = getClient();

  const { data: instance } = await db
    .from('tournament_instances')
    .select('status')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!instance || instance.status !== 'registration_open') {
    return { success: false, error: 'Inscrições encerradas' };
  }

  // Authoritative identity: use the in-game nickname and real rating from
  // profiles. Client-supplied values used to be the email prefix + a
  // hardcoded 1200 and leaked into pairings/standings.
  let finalUsername = username;
  let finalRating = rating;
  const { data: profile } = await db
    .from('profiles')
    .select('username, rating')
    .eq('user_id', playerId)
    .maybeSingle();
  if (profile?.username) finalUsername = profile.username;
  if (typeof profile?.rating === 'number') finalRating = profile.rating;

  const { error } = await db
    .from('tournament_registrations')
    .insert({
      tournament_id: tournamentId,
      player_id: playerId,
      username: finalUsername,
      rating: finalRating,
    });

  if (error) {
    if (error.code === '23505') return { success: false, error: 'Já inscrito' };
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function unregisterPlayer(tournamentId: string, playerId: string): Promise<{ success: boolean; error?: string }> {
  const db = getClient();

  const { data: instance } = await db
    .from('tournament_instances')
    .select('status')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!instance || instance.status !== 'registration_open') {
    return { success: false, error: 'Inscrições encerradas' };
  }

  await db
    .from('tournament_registrations')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId);

  return { success: true };
}

export async function getPairings(tournamentId: string, roundNumber?: number): Promise<PairingRecord[]> {
  const db = getClient();
  let query = db
    .from('tournament_pairings')
    .select('*')
    .eq('tournament_id', tournamentId);

  if (roundNumber !== undefined) {
    query = query.eq('round_number', roundNumber);
  }

  query = query
    .order('round_number', { ascending: true })
    .order('board_number', { ascending: true });

  const { data } = await query;
  return (data || []).map(mapPairing);
}

export async function getStandings(tournamentId: string): Promise<any[]> {
  const db = getClient();
  const { data } = await db
    .from('tournament_standings')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('position', { ascending: true });

  return data || [];
}

const advanceLocks = new Map<string, Promise<void>>();

async function lockedAdvanceRound(tournamentId: string): Promise<void> {
  // True serialized queue: chain onto the tail so concurrent callers run
  // strictly one-after-another (awaiting a shared promise and then all
  // proceeding in parallel was NOT mutual exclusion).
  const prev = advanceLocks.get(tournamentId) ?? Promise.resolve();
  const p = prev.then(async () => {
    try {
      await tryAdvanceRound(tournamentId);
      await notifyRoomSync();
    } catch (err: any) {
      console.error('[Coordinator] lockedAdvanceRound error:', err.message);
    }
  });
  advanceLocks.set(tournamentId, p);
  await p;
  if (advanceLocks.get(tournamentId) === p) advanceLocks.delete(tournamentId);
}

// The DB has CHECK tournament_pairings_result_reason_check allowing only:
// checkmate, resignation, timeout, disconnect, forfeit, draw, stalemate.
// The game engine produces other strings (resign, abandon, repetition, ...);
// writing them used to violate the constraint SILENTLY and leave the pairing
// unresolved forever (stuck tournaments). Map everything to allowed values.
const DB_ALLOWED_REASONS = new Set(['checkmate', 'resignation', 'timeout', 'disconnect', 'forfeit', 'draw', 'stalemate']);
const DB_REASON_MAP: Record<string, string> = {
  resign: 'resignation',
  abandon: 'disconnect',
  repetition: 'draw',
  insufficient: 'draw',
  agreement: 'draw',
  normal: 'draw',
};
function toDbReason(reason: string, result: string): string {
  const mapped = DB_REASON_MAP[reason] || reason;
  if (DB_ALLOWED_REASONS.has(mapped)) return mapped;
  return result === '1/2-1/2' ? 'draw' : 'forfeit';
}

export async function reportMatchResult(
  tournamentId: string,
  roundNumber: number,
  boardNumber: number,
  result: string,
  reason: string,
): Promise<boolean> {
  const db = getClient();

  const { data, error } = await db
    .from('tournament_pairings')
    .update({
      result,
      result_reason: toDbReason(reason, result),
      completed_at: new Date().toISOString(),
      presence_deadline: null,
    })
    .eq('tournament_id', tournamentId)
    .eq('round_number', roundNumber)
    .eq('board_number', boardNumber)
    .is('result', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(`[Coordinator] reportMatchResult update FAILED (t=${tournamentId.slice(0, 8)} r${roundNumber} b${boardNumber} ${result}/${reason}):`, error.message);
  }

  if (data) {
    await lockedAdvanceRound(tournamentId);
  }

  return !!data;
}

export interface PendingPairing {
  tournamentId: string;
  roundNumber: number;
  boardNumber: number;
  whitePlayerId: string | null;
  blackPlayerId: string | null;
  updated: boolean;
}

export async function reportMatchResultByRuntimeTableId(
  runtimeTableId: string,
  result: string,
  reason: string,
): Promise<PendingPairing | null> {
  const db = getClient();

  const { data: row } = await db
    .from('tournament_pairings')
    .select('tournament_id, round_number, board_number, white_player_id, black_player_id')
    .eq('runtime_table_id', runtimeTableId)
    .is('result', null)
    .eq('is_bye', false)
    .maybeSingle();

  if (!row) return null;

  const updated = await reportMatchResult(
    row.tournament_id,
    row.round_number,
    row.board_number,
    result,
    reason,
  );

  return {
    tournamentId: row.tournament_id,
    roundNumber: row.round_number,
    boardNumber: row.board_number,
    whitePlayerId: row.white_player_id,
    blackPlayerId: row.black_player_id,
    updated,
  };
}

// --- Engine ownership -------------------------------------------------------
// Only the coordinator that CREATED (claimed) the swiss engine may run the
// active-phase state machine for an instance. Two coordinators sharing one DB
// (e.g. cloud + local dev) each held an in-memory engine copy and persisted
// whole-JSON snapshots last-write-wins, silently swallowing round results and
// bye points. Ownership is process-local; a takeover is allowed only when the
// owner's heartbeat (transition_lock, refreshed every tick) has gone stale.
const ownedEngines = new Set<string>();
const OWNER_HEARTBEAT_STALE_MS = 60_000;

// Stable identity of THIS coordinator process for the engine-ownership lease
// (stored in config_snapshot.engine_owner; transitions never touch it, so the
// heartbeat can CAS on it without racing our own transition_lock writes).
const COORDINATOR_ID = crypto.randomUUID();

function isEngineOwned(swissId: string | null): boolean {
  return !!swissId && ownedEngines.has(swissId);
}

// How long a coordinator hosting NONE of the registered players defers the
// engine claim, giving the coordinator that actually hosts them time to claim.
const CLAIM_GRACE_MS = 15_000;

function hostsPlayer(playerId: string): boolean {
  for (const room of worldRooms) {
    try {
      if (room.hasPlayerById?.(playerId)) return true;
    } catch { /* disposed */ }
  }
  const lobby = getTournamentRoomInstance();
  try {
    if (lobby?.isPlayerPresent?.(playerId)) return true;
  } catch { /* disposed */ }
  return false;
}

async function ensureEngineOwnership(instance: TournamentInstance): Promise<boolean> {
  // No engine attached: nothing to own; let the normal (terminal) paths run.
  if (!instance.swissTournamentId) return true;
  const db = getClient();

  if (ownedEngines.has(instance.swissTournamentId)) {
    // Lease heartbeat: refresh liveness ONLY while the DB still records this
    // process as the engine owner. If another coordinator took over during a
    // long stall (suspend/partition), this CAS matches 0 rows and we demote
    // ourselves instead of resurrecting as a second owner — dual owners mean
    // two in-memory engine copies whose last-write-wins persists silently eat
    // results.
    const { data: kept, error } = await db
      .from('tournament_instances')
      .update({ transition_lock: new Date().toISOString() })
      .eq('id', instance.id)
      .eq('config_snapshot->>engine_owner', COORDINATOR_ID)
      .select('id');
    if (error) {
      console.error(`[Coordinator] Ownership heartbeat failed for ${instance.id}: ${error.message}`);
      return false; // unknown lease state — fail closed this tick
    }
    if (!kept || kept.length === 0) {
      console.warn(
        `[Coordinator] Lost engine lease for ${instance.id} — another coordinator took over; demoting and evicting local engine copy`
      );
      ownedEngines.delete(instance.swissTournamentId);
      service.evictTournament(instance.swissTournamentId);
      return false;
    }
    return true;
  }

  const hb = instance.transitionLock ? new Date(instance.transitionLock).getTime() : 0;
  const age = Date.now() - hb;
  if (age < OWNER_HEARTBEAT_STALE_MS) return false; // live owner elsewhere — hands off

  // Owner heartbeat is stale (crashed/restarted server). Take over atomically:
  // only one coordinator wins this CAS; the lease identity moves to us and the
  // engine is re-loaded fresh from its persisted snapshot (never trust a
  // cached copy from a previous ownership).
  const staleIso = new Date(Date.now() - OWNER_HEARTBEAT_STALE_MS).toISOString();
  const { data: won, error: takeoverErr } = await db
    .from('tournament_instances')
    .update({
      transition_lock: new Date().toISOString(),
      config_snapshot: { ...(instance.configSnapshot ?? {}), engine_owner: COORDINATOR_ID },
    })
    .eq('id', instance.id)
    .or(`transition_lock.is.null,transition_lock.lt.${staleIso}`)
    .select('id');
  if (takeoverErr) {
    console.error(`[Coordinator] Takeover CAS failed for ${instance.id}: ${takeoverErr.message}`);
    return false;
  }
  if (!won || won.length === 0) return false;
  console.warn(
    `[Coordinator] Took over instance ${instance.id} (owner heartbeat stale ${Math.round(age / 1000)}s); engine ${instance.swissTournamentId} re-loaded from DB`
  );
  service.evictTournament(instance.swissTournamentId);
  ownedEngines.add(instance.swissTournamentId);
  return true;
}

async function isPlayerPresent(playerId: string): Promise<boolean | null> {
  // Presence for W.O. purposes means "inside a WORLD room", i.e. the player
  // can actually be seated (force-start included). The registration lobby
  // (TournamentRoom) does NOT count: a player parked only in the lobby can
  // never be force-started, and counting them as present re-armed the
  // presence deadline forever, leaving the round stuck in round_active.
  if (worldRooms.size === 0) {
    // No world rooms on this process: no view of who is online, so make no
    // presence decision at all. Returning "present" here made a room-less
    // coordinator (e.g. the cloud instance during local testing) re-arm
    // deadlines forever, blocking the W.O. the hosting server would apply.
    return null;
  }
  for (const room of worldRooms) {
    try {
      if (room.hasPlayerById?.(playerId)) return true;
    } catch { /* disposed */ }
  }
  return false;
}

function mapInstance(row: any): TournamentInstance {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    configSnapshot: row.config_snapshot,
    currentRound: row.current_round,
    totalRounds: row.total_rounds,
    playerCount: row.player_count,
    arenaLayout: row.arena_layout,
    swissTournamentId: row.swiss_tournament_id,
    transitionLock: row.transition_lock,
  };
}

function mapPairing(row: any): PairingRecord {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    roundId: row.round_id,
    roundNumber: row.round_number,
    boardNumber: row.board_number,
    whitePlayerId: row.white_player_id,
    blackPlayerId: row.black_player_id,
    whiteUsername: row.white_username,
    blackUsername: row.black_username,
    tableNumber: row.table_number,
    runtimeTableId: row.runtime_table_id,
    result: row.result,
    resultReason: row.result_reason,
    isBye: row.is_bye,
    byePlayerId: row.bye_player_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    presenceDeadline: row.presence_deadline,
  };
}

export async function markPairingStarted(tournamentId: string, runtimeTableId: string): Promise<void> {
  const db = getClient();
  // Re-arm the deadline instead of nulling it: the presence sweep only sees
  // pairings with a non-null deadline, so null would make a match that dies
  // without reporting a result (crash/restart) invisible forever. While the
  // board is genuinely playing, the sweep keeps re-arming; if the board
  // vanishes, the deadline expires and normal W.O./presence rules recover.
  await db
    .from('tournament_pairings')
    .update({
      started_at: new Date().toISOString(),
      presence_deadline: new Date(Date.now() + 180_000).toISOString(),
    })
    .eq('tournament_id', tournamentId)
    .eq('runtime_table_id', runtimeTableId)
    .is('started_at', null)
    .is('result', null);
}

export async function updateProfileStats(whitePlayerId: string, blackPlayerId: string, result: string): Promise<void> {
  const db = getClient();
  try {
    if (result === '1-0') {
      await db.rpc('increment_profile_stats', { p_user_id: whitePlayerId, p_is_win: true, p_is_draw: false });
      await db.rpc('increment_profile_stats', { p_user_id: blackPlayerId, p_is_win: false, p_is_draw: false });
    } else if (result === '0-1') {
      await db.rpc('increment_profile_stats', { p_user_id: blackPlayerId, p_is_win: true, p_is_draw: false });
      await db.rpc('increment_profile_stats', { p_user_id: whitePlayerId, p_is_win: false, p_is_draw: false });
    } else if (result === '1/2-1/2') {
      await db.rpc('increment_profile_stats', { p_user_id: whitePlayerId, p_is_win: false, p_is_draw: true });
      await db.rpc('increment_profile_stats', { p_user_id: blackPlayerId, p_is_win: false, p_is_draw: true });
    }
  } catch (err: any) {
    console.error('[Coordinator] updateProfileStats error:', err.message);
  }
}

export interface TournamentMatchCreateParams {
  colyseusMatchId: string;
  tournamentId: string;
  roundNumber: number;
  boardNumber: number;
  runtimeTableId: string;
  whiteUserId: string;
  blackUserId: string;
  region: string;
  fen: string;
  timeMinutes: number;
  incrementSeconds: number;
  whiteTimeMs: number;
  blackTimeMs: number;
}

export async function createTournamentMatch(params: TournamentMatchCreateParams): Promise<string | null> {
  try {
    const db = getClient();
    // This DB has no unique constraint on colyseus_match_id, so
    // upsert(onConflict) fails with "no unique or exclusion constraint".
    // startMatch calls this once per match; check-then-insert is enough.
    const { data: existing } = await db
      .from('matches')
      .select('id')
      .eq('colyseus_match_id', params.colyseusMatchId)
      .maybeSingle();
    if (existing?.id) return existing.id;

    const { data, error } = await db
      .from('matches')
      .insert(
        {
          colyseus_match_id: params.colyseusMatchId,
          tournament_id: params.tournamentId,
          tournament_round: params.roundNumber,
          tournament_board_number: params.boardNumber,
          runtime_table_id: params.runtimeTableId,
          board_id: null,
          white_user_id: params.whiteUserId,
          black_user_id: params.blackUserId,
          region: params.region,
          current_fen: params.fen,
          pgn: '',
          status: 'playing',
          turn: 'w',
          time_minutes: params.timeMinutes,
          increment_seconds: params.incrementSeconds,
          white_time_ms: params.whiteTimeMs,
          black_time_ms: params.blackTimeMs,
          last_move_at: new Date().toISOString(),
        }
      )
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[Coordinator] createTournamentMatch error:', error.message);
      return null;
    }
    console.log(`[Coordinator] Tournament match persisted: colyseus=${params.colyseusMatchId}, db=${data?.id}`);
    return data?.id || null;
  } catch (err: any) {
    console.error('[Coordinator] createTournamentMatch exception:', err.message);
    return null;
  }
}

export interface TournamentMatchFinishParams {
  colyseusMatchId: string;
  status: string;
  result: string;
  tournamentScore: string | null;
  winnerId: string | null;
  fen: string;
  pgn: string;
  turn: string;
  whiteTimeMs: number;
  blackTimeMs: number;
}

export async function finishTournamentMatch(params: TournamentMatchFinishParams): Promise<void> {
  try {
    const db = getClient();
    const { error } = await db
      .from('matches')
      .update({
        status: params.status,
        result: params.result,
        tournament_score: params.tournamentScore,
        winner_user_id: params.winnerId,
        current_fen: params.fen,
        pgn: params.pgn,
        turn: params.turn,
        white_time_ms: params.whiteTimeMs,
        black_time_ms: params.blackTimeMs,
        finished_at: new Date().toISOString(),
      })
      .eq('colyseus_match_id', params.colyseusMatchId);

    if (error) {
      console.error('[Coordinator] finishTournamentMatch error:', error.message);
    } else {
      console.log(`[Coordinator] Tournament match finished: colyseus=${params.colyseusMatchId}, result=${params.result}`);
    }
  } catch (err: any) {
    console.error('[Coordinator] finishTournamentMatch exception:', err.message);
  }
}

