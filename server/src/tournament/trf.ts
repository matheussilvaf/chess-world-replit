import type { Tournament, Player, Round, Color, GameResult, TPN } from './types.js';

// TRF16 column positions (1-indexed in FIDE spec)
// Player line: "001" at pos 1-3
// Starting rank: pos 5-8 (4 chars, right-justified)
// Sex: pos 10
// Title: pos 11-13
// Name: pos 15-47 (33 chars)
// FIDE Rating: pos 49-52 (4 chars, right-justified)
// Federation: pos 54-56
// FIDE Number: pos 58-68 (11 chars)
// Birth Date: pos 70-79 (10 chars)
// Points: pos 81-84 (4 chars, format xx.x, right-justified)
// Rank: pos 86-89 (4 chars, right-justified)
// Round data starts at pos 91, each round = 10 chars
//   Opponent: 4 chars right-justified (0000 for bye/no opponent)
//   Space
//   Color: w/b/-
//   Space  
//   Result: 1/0/=/+/-/H/Z/U/F

interface TRFRoundEntry {
  opponent: number; // 0 for bye
  color: string;    // w, b, or -
  result: string;   // 1, 0, =, +, -, H, Z, U, F
}

function mapResultToTRF(result: GameResult, forWhite: boolean, isPlayed: boolean): string {
  if (!isPlayed) {
    // Forfeit results
    if (result === '+/-') return forWhite ? '+' : '-';
    if (result === '-/+') return forWhite ? '-' : '+';
    if (result === '-/-') return 'Z'; // double absence
    // If somehow unplayed but has a normal result, treat as forfeit
    return forWhite
      ? (result === '1-0' ? '+' : result === '0-1' ? '-' : '=')
      : (result === '0-1' ? '+' : result === '1-0' ? '-' : '=');
  }
  // Played results
  if (result === '1-0') return forWhite ? '1' : '0';
  if (result === '0-1') return forWhite ? '0' : '1';
  if (result === '1/2-1/2') return '=';
  // Shouldn't reach here for played games but handle gracefully
  return forWhite ? '1' : '0';
}

function getPlayerPoints(tournament: Tournament, tpn: TPN): number {
  let points = 0;
  for (const round of tournament.rounds) {
    if (!round.finalized) continue;
    // Check bye
    if (round.bye?.tpn === tpn) {
      points += round.bye.points;
      continue;
    }
    // Check pairings
    for (const pairing of round.pairings) {
      if (pairing.result === null) continue;
      if (pairing.whiteTpn === tpn) {
        if (pairing.result === '1-0' || pairing.result === '+/-') points += 1;
        else if (pairing.result === '1/2-1/2') points += 0.5;
      } else if (pairing.blackTpn === tpn) {
        if (pairing.result === '0-1' || pairing.result === '-/+') points += 1;
        else if (pairing.result === '1/2-1/2') points += 0.5;
      }
    }
  }
  return points;
}

function getRoundEntries(tournament: Tournament, tpn: TPN): TRFRoundEntry[] {
  const entries: TRFRoundEntry[] = [];
  for (const round of tournament.rounds) {
    if (!round.finalized && round !== tournament.rounds[tournament.rounds.length - 1]) {
      // Skip unfinalized rounds except the current one being generated
      continue;
    }
    // Check bye
    if (round.bye?.tpn === tpn) {
      entries.push({ opponent: 0, color: '-', result: 'F' }); // F = full-point bye (PAB)
      continue;
    }
    // Check pairings
    let found = false;
    for (const pairing of round.pairings) {
      if (pairing.whiteTpn === tpn) {
        const resultChar = pairing.result
          ? mapResultToTRF(pairing.result, true, pairing.isPlayed)
          : ' ';
        entries.push({
          opponent: pairing.blackTpn,
          color: 'w',
          result: resultChar,
        });
        found = true;
        break;
      } else if (pairing.blackTpn === tpn) {
        const resultChar = pairing.result
          ? mapResultToTRF(pairing.result, false, pairing.isPlayed)
          : ' ';
        entries.push({
          opponent: pairing.whiteTpn,
          color: 'b',
          result: resultChar,
        });
        found = true;
        break;
      }
    }
    if (!found && round.finalized) {
      // Player was withdrawn and not in this round
      entries.push({ opponent: 0, color: '-', result: 'Z' });
    }
  }
  return entries;
}

