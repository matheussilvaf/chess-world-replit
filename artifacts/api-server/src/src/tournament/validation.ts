import type { Tournament, Round, Pairing, TPN, Player } from './types.js';
import type { ParsedPairingResult } from './trf.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePairing(
  tournament: Tournament,
  pairingResult: ParsedPairingResult,
  roundNumber: number
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const activePlayers = tournament.players.filter(p => p.status === 'active' && p.tpn !== null);
  const activeTPNs = new Set(activePlayers.map(p => p.tpn!));
  const activeCount = activePlayers.length;
  const isOdd = activeCount % 2 !== 0;
  const expectedPairings = Math.floor(activeCount / 2);
  const expectedByes = isOdd ? 1 : 0;

  // 1. Correct number of pairings
  if (pairingResult.pairings.length !== expectedPairings) {
    errors.push(`Expected ${expectedPairings} pairings, got ${pairingResult.pairings.length}`);
  }

  // 2. Bye exists only when needed
  if (isOdd && !pairingResult.bye) {
    errors.push('Odd number of players but no bye assigned');
  }
  if (!isOdd && pairingResult.bye) {
    errors.push('Even number of players but bye was assigned');
  }

  // 3. All returned players exist and are active
  const seenTPNs = new Set<TPN>();
  for (const p of pairingResult.pairings) {
    if (!activeTPNs.has(p.whiteTpn)) errors.push(`White TPN ${p.whiteTpn} is not an active player`);
    if (!activeTPNs.has(p.blackTpn)) errors.push(`Black TPN ${p.blackTpn} is not an active player`);
    if (p.whiteTpn === p.blackTpn) errors.push(`Player ${p.whiteTpn} paired against themselves`);

    if (seenTPNs.has(p.whiteTpn)) errors.push(`TPN ${p.whiteTpn} appears in multiple pairings`);
    if (seenTPNs.has(p.blackTpn)) errors.push(`TPN ${p.blackTpn} appears in multiple pairings`);
    seenTPNs.add(p.whiteTpn);
    seenTPNs.add(p.blackTpn);
  }

  if (pairingResult.bye) {
    if (!activeTPNs.has(pairingResult.bye)) {
      errors.push(`Bye TPN ${pairingResult.bye} is not an active player`);
    }
    if (seenTPNs.has(pairingResult.bye)) {
      errors.push(`Bye TPN ${pairingResult.bye} also appears in a pairing`);
    }
    seenTPNs.add(pairingResult.bye);
  }

  // 4. All active players accounted for
  for (const tpn of activeTPNs) {
    if (!seenTPNs.has(tpn)) {
      errors.push(`Active player TPN ${tpn} not included in pairings or bye`);
    }
  }

  // 5. No rematches (only for played games)
  const playedOpponents = buildPlayedOpponentsMap(tournament);
  for (const p of pairingResult.pairings) {
    const whiteOpps = playedOpponents.get(p.whiteTpn) || new Set();
    if (whiteOpps.has(p.blackTpn)) {
      errors.push(`Rematch: TPN ${p.whiteTpn} vs TPN ${p.blackTpn} already played`);
    }
  }

  // 6. Bye eligibility - no player should get bye twice
  if (pairingResult.bye) {
    const byeCount = countByes(tournament, pairingResult.bye);
    if (byeCount > 0) {
      errors.push(`TPN ${pairingResult.bye} already received a bye`);
    }
    // Check if player already received full-point forfeit win (same as bye points)
    const forfeitWins = countForfeitWins(tournament, pairingResult.bye);
    if (forfeitWins > 0) {
      warnings.push(`TPN ${pairingResult.bye} already received a forfeit win (bye eligibility edge case)`);
    }
  }

  // 7. Round number check
  const expectedRound = tournament.rounds.filter(r => r.finalized).length + 1;
  if (roundNumber !== expectedRound) {
    errors.push(`Expected round ${expectedRound}, got ${roundNumber}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function buildPlayedOpponentsMap(tournament: Tournament): Map<TPN, Set<TPN>> {
  const map = new Map<TPN, Set<TPN>>();
  for (const round of tournament.rounds) {
    if (!round.finalized) continue;
    for (const pairing of round.pairings) {
      if (!pairing.isPlayed) continue;
      if (!map.has(pairing.whiteTpn)) map.set(pairing.whiteTpn, new Set());
      if (!map.has(pairing.blackTpn)) map.set(pairing.blackTpn, new Set());
      map.get(pairing.whiteTpn)!.add(pairing.blackTpn);
      map.get(pairing.blackTpn)!.add(pairing.whiteTpn);
    }
  }
  return map;
}

function countByes(tournament: Tournament, tpn: TPN): number {
  let count = 0;
  for (const round of tournament.rounds) {
    if (!round.finalized) continue;
    if (round.bye?.tpn === tpn) count++;
  }
  return count;
}

function countForfeitWins(tournament: Tournament, tpn: TPN): number {
  let count = 0;
  for (const round of tournament.rounds) {
    if (!round.finalized) continue;
    for (const pairing of round.pairings) {
      if (!pairing.isPlayed && pairing.result) {
        if ((pairing.whiteTpn === tpn && pairing.result === '+/-') ||
            (pairing.blackTpn === tpn && pairing.result === '-/+')) {
          count++;
        }
      }
    }
  }
  return count;
}

export function validateAllResults(round: Round): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < round.pairings.length; i++) {
    const p = round.pairings[i];
    if (p.result === null) {
      errors.push(`Board ${p.board}: no result entered`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
