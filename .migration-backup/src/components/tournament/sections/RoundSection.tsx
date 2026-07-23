import { tournamentApi } from '../api';
import { Swords, ChevronRight, Lock, AlertTriangle } from 'lucide-react';

interface Props {
  tournament: any;
  onAction: (fn: () => Promise<any>) => void;
}

const RESULT_OPTIONS = [
  { value: '1-0', label: 'White Wins', isPlayed: true },
  { value: '0-1', label: 'Black Wins', isPlayed: true },
  { value: '1/2-1/2', label: 'Draw', isPlayed: true },
  { value: '+/-', label: 'White W. by forfeit', isPlayed: false },
  { value: '-/+', label: 'Black W. by forfeit', isPlayed: false },
  { value: '-/-', label: 'Double Absence', isPlayed: false },
];

export function RoundSection({ tournament, onAction }: Props) {
  const rounds = tournament.rounds || [];
  const currentRound = rounds.find((r: any) => !r.finalized);
  const finalizedRounds = rounds.filter((r: any) => r.finalized);
  const allFinalized = rounds.length > 0 && !currentRound;
  const canGenerateNext = allFinalized && tournament.status === 'active' &&
    finalizedRounds.length < tournament.config.totalRounds;

  const getPlayer = (tpn: number) => {
    return tournament.players.find((p: any) => p.tpn === tpn);
  };

  const getPlayerPoints = (tpn: number): number => {
    let points = 0;
    for (const round of finalizedRounds) {
      if (round.bye?.tpn === tpn) { points += round.bye.points; continue; }
      for (const p of round.pairings) {
        if (p.whiteTpn === tpn) {
          if (p.result === '1-0' || p.result === '+/-') points += 1;
          else if (p.result === '1/2-1/2') points += 0.5;
        } else if (p.blackTpn === tpn) {
          if (p.result === '0-1' || p.result === '-/+') points += 1;
          else if (p.result === '1/2-1/2') points += 0.5;
        }
      }
    }
    return points;
  };

  const setResult = (board: number, result: string, isPlayed: boolean) => {
    if (!currentRound) return;
    onAction(() =>
      tournamentApi.setResult(tournament.id, currentRound.number, board, result, isPlayed)
        .then(r => r)
    );
  };

  const finalizeRound = () => {
    if (!currentRound) return;
    if (!confirm(`Finalize Round ${currentRound.number}?`)) return;
    onAction(() =>
      tournamentApi.finalizeRound(tournament.id, currentRound.number).then(r => r)
    );
  };

  const generateNext = () => {
    onAction(() => tournamentApi.generateNextRound(tournament.id).then(r => r));
  };

  const correctRound = (roundNum: number) => {
    if (!confirm(`Correct Round ${roundNum}? All subsequent rounds will be deleted.`)) return;
    onAction(() => tournamentApi.correctRound(tournament.id, roundNum).then(r => r));
  };

  const allResultsFilled = currentRound?.pairings.every((p: any) => p.result !== null);

  return (
    <section className="card">
      <div className="card-header">
        <Swords className="w-5 h-5 text-amber-400" />
        <h2 className="text-base font-semibold">
          Rounds ({finalizedRounds.length}/{tournament.config.totalRounds})
        </h2>
        {canGenerateNext && (
          <button onClick={generateNext} className="ml-auto btn-sm btn-primary">
            <ChevronRight className="w-4 h-4" />
            Generate Round {finalizedRounds.length + 1}
          </button>
        )}
      </div>

      {/* Past rounds (collapsed) */}
      {finalizedRounds.map((round: any) => (
        <div key={round.number} className="border-b border-slate-700/50">
          <div className="px-4 py-2 flex items-center justify-between bg-slate-800/30">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-sm font-medium text-slate-300">Round {round.number}</span>
              <span className="text-xs text-slate-500">({round.pairings.length} games)</span>
            </div>
            <button
              onClick={() => correctRound(round.number)}
              className="text-xs text-slate-500 hover:text-amber-400 transition-colors"
            >
              Correct
            </button>
          </div>
          <div className="px-4 py-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
            {round.pairings.map((p: any) => {
              const white = getPlayer(p.whiteTpn);
              const black = getPlayer(p.blackTpn);
              return (
                <div key={p.board} className="flex items-center gap-2 text-slate-400">
                  <span className="w-5 text-slate-600">#{p.board}</span>
                  <span className="text-slate-200">{white?.name}</span>
                  <span className="text-slate-500">vs</span>
                  <span className="text-slate-200">{black?.name}</span>
                  <span className={`ml-auto font-mono ${
                    p.result === '1-0' || p.result === '+/-' ? 'text-white' :
                    p.result === '0-1' || p.result === '-/+' ? 'text-slate-400' :
                    'text-slate-500'
                  }`}>
                    {p.result === '1-0' ? '1-0' :
                     p.result === '0-1' ? '0-1' :
                     p.result === '1/2-1/2' ? '=-=' :
                     p.result === '+/-' ? '+/-' :
                     p.result === '-/+' ? '-/+' :
                     p.result === '-/-' ? '-/-' : '?'}
                  </span>
                </div>
              );
            })}
            {round.bye && (
              <div className="flex items-center gap-2 text-slate-400">
                <span className="w-5 text-slate-600">BYE</span>
                <span className="text-amber-300">{getPlayer(round.bye.tpn)?.name}</span>
                <span className="ml-auto text-amber-400">+{round.bye.points}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Current round (active) */}
      {currentRound && (
        <div className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-amber-300">
            Round {currentRound.number} - In Progress
          </h3>

          <div className="space-y-2">
            {currentRound.pairings.map((pairing: any) => {
              const white = getPlayer(pairing.whiteTpn);
              const black = getPlayer(pairing.blackTpn);
              const whitePoints = getPlayerPoints(pairing.whiteTpn);
              const blackPoints = getPlayerPoints(pairing.blackTpn);

              return (
                <div key={pairing.board} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500 font-mono">Board #{pairing.board}</span>
                    {whitePoints !== blackPoints && (
                      <span className="text-xs text-amber-400/70">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        Floater ({Math.abs(whitePoints - blackPoints).toFixed(1)} diff)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* White */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-white border border-slate-400" />
                        <span className="text-sm font-medium text-slate-200">{white?.name}</span>
                        <span className="text-xs text-slate-500">({white?.rating})</span>
                      </div>
                      <span className="text-xs text-slate-500 ml-5">{whitePoints} pts</span>
                    </div>

                    {/* Result selector */}
                    <select
                      value={pairing.result ? `${pairing.result}|${pairing.isPlayed}` : ''}
                      onChange={e => {
                        if (!e.target.value) return;
                        const [result, played] = e.target.value.split('|');
                        setResult(pairing.board, result, played === 'true');
                      }}
                      className="input text-xs py-1 w-44"
                    >
                      <option value="">-- Result --</option>
                      {RESULT_OPTIONS.map(opt => (
                        <option key={`${opt.value}|${opt.isPlayed}`} value={`${opt.value}|${opt.isPlayed}`}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    {/* Black */}
                    <div className="flex-1 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-slate-500">({black?.rating})</span>
                        <span className="text-sm font-medium text-slate-200">{black?.name}</span>
                        <div className="w-3 h-3 rounded-sm bg-slate-900 border border-slate-500" />
                      </div>
                      <span className="text-xs text-slate-500 mr-5">{blackPoints} pts</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Bye */}
            {currentRound.bye && (
              <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-400 font-semibold">BYE</span>
                  <span className="text-sm text-amber-200">{getPlayer(currentRound.bye.tpn)?.name}</span>
                  <span className="text-xs text-amber-400 ml-auto">+{currentRound.bye.points} point</span>
                </div>
              </div>
            )}
          </div>

          {/* Finalize button */}
          <button
            onClick={finalizeRound}
            disabled={!allResultsFilled}
            className={`w-full py-2.5 rounded-lg font-semibold transition-colors ${
              allResultsFilled
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {allResultsFilled ? `Finalize Round ${currentRound.number}` : 'Enter all results to finalize'}
          </button>
        </div>
      )}

      {/* Tournament finished */}
      {tournament.status === 'finished' && (
        <div className="p-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <span className="text-amber-300 font-semibold">Tournament Complete</span>
          </div>
        </div>
      )}
    </section>
  );
}
