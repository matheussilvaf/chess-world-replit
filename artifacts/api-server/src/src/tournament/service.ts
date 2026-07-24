import { nanoid } from 'nanoid';
import type {
  Tournament, Player, Round, Pairing, RoundBye, TPN, Color,
  TournamentConfig, GameResult, PairingDiagnostics, Standing, PlayerId,
  RoundMode, TournamentStatus, GameResultDetail,
} from './types.js';
import { calculateRounds, calculateMaxRounds, calculateAutoNormalRounds, calculateAutoFastRounds } from './rounds.js';
import { serializeTournamentToTRF, parsePairingOutput } from './trf.js';
import { generatePairing, getEngineStatus } from './engine.js';
import { validatePairing, validateAllResults } from './validation.js';
import { computeStandings, computeAllHistories } from './tiebreaks.js';
import { loadAllTestTournaments, loadTournament, saveTournamentToDb, deleteTournamentFromDb } from './persistence.js';

// In-memory cache backed by Supabase persistence
const tournaments = new Map<string, Tournament>();
let cacheLoaded = false;

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const all = await loadAllTestTournaments();
    for (const t of all) {
      tournaments.set(t.id, t);
    }
  } catch (e) {
    console.warn('[Tournament] Failed to load from persistence, using empty cache:', (e as Error).message);
  }
  cacheLoaded = true;
}

async function persist(tournament: Tournament, createdBy?: string): Promise<void> {
  try {
    await saveTournamentToDb(tournament, createdBy, true);
  } catch (e) {
    console.error('[Tournament] Persistence error:', (e as Error).message);
  }
}

export async function listTournaments(): Promise<Tournament[]> {
  await ensureCacheLoaded();
  return Array.from(tournaments.values());
}

export async function getTournament(id: string): Promise<Tournament | null> {
  await ensureCacheLoaded();
  let t = tournaments.get(id) || null;
  if (!t) {
    t = await loadTournament(id);
    if (t) tournaments.set(t.id, t);
  }
  return t;
}

export async function deleteTournament(id: string): Promise<boolean> {
  tournaments.delete(id);
  try { await deleteTournamentFromDb(id); } catch { /* best effort */ }
  return true;
}

export async function createTournament(name: string, createdBy?: string): Promise<Tournament> {
  await ensureCacheLoaded();
  const tournament: Tournament = {
    id: nanoid(),
    name,
    status: 'setup',
    config: {
      roundMode: 'auto-normal',
      totalRounds: 0,
      initialColor: 'w',
    },
    players: [],
    rounds: [],
    standings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tournaments.set(tournament.id, tournament);
  await persist(tournament, createdBy);
  return tournament;
}

export async function addPlayer(tournamentId: string, name: string, rating: number): Promise<Player> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot add players after tournament started');

  const player: Player = {
    id: nanoid(),
    name,
    rating,
    status: 'active',
    tpn: null,
  };
  t.players.push(player);
  t.updatedAt = new Date().toISOString();
  await persist(t);
  return player;
}

export async function removePlayer(tournamentId: string, playerId: PlayerId): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot remove players after tournament started');
  t.players = t.players.filter(p => p.id !== playerId);
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export async function updatePlayer(tournamentId: string, playerId: PlayerId, name: string, rating: number): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot edit players after tournament started');
  const player = t.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  player.name = name;
  player.rating = rating;
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export async function clearPlayers(tournamentId: string): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot clear players after tournament started');
  t.players = [];
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export async function setRoundMode(tournamentId: string, mode: RoundMode, manualCount?: number): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot change config after tournament started');
  t.config.roundMode = mode;
  if (mode === 'manual' && manualCount) {
    t.config.totalRounds = manualCount;
  }
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export async function setInitialColor(tournamentId: string, color: Color | 'random'): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot change config after tournament started');
  if (color === 'random') {
    t.config.initialColor = Math.random() < 0.5 ? 'w' : 'b';
  } else {
    t.config.initialColor = color;
  }
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export function getRoundInfo(playerCount: number, mode: RoundMode, manualCount?: number) {
  const max = calculateMaxRounds(playerCount);
  const autoNormal = calculateAutoNormalRounds(playerCount);
  const autoFast = calculateAutoFastRounds(playerCount);
  let calculated: number;

  switch (mode) {
    case 'auto-normal':
      calculated = autoNormal;
      break;
    case 'auto-fast':
      calculated = autoFast;
      break;
    case 'manual':
      calculated = manualCount || autoNormal;
      break;
  }

  return { calculated, max, autoNormal, autoFast };
}

