import type { Tournament, TPN, Standing, TiebreakDetail, PlayerHistory, GameResult, Player } from './types.js';

export function computeStandings(tournament: Tournament): Standing[] {
  const playersWithTPN = tournament.players.filter(p => p.tpn !== null);
  const histories = computeAllHistories(tournament);
  const totalRoundsPlayed = tournament.rounds.filter(r => r.finalized).length;

  const standings: Standing[] = playersWithTPN.map(player => {
    const tpn = player.tpn!;
    const history = histories.get(tpn)!;
    const tiebreak = computeTiebreaks(tournament, tpn, history, histories, totalRoundsPlayed);

    return {
      position: 0,
      tpn,
      playerId: player.id,
      name: player.name,
      rating: player.rating,
      points: history.points,
      tiebreak,
      status: player.status,
    };
  });

  // Sort by tiebreak criteria
  standings.sort((a, b) => {
    // 1. Total points (descending)
    if (b.points !== a.points) return b.points - a.points;
    // 2. Buchholz Cut-1 (descending)
    if (b.tiebreak.buchholzCut1 !== a.tiebreak.buchholzCut1) return b.tiebreak.buchholzCut1 - a.tiebreak.buchholzCut1;
    // 3. Buchholz (descending)
    if (b.tiebreak.buchholz !== a.tiebreak.buchholz) return b.tiebreak.buchholz - a.tiebreak.buchholz;
    // 4. Sonneborn-Berger (descending)
    if (b.tiebreak.sonnebornBerger !== a.tiebreak.sonnebornBerger) return b.tiebreak.sonnebornBerger - a.tiebreak.sonnebornBerger;
    // 5. Wins in played games (descending)
    if (b.tiebreak.winsPlayed !== a.tiebreak.winsPlayed) return b.tiebreak.winsPlayed - a.tiebreak.winsPlayed;
    // 6. Progressive Score (descending)
    if (b.tiebreak.progressiveScore !== a.tiebreak.progressiveScore) return b.tiebreak.progressiveScore - a.tiebreak.progressiveScore;
    // 7. TPN ascending (deterministic)
    return a.tpn - b.tpn;
  });

  // Assign positions
  standings.forEach((s, i) => { s.position = i + 1; });

  return standings;
}

export function computeAllHistories(tournament: Tournament): Map<TPN, PlayerHistory> {
  const map = new Map<TPN, PlayerHistory>();
  const playersWithTPN = tournament.players.filter(p => p.tpn !== null);

  for (const player of playersWithTPN) {
    const tpn = player.tpn!;
    const history: PlayerHistory = {
      tpn,
      points: 0,
      colors: [],
      opponents: [],
      playedOpponents: [],
      results: [],
      byes: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winsByForfeit: 0,
      lossesByForfeit: 0,
      doubleAbsences: 0,
      whiteGames: 0,
      blackGames: 0,
      upfloats: 0,
      downfloats: 0,
    };

    for (const round of tournament.rounds) {
      if (!round.finalized) continue;

      // Check bye
      if (round.bye?.tpn === tpn) {
        history.points += round.bye.points;
        history.byes++;
        history.colors.push(null);
        history.opponents.push(null);
        history.results.push(null);
        continue;
      }

      // Check pairings
      let foundInRound = false;
      for (const pairing of round.pairings) {
        const isWhite = pairing.whiteTpn === tpn;
        const isBlack = pairing.blackTpn === tpn;
        if (!isWhite && !isBlack) continue;

        foundInRound = true;
        const opponent = isWhite ? pairing.blackTpn : pairing.whiteTpn;

        if (pairing.isPlayed) {
          const color: 'w' | 'b' = isWhite ? 'w' : 'b';
          history.colors.push(color);
          if (color === 'w') history.whiteGames++;
          else history.blackGames++;
          history.playedOpponents.push(opponent);
        } else {
          history.colors.push(null);
        }

        history.opponents.push(opponent);
        history.results.push(pairing.result);

        if (pairing.result) {
          const pointsForMe = getPointsForPlayer(pairing.result, isWhite);
          history.points += pointsForMe;

          if (pairing.isPlayed) {
            if (pointsForMe === 1) history.wins++;
            else if (pointsForMe === 0.5) history.draws++;
            else history.losses++;
          } else {
            if (pairing.result === '-/-') {
              history.doubleAbsences++;
            } else if (pointsForMe === 1) {
              history.winsByForfeit++;
            } else {
              history.lossesByForfeit++;
            }
          }
        }
        break;
      }

      if (!foundInRound) {
        // Player was withdrawn and not in this round
        history.colors.push(null);
        history.opponents.push(null);
        history.results.push(null);
      }
    }

    map.set(tpn, history);
  }

  return map;
}

