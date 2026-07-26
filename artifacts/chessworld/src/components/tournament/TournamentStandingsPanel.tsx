import { useState, useEffect, useMemo } from 'react';
import { Trophy, Swords, Clock, Check, X, ChevronRight } from 'lucide-react';
import type { TournamentState } from '../../hooks/useTournamentRoom';
import { PlayerMatchHistory, fetchStandingsPairings, type DbPairing } from './PlayerMatchHistory';

interface TournamentStandingsPanelProps {
  state: TournamentState;
  onExpandStandings?: () => void;
}

export function TournamentStandingsPanel({ state, onExpandStandings }: TournamentStandingsPanelProps) {
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

  const showRegistrations = isRegistrationOpen && secondsLeft !== null && secondsLeft <= 10;
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
        <div
          className={`p-4 border-b border-slate-700/50 flex items-center gap-2 ${onExpandStandings ? 'cursor-pointer hover:bg-slate-800/40' : ''}`}
          onClick={onExpandStandings}
        >
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            Ultimo Torneio
          </h3>
          {onExpandStandings && <ChevronRight className="w-3.5 h-3.5 text-slate-500 ml-auto" />}
        </div>
        <div
          className={`flex-1 overflow-y-auto ${onExpandStandings ? 'cursor-pointer' : ''}`}
          onClick={onExpandStandings}
        >
          <StandingsTable standings={state.standings} limit={4} onExpand={onExpandStandings} />
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
    return <ActiveTournamentView state={state} isCompleted={isCompleted} isActive={isActive} onExpandStandings={onExpandStandings} />;
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <p className="text-xs text-slate-500">Aguardando torneio</p>
    </div>
  );
}

function ActiveTournamentView({ state, isCompleted, isActive, onExpandStandings }: { state: TournamentState; isCompleted: boolean; isActive: boolean; onExpandStandings?: () => void }) {
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
            <div
              className={onExpandStandings ? 'cursor-pointer' : ''}
              onClick={onExpandStandings}
            >
              <StandingsTable standings={state.standings} limit={4} onExpand={onExpandStandings} />
            </div>
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

function formatPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const STANDINGS_GRID = 'grid grid-cols-[24px_minmax(0,1fr)_38px_52px_30px] items-center gap-1';

function RankBadge({ position }: { position: number }) {
  if (position === 1) return <span className="text-[11px] font-mono font-bold text-amber-400">1</span>;
  if (position === 2) return <span className="text-[11px] font-mono font-bold text-slate-300">2</span>;
  if (position === 3) return <span className="text-[11px] font-mono font-bold text-amber-700">3</span>;
  return <span className="text-[10px] text-slate-500 font-mono">{position}</span>;
}

export function StandingsTable({
  standings,
  limit,
  onExpand,
  onSelectPlayer,
}: {
  standings: TournamentState['standings'];
  limit?: number;
  onExpand?: () => void;
  onSelectPlayer?: (standing: TournamentState['standings'][0]) => void;
}) {
  const visible = limit ? standings.slice(0, limit) : standings;
  const hiddenCount = standings.length - visible.length;

  return (
    <div className="flex flex-col">
      <div className={`${STANDINGS_GRID} px-3 py-1.5 border-b border-slate-800 text-[9px] font-semibold uppercase tracking-wider text-slate-500`}>
        <span className="text-center">#</span>
        <span>Player</span>
        <span className="text-right">Elo</span>
        <span className="text-center">W-D-L</span>
        <span className="text-right">Pts</span>
      </div>
      <div className="divide-y divide-slate-800/50">
        {visible.map((s) => (
          <div
            key={s.playerId}
            onClick={onSelectPlayer ? (e) => { e.stopPropagation(); onSelectPlayer(s); } : undefined}
            className={`${STANDINGS_GRID} px-3 py-1.5 ${s.isChampion ? 'bg-amber-500/5' : ''} ${
              onSelectPlayer ? 'cursor-pointer hover:bg-slate-800/50' : s.isChampion ? '' : 'hover:bg-slate-800/30'
            }`}
          >
            <div className="flex items-center justify-center">
              <RankBadge position={s.position} />
            </div>
            <span className={`text-xs truncate ${s.isChampion ? 'text-amber-200 font-medium' : 'text-slate-200'}`}>
              {s.username}
            </span>
            <span className="text-[10px] text-slate-400 font-mono text-right">{s.rating}</span>
            <span className="text-[10px] font-mono text-center whitespace-nowrap">
              <span className="text-emerald-400">{s.wins}</span>
              <span className="text-slate-600">-</span>
              <span className="text-slate-400">{s.draws}</span>
              <span className="text-slate-600">-</span>
              <span className="text-rose-400">{s.losses}</span>
            </span>
            <span className="text-xs font-semibold text-white font-mono text-right">{formatPts(s.points)}</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && onExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          className="mx-3 my-2 py-1.5 rounded-md border border-slate-700 bg-slate-800/60 text-[10px] text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors"
        >
          Ver todos ({standings.length})
        </button>
      )}
    </div>
  );
}

export function TournamentStandingsModal({
  title,
  state,
  onClose,
}: {
  title: string;
  state: TournamentState;
  onClose: () => void;
}) {
  const standings = state.standings;
  const [selected, setSelected] = useState<TournamentState['standings'][0] | null>(null);
  const [pairings, setPairings] = useState<DbPairing[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Frozen at mount: the standings shown belong to the tournament resolved at
  // open time, even if the room transitions to a new cycle while open.
  const [resolution] = useState(() => ({ status: state.status, tournamentId: state.tournamentId }));

  useEffect(() => {
    let alive = true;
    setHistoryError(null);
    setPairings(null);
    fetchStandingsPairings(resolution.status, resolution.tournamentId)
      .then((rows) => { if (alive) setPairings(rows); })
      .catch((err: unknown) => {
        console.error('[TournamentStandingsModal] pairings fetch failed:', err);
        if (alive) setHistoryError(err instanceof Error ? err.message : 'fetch failed');
      });
    return () => { alive = false; };
  }, [resolution, retryKey]);

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md max-h-[80vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-4 border-b border-slate-700/70">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide flex-1 truncate">{title}</h3>
          <span className="text-xs text-slate-500 shrink-0">{standings.length} jogadores</span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {selected ? (
            <PlayerMatchHistory
              standing={selected}
              pairings={pairings}
              error={historyError}
              onRetry={() => setRetryKey((k) => k + 1)}
              onBack={() => setSelected(null)}
            />
          ) : (
            <>
              <StandingsTable standings={standings} onSelectPlayer={setSelected} />
              <p className="px-4 py-2.5 text-[10px] text-slate-500 text-center border-t border-slate-800">
                Clique em um jogador para ver as partidas dele neste torneio
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
