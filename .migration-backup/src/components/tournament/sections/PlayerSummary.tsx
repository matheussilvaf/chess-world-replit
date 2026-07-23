import { Trophy, User } from 'lucide-react';

interface Props {
  tournament: any;
}

export function PlayerSummary({ tournament }: Props) {
  const standings = tournament.standings || [];
  const rounds = tournament.rounds || [];
  const finalizedRounds = rounds.filter((r: any) => r.finalized);

  if (standings.length === 0) return null;

  // Tournament-level stats
  const totalGames = finalizedRounds.reduce((sum: number, r: any) => sum + r.pairings.length, 0);
  const totalDraws = finalizedRounds.reduce((sum: number, r: any) =>
    sum + r.pairings.filter((p: any) => p.result === '1/2-1/2').length, 0);
  const totalForfeits = finalizedRounds.reduce((sum: number, r: any) =>
    sum + r.pairings.filter((p: any) => !p.isPlayed).length, 0);
  const totalByes = finalizedRounds.reduce((sum: number, r: any) => sum + (r.bye ? 1 : 0), 0);

  const champion = standings[0];

  return (
    <section className="card">
      <div className="card-header">
        <Trophy className="w-5 h-5 text-amber-400" />
        <h2 className="text-base font-semibold">Tournament Summary</h2>
      </div>

      {/* Champion */}
      {champion && (
        <div className="p-4 border-b border-slate-700/50 text-center">
          <p className="text-xs text-amber-400 uppercase tracking-wider mb-1">Champion</p>
          <p className="text-2xl font-bold text-amber-300">{champion.name}</p>
          <p className="text-sm text-slate-400">{champion.points} points | Rating {champion.rating}</p>
        </div>
      )}

      {/* Tournament Stats */}
      <div className="p-4 border-b border-slate-700/50">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Tournament Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Stat label="Participants" value={tournament.players.length} />
          <Stat label="Rounds Completed" value={finalizedRounds.length} />
          <Stat label="Total Games" value={totalGames} />
          <Stat label="Draws" value={totalDraws} />
          <Stat label="Forfeits" value={totalForfeits} />
          <Stat label="Byes" value={totalByes} />
          <Stat label="Engine" value="bbpPairings v6.0.0" />
          <Stat label="System" value="FIDE Dutch" />
        </div>
      </div>

      {/* Individual summaries */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Individual Results</h3>
        <div className="space-y-3">
          {standings.map((s: any) => (
            <PlayerCard key={s.tpn} standing={s} tournament={tournament} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlayerCard({ standing, tournament }: { standing: any; tournament: any }) {
  const rounds = tournament.rounds.filter((r: any) => r.finalized);

  let wins = 0, draws = 0, losses = 0, winsForfeit = 0, lossesForfeit = 0, doubleAbs = 0;
  let whites = 0, blacks = 0, byes = 0;
  const opponents: { tpn: number; name: string; result: string }[] = [];
  let maxWhiteStreak = 0, maxBlackStreak = 0, curWhite = 0, curBlack = 0;

  for (const round of rounds) {
    if (round.bye?.tpn === standing.tpn) {
      byes++;
      continue;
    }
    for (const p of round.pairings) {
      const isWhite = p.whiteTpn === standing.tpn;
      const isBlack = p.blackTpn === standing.tpn;
      if (!isWhite && !isBlack) continue;

      const oppTpn = isWhite ? p.blackTpn : p.whiteTpn;
      const oppPlayer = tournament.players.find((pl: any) => pl.tpn === oppTpn);

      if (p.isPlayed) {
        if (isWhite) { whites++; curWhite++; curBlack = 0; maxWhiteStreak = Math.max(maxWhiteStreak, curWhite); }
        else { blacks++; curBlack++; curWhite = 0; maxBlackStreak = Math.max(maxBlackStreak, curBlack); }

        const pts = isWhite
          ? (p.result === '1-0' ? 1 : p.result === '1/2-1/2' ? 0.5 : 0)
          : (p.result === '0-1' ? 1 : p.result === '1/2-1/2' ? 0.5 : 0);
        if (pts === 1) wins++;
        else if (pts === 0.5) draws++;
        else losses++;
      } else {
        if (p.result === '-/-') doubleAbs++;
        else if ((isWhite && p.result === '+/-') || (isBlack && p.result === '-/+')) winsForfeit++;
        else lossesForfeit++;
      }

      opponents.push({
        tpn: oppTpn,
        name: oppPlayer?.name || `TPN ${oppTpn}`,
        result: p.result || '?',
      });
    }
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
            standing.position === 1 ? 'bg-amber-500/20 text-amber-400' :
            standing.position <= 3 ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500'
          }`}>
            {standing.position}
          </span>
          <span className="text-sm font-medium text-slate-200">{standing.name}</span>
          <span className="text-xs text-slate-500">TPN {standing.tpn} | {standing.rating}</span>
        </div>
        <span className="text-sm font-bold text-white">{standing.points.toFixed(1)} pts</span>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs text-center">
        <MiniStat label="W" value={wins} color="emerald" />
        <MiniStat label="D" value={draws} color="slate" />
        <MiniStat label="L" value={losses} color="red" />
        <MiniStat label="White" value={whites} color="slate" />
        <MiniStat label="Black" value={blacks} color="slate" />
        <MiniStat label="Byes" value={byes} color="amber" />
      </div>

      {(winsForfeit > 0 || lossesForfeit > 0 || doubleAbs > 0) && (
        <div className="mt-1 flex gap-2 text-xs text-slate-500">
          {winsForfeit > 0 && <span>Forfeit W: {winsForfeit}</span>}
          {lossesForfeit > 0 && <span>Forfeit L: {lossesForfeit}</span>}
          {doubleAbs > 0 && <span>Dbl Abs: {doubleAbs}</span>}
        </div>
      )}

      <div className="mt-1 text-xs text-slate-500">
        W-B diff: {whites - blacks} | Max W streak: {maxWhiteStreak} | Max B streak: {maxBlackStreak}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-slate-800/50 rounded p-2">
      <p className="text-slate-500 text-[10px] uppercase">{label}</p>
      <p className="text-slate-200 font-semibold">{value}</p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded py-0.5 bg-${color}-500/10`}>
      <span className={`text-${color}-400 font-bold`}>{value}</span>
      <span className="text-slate-500 ml-1">{label}</span>
    </div>
  );
}
