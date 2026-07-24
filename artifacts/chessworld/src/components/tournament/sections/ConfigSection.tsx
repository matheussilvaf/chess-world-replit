import { tournamentApi } from '../api';
import { Settings, CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  tournament: any;
  engineStatus: any;
  onAction: (fn: () => Promise<any>) => void;
}

export function ConfigSection({ tournament, engineStatus, onAction }: Props) {
  const isSetup = tournament.status === 'setup';
  const playerCount = tournament.players?.filter((p: any) => p.status === 'active').length || 0;

  const handleRoundMode = (mode: string) => {
    onAction(() => tournamentApi.setRoundMode(tournament.id, mode));
  };

  const handleColor = (color: string) => {
    onAction(() => tournamentApi.setInitialColor(tournament.id, color));
  };

  const handleStart = () => {
    if (!confirm('Start the tournament? Players and settings will be locked.')) return;
    onAction(() => tournamentApi.startTournament(tournament.id));
  };

  const roundModes = [
    { value: 'auto-normal', label: 'Auto Normal' },
    { value: 'auto-fast', label: 'Auto Fast' },
    { value: 'manual', label: 'Manual' },
  ];

  return (
    <section className="card">
      <div className="card-header">
        <Settings className="w-5 h-5 text-blue-400" />
        <h2 className="text-base font-semibold">Configuration</h2>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
          tournament.status === 'setup' ? 'bg-blue-500/20 text-blue-300' :
          tournament.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
          tournament.status === 'finished' ? 'bg-amber-500/20 text-amber-300' :
          'bg-red-500/20 text-red-300'
        }`}>
          {tournament.status}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        {/* Engine Status */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">bbpPairings Engine</label>
          <div className="flex items-center gap-2">
            {engineStatus?.available ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-300">{engineStatus.version}</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-sm text-red-300">{engineStatus?.error || 'Checking...'}</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500">FIDE Dutch System</p>
        </div>

        {/* Round Mode */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Rounds Mode</label>
          <div className="flex gap-1">
            {roundModes.map(m => (
              <button
                key={m.value}
                onClick={() => handleRoundMode(m.value)}
                disabled={!isSetup}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  tournament.config.roundMode === m.value
                    ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
                } ${!isSetup ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {playerCount >= 2 && (
            <p className="text-xs text-slate-500">
              {tournament.config.roundMode === 'auto-normal' && `${calcRounds(playerCount)} rounds (ceil(log2(${playerCount})) + 1)`}
              {tournament.config.roundMode === 'auto-fast' && `${calcRoundsFast(playerCount)} rounds (ceil(log2(${playerCount})))`}
              {tournament.config.roundMode === 'manual' && `${tournament.config.totalRounds || '?'} rounds (manual)`}
              {' | '}Max: {calcMax(playerCount)}
            </p>
          )}
        </div>

        {/* Initial Color */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Initial Color</label>
          <div className="flex gap-1">
            {(['random', 'w', 'b'] as const).map(c => (
              <button
                key={c}
                onClick={() => handleColor(c)}
                disabled={!isSetup}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  (c === 'w' && tournament.config.initialColor === 'w') ||
                  (c === 'b' && tournament.config.initialColor === 'b')
                    ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
                } ${!isSetup ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {c === 'random' ? 'Random' : c === 'w' ? 'White 1st' : 'Black 1st'}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Selected: {tournament.config.initialColor === 'w' ? 'White first' : 'Black first'}
          </p>
        </div>

        {/* Scoring */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Scoring</label>
          <p className="text-sm text-slate-300">Win: 1 | Draw: 0.5 | Loss: 0 | PAB: 1</p>
        </div>

        {/* Tiebreaks */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Tiebreaks</label>
          <p className="text-xs text-slate-400">Buchholz Cut-1, Buchholz, SB, Wins, Progressive, TPN</p>
        </div>

        {/* Total Rounds (after start) */}
        {tournament.status !== 'setup' && (
          <div className="space-y-1">
            <label className="text-xs text-slate-500 uppercase tracking-wide">Rounds</label>
            <p className="text-sm text-slate-300">
              {tournament.rounds.filter((r: any) => r.finalized).length} / {tournament.config.totalRounds} completed
            </p>
          </div>
        )}
      </div>

      {/* Start button */}
      {isSetup && playerCount >= 2 && engineStatus?.available && (
        <div className="px-4 pb-4">
          <button
            onClick={handleStart}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
          >
            Start Tournament ({playerCount} players)
          </button>
        </div>
      )}
    </section>
  );
}

function calcRounds(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return Math.min(Math.ceil(Math.log2(n)) + 1, calcMax(n));
}
function calcRoundsFast(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return Math.min(Math.ceil(Math.log2(n)), calcMax(n));
}
function calcMax(n: number): number {
  return n % 2 === 0 ? n - 1 : n;
}