function formatPlayerLine(tpn: TPN, player: Player, points: number, roundEntries: TRFRoundEntry[]): string {
  // Build a fixed-width line per TRF16 spec
  let line = '001'; // pos 1-3
  line += ' ';      // pos 4
  line += String(tpn).padStart(4, ' '); // pos 5-8
  line += ' ';      // pos 9
  line += ' ';      // pos 10: sex
  line += '   ';    // pos 11-13: title
  line += ' ';      // pos 14
  line += player.name.substring(0, 33).padEnd(33, ' '); // pos 15-47
  line += ' ';      // pos 48
  line += String(player.rating).padStart(4, ' '); // pos 49-52
  line += ' ';      // pos 53
  line += '   ';    // pos 54-56: federation
  line += ' ';      // pos 57
  line += '           '; // pos 58-68: FIDE number (11 chars)
  line += ' ';      // pos 69
  line += '          '; // pos 70-79: birth date (10 chars)
  line += ' ';      // pos 80
  line += points.toFixed(1).padStart(4, ' '); // pos 81-84
  line += ' ';      // pos 85
  line += String(tpn).padStart(4, ' '); // pos 86-89: rank (use TPN)

  for (const entry of roundEntries) {
    line += '  '; // separator before round data
    line += entry.opponent === 0
      ? '0000'
      : String(entry.opponent).padStart(4, ' ');
    line += ' ';
    line += entry.color;
    line += ' ';
    line += entry.result;
  }

  return line;
}

export function serializeTournamentToTRF(tournament: Tournament): string {
  const lines: string[] = [];

  // Tournament header
  lines.push(`012 ${tournament.name}`);
  lines.push(`XXR ${tournament.config.totalRounds}`);
  lines.push(`XXC ${tournament.config.initialColor === 'w' ? 'white1' : 'black1'}`);

  // Active and withdrawn players (all players that have a TPN)
  const playersWithTPN = tournament.players
    .filter(p => p.tpn !== null)
    .sort((a, b) => a.tpn! - b.tpn!);

  for (const player of playersWithTPN) {
    const tpn = player.tpn!;
    const points = getPlayerPoints(tournament, tpn);

    // Only include finalized rounds in TRF
    const finalizedRounds = tournament.rounds.filter(r => r.finalized);
    const roundEntries = getRoundEntries(
      { ...tournament, rounds: finalizedRounds },
      tpn
    );

    const line = formatPlayerLine(tpn, player, points, roundEntries);
    lines.push(line);
  }

  return lines.join('\n') + '\n';
}

export interface ParsedPairing {
  whiteTpn: TPN;
  blackTpn: TPN;
}

export interface ParsedPairingResult {
  pairings: ParsedPairing[];
  bye: TPN | null;
}

export function parsePairingOutput(output: string): ParsedPairingResult {
  const lines = output.trim().split('\n');
  if (lines.length === 0) throw new Error('Empty pairing output');

  const numPairings = parseInt(lines[0].trim(), 10);
  if (isNaN(numPairings)) throw new Error(`Invalid pairing count: ${lines[0]}`);

  const pairings: ParsedPairing[] = [];
  let bye: TPN | null = null;

  for (let i = 1; i <= numPairings; i++) {
    if (i >= lines.length) throw new Error(`Missing pairing line ${i}`);
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length !== 2) throw new Error(`Invalid pairing line: ${lines[i]}`);

    const white = parseInt(parts[0], 10);
    const black = parseInt(parts[1], 10);

    if (isNaN(white) || isNaN(black)) throw new Error(`Invalid TPN in pairing: ${lines[i]}`);

    if (black === 0) {
      bye = white;
    } else {
      pairings.push({ whiteTpn: white, blackTpn: black });
    }
  }

  return { pairings, bye };
}
