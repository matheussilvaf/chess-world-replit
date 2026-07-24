import { nanoid } from 'nanoid';
import type {
  Tournament, Player, Round, Pairing, RoundBye, TPN, Color,
  TournamentConfig, GameResult, PairingDiagnostics, Standing, PlayerId,
  RoundMode, TournamentStatus, GameResultDetail,
} from './types.js';
import { calculateRounds, calculateMaxRounds, calculateAutoNormalRounds, calculateAutoFastRounds } from './rounds.js';
import { serializeTournamentToTRF, parsePairingOutput, type ParsedPairingResult } from './trf.js';
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

// Drop only the in-memory copy (keeps the DB row). Used when this process
// loses or takes over engine ownership: the next getTournament() must reload
// the authoritative DB state instead of trusting a stale local copy.
export function evictTournament(id: string): void {
  tournaments.delete(id);
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
  // Load-on-miss: after an ownership takeover the new owner's cache is empty;
  // a bare map lookup here returned 'Tournament not found', which the
  // coordinator classifies as TERMINAL and would finalize the tournament early.
  const t = await getTournament(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'active') return { success: false, error: 'Tournament not active' };

  const finalizedCount = t.rounds.filter(r => r.finalized).length;
  const nextRoundNumber = finalizedCount + 1;

  // Idempotency FIRST: if the next round already exists unfinalized (a
  // concurrent caller generated it moments ago), converge on success. This
  // check used to sit BELOW the 'Current round not yet finalized' error,
  // making it unreachable for exactly this race — and the transient error
  // bubbled up to the coordinator, which finalized the tournament early.
  const existingUnfinalized = t.rounds.find(r => !r.finalized && r.number === nextRoundNumber);
  if (existingUnfinalized) {
    return { success: true };
  }

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

  const trfContent = serializeTournamentToTRF(t);
  const response = await generatePairing({ trfContent, roundNumber: nextRoundNumber });

  let pairingResult: ParsedPairingResult;
  const diagnostics = response.diagnostics;

  if (response.success && response.result) {
    pairingResult = response.result;

    const validation = validatePairing(t, pairingResult, nextRoundNumber);
    if (!validation.valid) {
      // An invalid engine pairing would either finalize the tournament early
      // or retry forever (the engine reproduces the same output). Treat it
      // like a refusal: let the manual fallback act as arbiter.
      const fallback = buildFallbackPairing(t, nextRoundNumber);
      if (!fallback) {
        diagnostics.violations = validation.errors;
        return { success: false, error: `no pairing possible: ${validation.errors.join('; ')}`, diagnostics };
      }
      console.warn(`[Tournament] Engine pairing invalid for round ${nextRoundNumber} (${validation.errors.join('; ')}); using manual fallback pairing`);
      pairingResult = fallback;
      diagnostics.colorWarnings.push(`Manual fallback pairing used for round ${nextRoundNumber}: engine pairing invalid: ${validation.errors.join('; ')}`);
    } else if (validation.warnings.length > 0) {
      diagnostics.colorWarnings.push(...validation.warnings);
    }
  } else {
    // bbpPairings can legitimately refuse a round. Concrete case: 3 players,
    // one had a bye in R1, another in R2, the third scored a forfeit win —
    // FIDE C.04.1.d blocks all of them from receiving the next bye, so
    // "No valid pairing exists". A human arbiter would override; do the same
    // with a relaxed manual pairing instead of killing the tournament early.
    const engineError = diagnostics.errors.join('; ') || 'engine refused';
    const fallback = buildFallbackPairing(t, nextRoundNumber);
    if (!fallback) {
      return { success: false, error: `no pairing possible: ${engineError}`, diagnostics };
    }
    console.warn(`[Tournament] Engine refused round ${nextRoundNumber} (${engineError}); using manual fallback pairing`);
    pairingResult = fallback;
    diagnostics.errors = [];
    diagnostics.success = true;
    diagnostics.colorWarnings.push(`Manual fallback pairing used for round ${nextRoundNumber}: ${engineError}`);
    const validation = validatePairing(t, pairingResult, nextRoundNumber);
    if (!validation.valid) {
      // Expected under relaxation (repeated bye etc.) — record, don't reject.
      diagnostics.colorWarnings.push(...validation.errors.map(e => `fallback: ${e}`));
    }
  }

  const pairings = orderBoards(t, pairingResult.pairings.map(p => ({
    whiteTpn: p.whiteTpn,
    blackTpn: p.blackTpn,
    result: null,
    isPlayed: true,
    board: 0,
  })));

  const round: Round = {
    number: nextRoundNumber,
    pairings,
    bye: pairingResult.bye ? { tpn: pairingResult.bye, points: 1.0 } : null,
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

/**
 * Emergency pairing when bbpPairings refuses (arbiter override). Relaxation
 * ladder: bye goes to the least-blocked player (fewest byes, then fewest
 * forfeit wins, then lowest score, lowest rank); pairs avoid repeating PLAYED
 * games first, then repeating any scheduled game, then allow anything.
 */
function buildFallbackPairing(t: Tournament, _roundNumber: number): ParsedPairingResult | null {
  const active = t.players.filter(p => p.status === 'active' && p.tpn !== null);
  if (active.length < 2) return null;

  const histories = computeAllHistories(t);
  const points = (tpn: TPN) => histories.get(tpn)?.points ?? 0;

  const byeCounts = new Map<TPN, number>();
  const forfeitWins = new Map<TPN, number>();
  const playedSet = new Map<TPN, Set<TPN>>();
  const metSet = new Map<TPN, Set<TPN>>();
  const whiteCounts = new Map<TPN, number>();

  for (const p of active) {
    const tpn = p.tpn!;
    byeCounts.set(tpn, 0);
    forfeitWins.set(tpn, 0);
    playedSet.set(tpn, new Set());
    metSet.set(tpn, new Set());
    whiteCounts.set(tpn, 0);
  }

  for (const round of t.rounds) {
    if (!round.finalized) continue;
    if (round.bye && byeCounts.has(round.bye.tpn)) {
      byeCounts.set(round.bye.tpn, (byeCounts.get(round.bye.tpn) || 0) + 1);
    }
    for (const pairing of round.pairings) {
      const w = pairing.whiteTpn;
      const b = pairing.blackTpn;
      metSet.get(w)?.add(b);
      metSet.get(b)?.add(w);
      if (whiteCounts.has(w)) whiteCounts.set(w, (whiteCounts.get(w) || 0) + 1);
      if (pairing.isPlayed) {
        playedSet.get(w)?.add(b);
        playedSet.get(b)?.add(w);
      } else {
        if (pairing.result === '+/-') forfeitWins.set(w, (forfeitWins.get(w) || 0) + 1);
        if (pairing.result === '-/+') forfeitWins.set(b, (forfeitWins.get(b) || 0) + 1);
      }
    }
  }

  const sorted = active.map(p => p.tpn!).sort((a, b) => points(b) - points(a) || a - b);

  let bye: TPN | null = null;
  let toPair = sorted;
  if (sorted.length % 2 === 1) {
    const blockScore = (tpn: TPN) => (byeCounts.get(tpn) || 0) * 100 + (forfeitWins.get(tpn) || 0) * 10;
    const byeOrder = [...sorted].sort((a, b) =>
      blockScore(a) - blockScore(b) || points(a) - points(b) || b - a);
    bye = byeOrder[0];
    toPair = sorted.filter(tpn => tpn !== bye);
  }

  const pairs = solvePairs(toPair, playedSet, metSet, points, false)
    ?? solvePairs(toPair, playedSet, metSet, points, true);
  if (!pairs) return null;

  const pairings = pairs.map(([a, b]) => {
    const aWhites = whiteCounts.get(a) || 0;
    const bWhites = whiteCounts.get(b) || 0;
    const aIsWhite = aWhites !== bWhites ? aWhites < bWhites : a < b;
    return aIsWhite ? { whiteTpn: a, blackTpn: b } : { whiteTpn: b, blackTpn: a };
  });

  return { pairings, bye };
}

function solvePairs(
  tpns: TPN[],
  playedSet: Map<TPN, Set<TPN>>,
  metSet: Map<TPN, Set<TPN>>,
  points: (tpn: TPN) => number,
  allowRematch: boolean,
): Array<[TPN, TPN]> | null {
  if (tpns.length === 0) return [];
  const [first, ...rest] = tpns;
  const candidates = rest
    .filter(o => allowRematch || !playedSet.get(first)?.has(o))
    .sort((a, b) => {
      const aMet = metSet.get(first)?.has(a) ? 1 : 0;
      const bMet = metSet.get(first)?.has(b) ? 1 : 0;
      if (aMet !== bMet) return aMet - bMet;
      const aDiff = Math.abs(points(a) - points(first));
      const bDiff = Math.abs(points(b) - points(first));
      return aDiff - bDiff || a - b;
    });
  for (const opp of candidates) {
    const sub = solvePairs(rest.filter(x => x !== opp), playedSet, metSet, points, allowRematch);
    if (sub) return [[first, opp] as [TPN, TPN], ...sub];
  }
  return null;
}

export async function setResult(
  tournamentId: string,
  roundNumber: number,
  board: number,
  result: GameResult,
  isPlayed: boolean
): Promise<void> {
  const t = await getTournament(tournamentId); // load-on-miss (fresh owner cache)
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
  const t = await getTournament(tournamentId); // load-on-miss (fresh owner cache)
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
