import { useEffect, useState, useCallback } from 'react';
import { Users, Clock, Swords, Timer, CheckCircle, X, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { TournamentState } from '../../hooks/useTournamentRoom';

interface TournamentRegistryPanelProps {
  state: TournamentState;
  userId: string | null;
  onRegister: (username: string, rating: number) => void;
  onUnregister: () => void;
}

function useCountdown(startsAt: string, serverNow: string) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!startsAt || !serverNow) { setRemaining(0); return; }

    const serverTime = new Date(serverNow).getTime();
    const localTime = Date.now();
    const clockOffset = serverTime - localTime;

    const target = new Date(startsAt).getTime();

    const update = () => {
      const correctedNow = Date.now() + clockOffset;
      const diff = Math.max(0, target - correctedNow);
      setRemaining(diff);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startsAt, serverNow]);

  return remaining;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function TournamentRegistryPanel({ state, userId, onRegister, onUnregister }: TournamentRegistryPanelProps) {
  const [registering, setRegistering] = useState(false);
  const remaining = useCountdown(state.startsAt, state.serverNow);

  const isRegistered = userId ? state.registrations.some(r => r.playerId === userId) : false;
  const isRegistrationOpen = state.status === 'registration_open';
  const isActive = ['starting', 'round_active', 'between_rounds', 'finalizing'].includes(state.status);

  const handleRegister = useCallback(async () => {
    setRegistering(true);
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) { setRegistering(false); return; }
    const username = user.user_metadata?.username || user.email?.split('@')[0] || 'Player';
    onRegister(username, 1200);
    setRegistering(false);
  }, [onRegister]);

  if (isActive) {
    const completedGames = state.pairings.filter(p => p.result !== '').length;
    const totalGames = state.pairings.filter(p => !p.isBye).length;

    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-amber-300 tracking-wide uppercase">
            Tournament in Progress
          </h3>
        </div>
        <div className="flex-1 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Rodada</span>
            <span className="text-sm font-medium text-white">{state.currentRound} / {state.totalRounds}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Controle</span>
            <span className="text-sm text-slate-200">{state.timeControlLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Partidas</span>
            <span className="text-sm text-slate-200">
              {completedGames}/{totalGames} concluídas
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2">
            <div
              className="bg-amber-400 h-1.5 rounded-full transition-all"
              style={{ width: `${totalGames > 0 ? (completedGames / totalGames) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <h3 className="text-sm font-semibold text-emerald-300 tracking-wide uppercase">
          Próximo Torneio
        </h3>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-3 overflow-y-auto">
        {/* Countdown */}
        <div className="text-center py-2">
          <div className="text-2xl font-mono font-bold text-white tracking-wider">
            {formatCountdown(remaining)}
          </div>
          <p className="text-xs text-slate-500 mt-1">até o início</p>
        </div>

        {/* Info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Clock className="w-3 h-3" />
            <span className="text-slate-300">{state.timeControlLabel}</span>
            <span className="ml-auto px-1.5 py-0.5 bg-slate-800 rounded text-[10px] uppercase tracking-wider">
              {state.timeControlCategory}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Swords className="w-3 h-3" />
            <span className="text-slate-300">Swiss {state.roundMode.replace('-', ' ')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Users className="w-3 h-3" />
            <span className="text-slate-300">{state.registrations.length} inscritos</span>
          </div>
        </div>

        {/* Registration button */}
        {isRegistrationOpen && (
          <div className="pt-2">
            {isRegistered ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-300">Inscrito</span>
                </div>
                <button
                  onClick={onUnregister}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-red-300 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 transition-colors"
                >
                  <X className="w-3 h-3" /> Cancelar inscrição
                </button>
              </div>
            ) : (
              <button
                onClick={handleRegister}
                disabled={registering}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
                Inscrever-se
              </button>
            )}
          </div>
        )}
        {!isRegistrationOpen && !isActive && (
          <div className="px-3 py-2 rounded-lg bg-slate-800/50 text-center">
            <span className="text-xs text-slate-500">Inscrições encerradas</span>
          </div>
        )}
      </div>
    </div>
  );
}