function getPointsForPlayer(result: GameResult, isWhite: boolean): number {
  switch (result) {
    case '1-0': return isWhite ? 1 : 0;
    case '0-1': return isWhite ? 0 : 1;
    case '1/2-1/2': return 0.5;
    case '+/-': return isWhite ? 1 : 0;
    case '-/+': return isWhite ? 0 : 1;
    case '-/-': return 0;
  }
}

function computeTiebreaks(
  tournament: Tournament,
  tpn: TPN,
  history: PlayerHistory,
  allHistories: Map<TPN, PlayerHistory>,
  totalRoundsPlayed: number
): TiebreakDetail {
  // Compute opponent scores (with virtual opponent adjustments per FIDE rules)
  const opponentScores: { tpn: TPN | null; score: number; adjusted: boolean }[] = [];
  const sbContributions: { tpn: TPN | null; result: number; oppScore: number; contribution: number }[] = [];
  const progressiveRounds: number[] = [];

  let cumulativePoints = 0;

  for (let r = 0; r < history.opponents.length; r++) {
    const opp = history.opponents[r];
    const result = history.results[r];
    const pointsThisRound = result ? getPointsForPlayer(result, getColorForRound(history, r) === 'w') : 0;
    cumulativePoints += pointsThisRound;
    progressiveRounds.push(cumulativePoints);

    if (opp === null) {
      // Bye or unplayed - use virtual opponent score
      // FIDE rule: for PAB/forfeit wins, use player's own score minus 0.5 as virtual opponent score
      // For forfeit losses, use player's own score plus 0.5
      // Clamped to [0, totalRoundsPlayed]
      let virtualScore: number;
      if (result === null || pointsThisRound === 1) {
        // PAB or forfeit win
        virtualScore = Math.max(0, Math.min(totalRoundsPlayed, history.points - 0.5));
      } else {
        // Forfeit loss or double absence
        virtualScore = Math.min(totalRoundsPlayed, history.points + 0.5);
      }
      opponentScores.push({ tpn: null, score: virtualScore, adjusted: true });
      sbContributions.push({ tpn: null, result: pointsThisRound, oppScore: virtualScore, contribution: pointsThisRound * virtualScore });
    } else {
      const oppHistory = allHistories.get(opp);
      if (oppHistory) {
        // Check if this game was unplayed (forfeit)
        const pairing = findPairing(tournament, r, tpn);
        const wasPlayed = pairing?.isPlayed ?? true;

        let oppScore: number;
        let adjusted = false;

        if (!wasPlayed) {
          // For unplayed games, use virtual opponent method
          if (pointsThisRound === 1) {
            oppScore = Math.max(0, Math.min(totalRoundsPlayed, history.points - 0.5));
          } else {
            oppScore = Math.min(totalRoundsPlayed, history.points + 0.5);
          }
          adjusted = true;
        } else {
          oppScore = oppHistory.points;
        }

        opponentScores.push({ tpn: opp, score: oppScore, adjusted });
        sbContributions.push({ tpn: opp, result: pointsThisRound, oppScore, contribution: pointsThisRound * oppScore });
      }
    }
  }

  // Buchholz = sum of all opponent scores
  const allScores = opponentScores.map(o => o.score);
  const buchholz = allScores.reduce((sum, s) => sum + s, 0);

  // Buchholz Cut-1 = Buchholz minus the lowest opponent score
  const minScore = allScores.length > 0 ? Math.min(...allScores) : 0;
  const buchholzCut1 = allScores.length > 1 ? buchholz - minScore : buchholz;
  const removedBuchholz = allScores.length > 1 ? minScore : 0;

  // Sonneborn-Berger = sum of (points scored against opponent * opponent's score)
  const sonnebornBerger = sbContributions.reduce((sum, c) => sum + c.contribution, 0);

  // Progressive score = sum of cumulative scores
  const progressiveScore = progressiveRounds.reduce((sum, s) => sum + s, 0);

  // Wins in actually played games
  const winsPlayed = history.wins;

  return {
    buchholzCut1: Math.round(buchholzCut1 * 100) / 100,
    buchholz: Math.round(buchholz * 100) / 100,
    sonnebornBerger: Math.round(sonnebornBerger * 100) / 100,
    winsPlayed,
    progressiveScore: Math.round(progressiveScore * 100) / 100,
    opponentScores,
    removedBuchholz: Math.round(removedBuchholz * 100) / 100,
    sbContributions,
    progressiveRounds,
  };
}

function getColorForRound(history: PlayerHistory, roundIndex: number): 'w' | 'b' | null {
  return history.colors[roundIndex] || null;
}

function findPairing(tournament: Tournament, roundIndex: number, tpn: TPN) {
  const finalizedRounds = tournament.rounds.filter(r => r.finalized);
  if (roundIndex >= finalizedRounds.length) return null;
  const round = finalizedRounds[roundIndex];
  return round.pairings.find(p => p.whiteTpn === tpn || p.blackTpn === tpn) || null;
}