function assignTPNs(tournament: Tournament): void {
  const sorted = [...tournament.players].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const nameA = a.name.toLowerCase().normalize('NFD');
    const nameB = b.name.toLowerCase().normalize('NFD');
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return a.id < b.id ? -1 : 1;
  });

  sorted.forEach((player, index) => {
    const original = tournament.players.find(p => p.id === player.id)!;
    original.tpn = index + 1;
  });
}

export interface StartResult {
  success: boolean;
  error?: string;
  diagnostics?: PairingDiagnostics;
}

export async function startTournament(tournamentId: string): Promise<StartResult> {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'setup') return { success: false, error: 'Tournament already started' };
  if (t.players.length < 2) return { success: false, error: 'Need at least 2 players' };

  assignTPNs(t);

  const playerCount = t.players.filter(p => p.status === 'active').length;
  t.config.totalRounds = calculateRounds(playerCount, t.config.roundMode,
    t.config.roundMode === 'manual' ? t.config.totalRounds : undefined);

  if (!t.config.initialColor) {
    t.config.initialColor = Math.random() < 0.5 ? 'w' : 'b';
  }

  t.status = 'active';
  t.updatedAt = new Date().toISOString();

  const result = await generateNextRound(tournamentId);
  if (!result.success) {
    t.status = 'setup';
    t.players.forEach(p => { p.tpn = null; });
    return result;
  }

  await persist(t);
  return { success: true, diagnostics: result.diagnostics };
}

export async function generateNextRound(tournamentId: string): Promise<StartResult> {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'active') return { success: false, error: 'Tournament not active' };

  const finalizedCount = t.rounds.filter(r => r.finalized).length;

  if (finalizedCount >= t.config.totalRounds) {
    t.status = 'finished';
    t.standings = computeStandings(t);
    t.updatedAt = new Date().toISOString();
    await persist(t);
    return { success: false, error: 'All rounds completed' };
  }

  if (t.rounds.length > 0 && !t.rounds[t.rounds.length - 1].finalized) {
    return { success: false, error: 'Current round not yet finalized' };
  }

  const activePlayers = t.players.filter(p => p.status === 'active');
  if (activePlayers.length < 2) {
    t.status = 'finished';
    t.standings = computeStandings(t);
    t.updatedAt = new Date().toISOString();
    await persist(t);
    return { success: false, error: 'Fewer than 2 active players' };
  }

  const nextRoundNumber = finalizedCount + 1;

  const existingUnfinalized = t.rounds.find(r => !r.finalized && r.number === nextRoundNumber);
  if (existingUnfinalized) {
    return { success: true };
  }

  const trfContent = serializeTournamentToTRF(t);
  const response = await generatePairing({ trfContent, roundNumber: nextRoundNumber });
  if (!response.success || !response.result) {
    return { success: false, error: response.diagnostics.errors.join('; '), diagnostics: response.diagnostics };
  }

  const validation = validatePairing(t, response.result, nextRoundNumber);
  if (!validation.valid) {
    response.diagnostics.violations = validation.errors;
    return { success: false, error: validation.errors.join('; '), diagnostics: response.diagnostics };
  }
  if (validation.warnings.length > 0) {
    response.diagnostics.colorWarnings.push(...validation.warnings);
  }

  const pairings = orderBoards(t, response.result.pairings.map(p => ({
    whiteTpn: p.whiteTpn,
    blackTpn: p.blackTpn,
    result: null,
    isPlayed: true,
    board: 0,
  })));

  const round: Round = {
    number: nextRoundNumber,
    pairings,
    bye: response.result.bye ? { tpn: response.result.bye, points: 1.0 } : null,
    finalized: false,
  };

  t.rounds.push(round);
  t.updatedAt = new Date().toISOString();

  response.diagnostics.activePlayers = activePlayers.length;
  response.diagnostics.expectedPairings = Math.floor(activePlayers.length / 2);
  response.diagnostics.expectedByes = activePlayers.length % 2;

  await persist(t);
  return { success: true, diagnostics: response.diagnostics };
}

