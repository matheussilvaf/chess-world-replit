import { useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  tournament: any;
}

export function StandingsSection({ tournament }: Props) {
  const standings = tournament.standings || [];
  const [expandedTpn, setExpandedTpn] = useState<number | null>(null);

  if (standings.length === 0) return null;

  return (
    <section className="card">
      <div className="card-header">
        <BarChart3 className="w-5 h-5 text-purple-400" />
        <h2 className="text-base font-semibold">Standings</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase">
              <th className="px-3 py-2 text-center">#</th>
              <th className="px-3 py-2 text-left">TPN</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Rating</th>
              <th className="px-3 py-2 text-right">Pts</th>
              <th className="px-3 py-2 text-right">BH-C1</th>
              <th className="px-3 py-2 text-right">BH</th>
              <th className="px-3 py-2 text-right">SB</th>
              <th className="px-3 py-2 text-right">Wins</th>
              <th className="px-3 py-2 text-right">Prog</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s: any) => (
              <>
                <tr
                  key={s.tpn}
                  className={`border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/30 transition-colors ${
                    s.position === 1 ? 'bg-amber-500/5' : ''
                  }`}
                  onClick={() => setExpandedTpn(expandedTpn === s.tpn ? null : s.tpn)}
                >
                  <td className="px-3 py-2 text-center font-mono text-slate-400">
                    <span className={s.position === 1 ? 'text-amber-400 font-bold' : ''}>
                      {s.position}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{s.tpn}</td>
                  <td className="px-3 py-2 text-slate-200 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{s.rating}</td>
                  <td className="px-3 py-2 text-right font-bold text-white">{s.points.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{s.tiebreak.buchholzCut1.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{s.tiebreak.buchholz.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{s.tiebreak.sonnebornBerger.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{s.tiebreak.winsPlayed}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{s.tiebreak.progressiveScore.toFixed(1)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs ${s.status === 'active' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.status === 'active' ? 'A' : 'W'}
                    </span>
                  </td>
                </tr>
                {expandedTpn === s.tpn && (
                  <tr key={`${s.tpn}-detail`}>
                    <td colSpan={11} className="px-4 py-3 bg-slate-800/40">
                      <TiebreakDetail tiebreak={s.tiebreak} tournament={tournament} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TiebreakDetail({ tiebreak, tournament }: { tiebreak: any; tournament: any }) {
  const getPlayerName = (tpn: number | null) => {
    if (tpn === null) return '(virtual)';
    const p = tournament.players.find((pl: any) => pl.tpn === tpn);
    return p?.name || `TPN ${tpn}`;
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Opponent Scores (Buchholz) */}
      <div>
        <p className="text-slate-500 font-semibold mb-1">Buchholz Breakdown (opponent scores):</p>
        <div className="flex flex-wrap gap-2">
          {tiebreak.opponentScores.map((opp: any, i: number) => (
            <span key={i} className={`px-2 py-0.5 rounded ${
              opp.adjusted ? 'bg-amber-900/30 border border-amber-700/30 text-amber-300' : 'bg-slate-700/50 text-slate-300'
            } ${opp.score === tiebreak.removedBuchholz && i === tiebreak.opponentScores.findIndex((o: any) => o.score === tiebreak.removedBuchholz) ? 'line-through opacity-60' : ''}`}>
              {getPlayerName(opp.tpn)}: {opp.score.toFixed(1)}{opp.adjusted ? '*' : ''}
            </span>
          ))}
        </div>
        <p className="text-slate-600 mt-1">
          * = adjusted/virtual | Removed (Cut-1): {tiebreak.removedBuchholz.toFixed(1)}
        </p>
      </div>

      {/* Sonneborn-Berger */}
      <div>
        <p className="text-slate-500 font-semibold mb-1">Sonneborn-Berger Breakdown:</p>
        <div className="flex flex-wrap gap-2">
          {tiebreak.sbContributions.map((c: any, i: number) => (
            <span key={i} className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-300">
              {getPlayerName(c.tpn)}: {c.result} x {c.oppScore.toFixed(1)} = {c.contribution.toFixed(2)}
            </span>
          ))}
        </div>
      </div>

      {/* Progressive Score */}
      <div>
        <p className="text-slate-500 font-semibold mb-1">Progressive Score (cumulative per round):</p>
        <div className="flex gap-2">
          {tiebreak.progressiveRounds.map((p: number, i: number) => (
            <span key={i} className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-300">
              R{i + 1}: {p.toFixed(1)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
