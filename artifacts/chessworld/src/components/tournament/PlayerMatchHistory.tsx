import { ArrowLeft, Loader2, RotateCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { TournamentState } from '../../hooks/useTournamentRoom';

// ── Data layer ──────────────────────────────────────────────────────────────

export interface DbPairing {
  round_number: number;
  board_number: number;
  white_player_id: string | null;
  black_player_id: string | null;
  white_username: string | null;
  black_username: string | null;
  result: string | null;
  result_reason: string | null;
  is_bye: boolean;
  bye_player_id: string | null;
}

const PAIRING_COLUMNS =
  'round_number, board_number, white_player_id, black_player_id, white_username, black_username, result, result_reason, is_bye, bye_player_id';

/** Statuses in which `state.tournamentId` refers to the tournament whose standings are displayed. */
const OWN_TOURNAMENT_STATUSES = ['starting', 'round_active', 'between_rounds', 'finalizing', 'completed'];

/**
 * Fetches every pairing of the tournament whose standings are currently
 * displayed. During `registration_open` the panel shows the PREVIOUS
 * tournament (the room already cleared its pairings), so we mirror the
 * server's own resolution: latest completed instance, excluding rows with
 * a null completed_at (manually-completed orphans).
 */
export async function fetchStandingsPairings(status: string, tournamentId: string): Promise<DbPairing[]> {
  let tid: string | null = OWN_TOURNAMENT_STATUSES.includes(status) && tournamentId ? tournamentId : null;

  if (!tid) {
    const { data, error } = await supabase
      .from('tournament_instances')
      .select('id')
      .eq('status', 'completed')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    tid = data?.[0]?.id ?? null;
  }

  if (!tid) return [];

  const { data, error } = await supabase
    .from('tournament_pairings')
    .select(PAIRING_COLUMNS)
    .eq('tournament_id', tid)
    .order('round_number', { ascending: true })
    .order('board_number', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DbPairing[];
}

// ── Result interpretation (from the selected player's perspective) ─────────

type OutcomeKind = 'win' | 'draw' | 'loss' | 'pending';

interface Outcome {
  kind: OutcomeKind;
  /** Chess-notation score as stored (prettified), e.g. "1-0", "½-½", "W.O." */
  score: string;
  forfeit: boolean;
}

function outcomeFor(p: DbPairing, playerId: string): Outcome {
  if (p.is_bye) return { kind: 'win', score: '+1', forfeit: false };
  const r = p.result;
  if (!r) return { kind: 'pending', score: '', forfeit: false };
  const isWhite = p.white_player_id === playerId;
  switch (r) {
    case '1-0':
      return { kind: isWhite ? 'win' : 'loss', score: '1-0', forfeit: false };
    case '0-1':
      return { kind: isWhite ? 'loss' : 'win', score: '0-1', forfeit: false };
    case '1/2-1/2':
      return { kind: 'draw', score: '\u00BD-\u00BD', forfeit: false };
    case '+/-':
      return { kind: isWhite ? 'win' : 'loss', score: '+/-', forfeit: true };
    case '-/+':
      return { kind: isWhite ? 'loss' : 'win', score: '-/+', forfeit: true };
    case '-/-':
      return { kind: 'loss', score: '-/-', forfeit: true };
    default:
      return { kind: 'pending', score: r, forfeit: false };
  }
}

const OUTCOME_CHIP: Record<OutcomeKind, { label: string; cls: string }> = {
  win: { label: 'V', cls: 'bg-emerald-500/15 text-emerald-400' },
  draw: { label: 'E', cls: 'bg-slate-500/20 text-slate-300' },
  loss: { label: 'D', cls: 'bg-rose-500/15 text-rose-400' },
  pending: { label: '\u2022', cls: 'bg-slate-700/40 text-slate-500' },
};

function formatPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ── View ────────────────────────────────────────────────────────────────────

interface PlayerMatchHistoryProps {
  standing: TournamentState['standings'][0];
  pairings: DbPairing[] | null;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}

export function PlayerMatchHistory({ standing, pairings, error, onRetry, onBack }: PlayerMatchHistoryProps) {
  const playerId = standing.playerId;
  const rows = (pairings ?? []).filter(
    (p) => p.white_player_id === playerId || p.black_player_id === playerId || p.bye_player_id === playerId,
  );

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar
        </button>
        <div className="flex-1 min-w-0 text-right">
          <p className="text-sm font-medium text-slate-100 truncate">{standing.username}</p>
          <p className="text-[10px] text-slate-500 font-mono">
            #{standing.position} &middot; {formatPts(standing.points)} pts &middot;{' '}
            <span className="text-emerald-400">{standing.wins}V</span>{' '}
            <span className="text-slate-400">{standing.draws}E</span>{' '}
            <span className="text-rose-400">{standing.losses}D</span>
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <p className="text-xs text-rose-400">Erro ao carregar historico</p>
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/60 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            Tentar novamente
          </button>
        </div>
      ) : pairings === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Carregando historico...</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-8">Nenhuma partida encontrada</p>
      ) : (
        <div className="divide-y divide-slate-800/50">
          <div className="grid grid-cols-[44px_76px_minmax(0,1fr)_72px] items-center gap-1 px-3 py-1.5 border-b border-slate-800 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Rod.</span>
            <span>Cor</span>
            <span>Adversario</span>
            <span className="text-right">Resultado</span>
          </div>
          {rows.map((p) => (
            <HistoryRow key={`${p.round_number}-${p.board_number}`} pairing={p} playerId={playerId} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ pairing: p, playerId }: { pairing: DbPairing; playerId: string }) {
  const outcome = outcomeFor(p, playerId);
  const chip = OUTCOME_CHIP[outcome.kind];
  const isWhite = !p.is_bye && p.white_player_id === playerId;
  const opponent = p.is_bye ? null : isWhite ? p.black_username : p.white_username;

  return (
    <div
      className="grid grid-cols-[44px_76px_minmax(0,1fr)_72px] items-center gap-1 px-3 py-2"
      title={p.result_reason || undefined}
    >
      <span className="text-[10px] text-slate-500 font-mono">R{p.round_number}</span>

      {p.is_bye ? (
        <span className="text-[10px] text-slate-500 italic">Bye</span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2.5 h-2.5 rounded-full border shrink-0 ${
              isWhite ? 'bg-slate-100 border-slate-300' : 'bg-slate-950 border-slate-500'
            }`}
          />
          <span className="text-[10px] text-slate-300">{isWhite ? 'Brancas' : 'Pretas'}</span>
        </span>
      )}

      <span className="text-xs text-slate-200 truncate">
        {p.is_bye ? <span className="text-slate-500">&mdash;</span> : opponent || '?'}
      </span>

      <span className="flex items-center justify-end gap-1.5">
        {outcome.kind === 'pending' && !outcome.score ? (
          <span className="text-[10px] text-slate-500 italic">Em aberto</span>
        ) : (
          <>
            <span className="text-[10px] text-slate-400 font-mono">
              {outcome.score}
              {outcome.forfeit && <span className="text-slate-600"> W.O.</span>}
            </span>
            <span
              className={`w-[18px] h-[18px] rounded flex items-center justify-center text-[10px] font-bold ${chip.cls}`}
            >
              {chip.label}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
