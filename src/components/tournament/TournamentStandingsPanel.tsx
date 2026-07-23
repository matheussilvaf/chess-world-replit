import { useState, useEffect, useMemo } from 'react';
import { Trophy, Crown, Medal, Award, Swords, Clock, Check } from 'lucide-react';
import type { TournamentState } from '../../hooks/useTournamentRoom';

interface TournamentStandingsPanelProps {
  state: TournamentState;
}

export function TournamentStandingsPanel({ state }: TournamentStandingsPanelProps) {
  const isRegistrationOpen = state.status === 'registration_open';
  const isActive = ['starting', 'round_active', 'between_rounds', 'finalizing'].includes(state.status);
  const isCompleted = state.status === 'completed' || state.lastStatus === 'completed';
  const isCancelled = state.status === 'cancelled_insufficient_players' || state.lastStatus === 'cancelled_insufficient_players';

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isRegistrationOpen || !state.startsAt || !state.serverNow) {
      setSecondsLeft(null);
      return;
    }
    const serverOffset = Date.now() - new Date(state.serverNow).getTime();
    const update = () => {
      const now = Date.now() - serverOffset;
      const diff = Math.max(0, Math.ceil((new Date(state.startsAt).getTime() - now) / 1000));
      setSecondsLeft(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isRegistrationOpen, state.startsAt, state.serverNow]);

  const showRegistrations = isRegistrationOpen && secondsLeft !== null && secondsLeft <= 30;
  const showPreviousStandings = isRegistrationOpen && !showRegistrations && state.standings.length > 0;

  if (isCancelled && !isActive && !isRegistrationOpen) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-400 tracking-wide uppercase">
            Resultado
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-slate-500 text-center">
            Nao houve participantes suficientes
          </p>
        </div>
      </div>
    );
  }

  if (showRegistrations) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            Inscritos ({state.registrations.length})
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {state.registrations.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">Nenhum inscrito ainda</p>
          ) : (
            <div className="space-y-0.5">
              {state.registrations.map((reg, i) => (
                <div key={reg.playerId} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-800/50">
                  <span className="text-xs text-slate-500 w-5 text-right">{i + 1}</span>
                  <span className="text-sm text-slate-200 flex-1 truncate">{reg.username}</span>
                  <span className="text-xs text-slate-500 font-mono">{reg.rating}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showPreviousStandings) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            Ultimo Torneio
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          <CompactStandingsList standings={state.standings} />
        </div>
      </div>
    );
  }

  if (isRegistrationOpen) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-xs text-slate-500">Aguardando torneio</p>
      </div>
    );
  }

  if (isActive || isCompleted) {
    return <ActiveTournamentView state={state} isCompleted={isCompleted} isActive={isActive} />;
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <p className="text-xs text-slate-500">Aguardando torneio</p>
    </div>
  );
}

