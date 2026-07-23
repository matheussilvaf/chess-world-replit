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
let worldRoomInstance: { isBoardPlaying(boardId: string): boolean } | null = null;
export function setWorldRoomInstance(room: { isBoardPlaying(boardId: string): boolean } | null) {
  worldRoomInstance = room;
}
function getWorldRoomInstance() {
  return worldRoomInstance;
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

  const { data: active } = await db
    .from('tournament_instances')
    .select('*')
    .not('status', 'in', '("completed","cancelled_insufficient_players")')
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
      await checkRoundCompletion(instance);
      await checkPresenceDeadlines(instance);
      break;

    case 'between_rounds':
      await transitionToNextRound(instance);
      break;

    case 'finalizing':
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

  const config = await loadConfig();
  await db
    .from('tournament_instances')
    .update({
      config_snapshot: config,
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

      await db
        .from('tournament_instances')
        .update({
          swiss_tournament_id: swissId,
          total_rounds: swissT2.config.totalRounds,
          current_round: 1,
          arena_layout: layout,
        })
        .eq('id', instance.id);

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

    const worldRoom = getWorldRoomInstance();
    if (worldRoom && p.runtime_table_id && worldRoom.isBoardPlaying(p.runtime_table_id)) {
      await db
        .from('tournament_pairings')
        .update({ presence_deadline: null })
        .eq('id', p.id)
        .is('result', null);
      continue;
    }

    let result: string;
    let reason: string;

    const whitePresent = p.white_player_id && await isPlayerPresent(p.white_player_id);
    const blackPresent = p.black_player_id && await isPlayerPresent(p.black_player_id);

    if (whitePresent && blackPresent) {
      await db
        .from('tournament_pairings')
        .update({ presence_deadline: null })
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

    const { data: updated } = await db
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

    console.log(`[Coordinator] Forfeit on board ${p.board_number}: ${result}`);
    if (updated) anyUpdated = true;
  }

  if (anyUpdated) {
    await lockedAdvanceRound(instance.id);
  }
}

async function transitionToNextRound(instance: TournamentInstance): Promise<void> {
  const db = getClient();

  if (!instance.swissTournamentId) return;

  const nextRoundResult = await service.generateNextRound(instance.swissTournamentId);
  if (!nextRoundResult.success) {
    console.error('[Coordinator] Generate next round failed:', nextRoundResult.error);
    await atomicTransition(instance.id, 'between_rounds', 'finalizing');
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

  await db
    .from('tournament_instances')
    .update({ current_round: nextRound })
    .eq('id', instance.id);

  await atomicTransition(instance.id, 'between_rounds', 'round_active');
  console.log(`[Coordinator] Round ${nextRound} started for tournament ${instance.id}`);
}

async function transitionToCompleted(instance: TournamentInstance): Promise<void> {
  const db = getClient();

  if (instance.swissTournamentId) {
    await saveStandings(instance.id, instance.swissTournamentId);
  }

  await db
    .from('tournament_instances')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', instance.id);

  await atomicTransition(instance.id, 'finalizing', 'completed');
  console.log(`[Coordinator] Tournament ${instance.id} completed`);
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
  const swissT = await service.getTournament(instance.swissTournamentId);
  if (!swissT) return;

  for (const p of pairings) {
    if (p.is_bye) continue;
    if (!p.result) continue;

    const round = swissT.rounds.find((r: any) => r.number === instance.currentRound);
    if (!round) continue;

    const pairing = round.pairings.find((pr: any) => pr.board === p.board_number);
    if (!pairing || pairing.result) continue;

    const isPlayed = !['forfeit', 'bye'].includes(p.result_reason || '');
    await service.setResult(
      instance.swissTournamentId,
      instance.currentRound,
      p.board_number,
      p.result as GameResult,
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
    await atomicTransition(instance.id, 'round_active', 'finalizing');
    await transitionToCompleted({ ...instance, status: 'finalizing' } as TournamentInstance);
  } else {
    await atomicTransition(instance.id, 'round_active', 'between_rounds');
    await transitionToNextRound({ ...instance, status: 'between_rounds' } as TournamentInstance);
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
    const { data: newRound } = await db
      .from('tournament_rounds')
      .insert({
        tournament_id: instanceId,
        round_number: roundNumber,
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    roundId = newRound!.id;
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

    await db
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
        await db
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
      }
    }
  }
}

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

async function ensureNextCycleExists(): Promise<void> {
  const db = getClient();

  const { data: pending } = await db
    .from('tournament_instances')
    .select('id')
    .eq('status', 'registration_open')
    .maybeSingle();

  if (pending) return;

  const config = await loadConfig();
  const startsAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString();

  await db
    .from('tournament_instances')
    .insert({
      status: 'registration_open',
      starts_at: startsAt,
    });

  console.log(`[Coordinator] Next tournament scheduled at ${startsAt}`);
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
    };
  }

  return {
    intervalSeconds: data.interval_seconds,
    timeControl: data.time_control,
    swissConfig: data.swiss_config,
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
      swiss_config: config.swissConfig,
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
      .maybeSingle();

    if (pending) {
      const newStartsAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString();
      await db
        .from('tournament_instances')
        .update({ starts_at: newStartsAt })
        .eq('id', pending.id);
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
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return mapInstance(data);
}

export async function getLatestCompletedInstance(): Promise<TournamentInstance | null> {
  const db = getClient();
  const { data } = await db
    .from('tournament_instances')
    .select('*')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
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
    .order('completed_at', { ascending: false })
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

  const { error } = await db
    .from('tournament_registrations')
    .insert({
      tournament_id: tournamentId,
      player_id: playerId,
      username,
      rating,
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
  const existing = advanceLocks.get(tournamentId);
  if (existing) await existing;

  const p = (async () => {
    try {
      await tryAdvanceRound(tournamentId);
      await notifyRoomSync();
    } catch (err: any) {
      console.error('[Coordinator] lockedAdvanceRound error:', err.message);
    } finally {
      advanceLocks.delete(tournamentId);
    }
  })();
  advanceLocks.set(tournamentId, p);
  await p;
}

export async function reportMatchResult(
  tournamentId: string,
  roundNumber: number,
  boardNumber: number,
  result: string,
  reason: string,
): Promise<boolean> {
  const db = getClient();

  const { data } = await db
    .from('tournament_pairings')
    .update({
      result,
      result_reason: reason,
      completed_at: new Date().toISOString(),
      presence_deadline: null,
    })
    .eq('tournament_id', tournamentId)
    .eq('round_number', roundNumber)
    .eq('board_number', boardNumber)
    .is('result', null)
    .select('id')
    .maybeSingle();

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

async function isPlayerPresent(playerId: string): Promise<boolean> {
  const room = getTournamentRoomInstance();
  if (!room) {
    // If room reference not available, assume present (don't auto-forfeit)
    return true;
  }
  return room.isPlayerPresent(playerId);
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
  await db
    .from('tournament_pairings')
    .update({
      started_at: new Date().toISOString(),
      presence_deadline: null,
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
    const { data, error } = await db
      .from('matches')
      .upsert(
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
        },
        { onConflict: 'colyseus_match_id', ignoreDuplicates: false }
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