function orderBoards(tournament: Tournament, pairings: Pairing[]): Pairing[] {
  const histories = computeAllHistories(tournament);

  return pairings
    .map(p => {
      const whiteHistory = histories.get(p.whiteTpn);
      const blackHistory = histories.get(p.blackTpn);
      const whitePoints = whiteHistory?.points ?? 0;
      const blackPoints = blackHistory?.points ?? 0;
      const maxPoints = Math.max(whitePoints, blackPoints);
      const sumPoints = whitePoints + blackPoints;
      const minTPN = Math.min(p.whiteTpn, p.blackTpn);
      return { pairing: p, maxPoints, sumPoints, minTPN };
    })
    .sort((a, b) => {
      if (b.maxPoints !== a.maxPoints) return b.maxPoints - a.maxPoints;
      if (b.sumPoints !== a.sumPoints) return b.sumPoints - a.sumPoints;
      return a.minTPN - b.minTPN;
    })
    .map((item, index) => ({ ...item.pairing, board: index + 1 }));
}

export async function setResult(
  tournamentId: string,
  roundNumber: number,
  board: number,
  result: GameResult,
  isPlayed: boolean
): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) throw new Error('Round not found');
  if (round.finalized) throw new Error('Round already finalized');
  const pairing = round.pairings.find(p => p.board === board);
  if (!pairing) throw new Error('Board not found');
  pairing.result = result;
  pairing.isPlayed = isPlayed;
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export interface FinalizeResult {
  success: boolean;
  error?: string;
  standings?: Standing[];
}

export async function finalizeRound(tournamentId: string, roundNumber: number): Promise<FinalizeResult> {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return { success: false, error: 'Round not found' };
  if (round.finalized) return { success: false, error: 'Round already finalized' };

  const validation = validateAllResults(round);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') };
  }

  round.finalized = true;
  t.standings = computeStandings(t);
  t.updatedAt = new Date().toISOString();

  const finalizedCount = t.rounds.filter(r => r.finalized).length;
  if (finalizedCount >= t.config.totalRounds) {
    t.status = 'finished';
  }

  await persist(t);
  return { success: true, standings: t.standings };
}

export async function withdrawPlayer(tournamentId: string, playerId: PlayerId): Promise<void> {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  const player = t.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  player.status = 'withdrawn';
  t.updatedAt = new Date().toISOString();
  await persist(t);
}

export async function correctRound(tournamentId: string, roundNumber: number): Promise<{ success: boolean; error?: string }> {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  const roundIdx = t.rounds.findIndex(r => r.number === roundNumber);
  if (roundIdx === -1) return { success: false, error: 'Round not found' };
  if (!t.rounds[roundIdx].finalized) return { success: false, error: 'Round not finalized yet' };

  t.rounds = t.rounds.slice(0, roundIdx + 1);
  t.rounds[roundIdx].finalized = false;
  t.status = 'active';
  t.standings = computeStandings(t);
  t.updatedAt = new Date().toISOString();
  await persist(t);

  return { success: true };
}

export function getPlayerHistories(tournamentId: string): Map<TPN, any> | null {
  const t = tournaments.get(tournamentId);
  if (!t) return null;
  return computeAllHistories(t);
}

export { getEngineStatus } from './engine.js';

export async function importTournament(data: Tournament, createdBy?: string): Promise<Tournament> {
  tournaments.set(data.id, data);
  await persist(data, createdBy);
  return data;
}