function ActiveTournamentView({ state, isCompleted, isActive }: { state: TournamentState; isCompleted: boolean; isActive: boolean }) {
  const title = isCompleted ? 'Classificacao Final' : 'Standings';

  const roundsGrouped = useMemo(() => {
    const map = new Map<number, typeof state.pairings>();
    for (const p of state.pairings) {
      const arr = map.get(p.roundNumber);
      if (arr) arr.push(p);
      else map.set(p.roundNumber, [p]);
    }
    const sorted = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    return sorted.map(([roundNum, pairings]) => ({
      roundNumber: roundNum,
      pairings: pairings.sort((a, b) => a.boardNumber - b.boardNumber),
    }));
  }, [state.pairings]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="p-3 border-b border-slate-700/50 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
          {title}
        </h3>
        {isActive && (
          <span className="ml-auto text-xs text-slate-500">R{state.currentRound}/{state.totalRounds}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {roundsGrouped.length > 0 && (
          <div className="border-b border-slate-700/50">
            {roundsGrouped.map(({ roundNumber, pairings }) => (
              <RoundBlock
                key={roundNumber}
                roundNumber={roundNumber}
                currentRound={state.currentRound}
                pairings={pairings}
              />
            ))}
          </div>
        )}

        <div>
          {state.standings.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              {state.status === 'starting' ? 'Calculando pareamentos...' : 'Aguardando resultados'}
            </p>
          ) : (
            <CompactStandingsList standings={state.standings} />
          )}
        </div>
      </div>
    </div>
  );
}

function RoundBlock({
  roundNumber,
  currentRound,
  pairings,
}: {
  roundNumber: number;
  currentRound: number;
  pairings: TournamentState['pairings'];
}) {
  const isCurrent = roundNumber === currentRound;

  return (
    <div className={`${isCurrent ? 'bg-sky-950/20' : ''}`}>
      <div className="px-3 py-1.5 flex items-center gap-1.5">
        <Swords className={`w-3 h-3 ${isCurrent ? 'text-sky-400' : 'text-slate-600'}`} />
        <span className={`text-[11px] font-medium uppercase tracking-wide ${isCurrent ? 'text-sky-300' : 'text-slate-500'}`}>
          Rodada {roundNumber}
        </span>
      </div>
      <div className="px-2 pb-1.5 space-y-0.5">
        {pairings.map((p) => (
          <PairingRow key={`${p.roundNumber}-${p.boardNumber}`} pairing={p} />
        ))}
      </div>
    </div>
  );
}

function PairingRow({ pairing: p }: { pairing: TournamentState['pairings'][0] }) {
  if (p.isBye) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/30">
        <span className="text-[10px] text-slate-600 w-4 text-center font-mono">{p.boardNumber}</span>
        <span className="text-xs text-slate-400 flex-1 text-center italic">
          {p.whiteUsername || p.blackUsername} (bye)
        </span>
        <StatusBadge result={p.result} startedAt={p.startedAt} isBye />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/30">
      <span className="text-[10px] text-slate-600 w-4 text-center font-mono">{p.boardNumber}</span>
      <span className="text-xs text-slate-200 flex-1 text-right truncate">{p.whiteUsername}</span>
      <span className="text-[10px] text-slate-600 px-0.5">vs</span>
      <span className="text-xs text-slate-200 flex-1 text-left truncate">{p.blackUsername}</span>
      <StatusBadge result={p.result} startedAt={p.startedAt} />
    </div>
  );
}

function StatusBadge({ result, startedAt, isBye }: { result: string; startedAt: string; isBye?: boolean }) {
  if (result) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-amber-400 font-mono ml-1 shrink-0">
        <Check className="w-2.5 h-2.5" />
        {isBye ? '1-0' : result}
      </span>
    );
  }
  if (startedAt) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 ml-1 shrink-0">
        <Clock className="w-2.5 h-2.5 animate-pulse" />
        <span>Em andamento</span>
      </span>
    );
  }
  return (
    <span className="text-[10px] text-slate-500 ml-1 shrink-0">Aguardando</span>
  );
}

function CompactStandingsList({ standings }: { standings: TournamentState['standings'] }) {
  return (
    <div className="divide-y divide-slate-800/50">
      {standings.map((s) => (
        <div
          key={s.playerId}
          className={`flex items-center gap-2 px-3 py-1.5 min-w-0 ${
            s.isChampion ? 'bg-amber-500/5' : 'hover:bg-slate-800/30'
          }`}
        >
          <div className="w-5 flex items-center justify-center shrink-0">
            {s.position === 1 ? (
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            ) : s.position === 2 ? (
              <Medal className="w-3 h-3 text-slate-300" />
            ) : s.position === 3 ? (
              <Award className="w-3 h-3 text-amber-700" />
            ) : (
              <span className="text-[10px] text-slate-500">{s.position}</span>
            )}
          </div>
          <span className={`text-xs flex-1 truncate ${s.isChampion ? 'text-amber-200 font-medium' : 'text-slate-200'}`}>
            {s.username}
          </span>
          <span className="text-xs font-medium text-white font-mono w-6 text-right shrink-0">
            {s.points}
          </span>
          <span className="text-[10px] text-slate-500 font-mono w-14 text-right shrink-0">
            {s.wins}W {s.draws}D {s.losses}L
          </span>
        </div>
      ))}
    </div>
  );
}
