/**
 * /admin/chess-matches — "Chess Matches Database".
 *
 * Lista paginada (20 por página) de TODAS as partidas gravadas pelo servidor
 * (praça e torneio), com filtros por jogador (nome parcial ou id), resultado,
 * tipo, status e intervalo de datas. Mostra rating antes/depois de cada lado
 * quando o histórico Glicko-2 existe. "Ver Partida" é decorativo por enquanto.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Database, Eye, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useDocumentScrollUnlock } from '../../../hooks/useDocumentScrollUnlock';
import { RigApiError } from '../rig-editor/rigApi';
import { SqlBanner, buttonClass, inputClass } from '../shared/AdminFields';
import { matchesApi, type MatchListEntry, type MatchListQuery, type MatchListResult } from './matchesApi';

const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos os resultados' },
  { value: 'checkmate', label: 'Xeque-mate' },
  { value: 'resign', label: 'Desistência' },
  { value: 'timeout', label: 'Tempo esgotado' },
  { value: 'draw', label: 'Empate (acordo)' },
  { value: 'stalemate', label: 'Afogamento' },
  { value: 'repetition', label: 'Repetição' },
  { value: 'insufficient', label: 'Material insuficiente' },
  { value: 'abandon', label: 'Abandono' },
];

const RESULT_LABEL: Record<string, string> = Object.fromEntries(RESULT_OPTIONS.map((o) => [o.value, o.label]));

const EMPTY_QUERY: MatchListQuery = { page: 1, player: '', result: 'all', kind: 'all', status: 'all', from: '', to: '' };

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const durationLabel = (m: MatchListEntry): string => {
  if (!m.createdAt || !m.finishedAt) return '—';
  const ms = new Date(m.finishedAt).getTime() - new Date(m.createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

/** Placar no formato clássico (1-0 / 0-1 / ½-½) a partir do vencedor. */
const scoreLabel = (m: MatchListEntry): string => {
  if (m.status !== 'finished') return '…';
  if (m.result === 'abandon' && !m.winnerUserId) return 'abortada';
  if (!m.winnerUserId) return '½-½';
  if (m.white.id && m.winnerUserId === m.white.id) return '1-0';
  if (m.black.id && m.winnerUserId === m.black.id) return '0-1';
  return '?';
};

export function ChessMatchesPage() {
  useDocumentScrollUnlock();
  const [form, setForm] = useState<MatchListQuery>(EMPTY_QUERY);
  const [applied, setApplied] = useState<MatchListQuery>(EMPTY_QUERY);
  const [data, setData] = useState<MatchListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableSql, setTableSql] = useState<string | null>(null);

  const load = useCallback(async (query: MatchListQuery) => {
    setBusy(true);
    setError(null);
    try {
      const res = await matchesApi.list(query);
      setData(res);
      if (res.error) setError(res.error);
    } catch (cause) {
      if (cause instanceof RigApiError) {
        setError(cause.message);
        if (cause.tableSql) setTableSql(cause.tableSql);
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  const apply = (patch: Partial<MatchListQuery> = {}) => {
    const next = { ...form, ...patch, page: patch.page ?? 1 };
    setForm(next);
    setApplied(next);
  };

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1), [data]);
  const hasFilters = applied.player || applied.result !== 'all' || applied.kind !== 'all' || applied.status !== 'all' || applied.from || applied.to;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 [background-image:radial-gradient(circle_at_20%_0%,rgba(56,189,248,0.06),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(251,191,36,0.06),transparent_45%)]">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2">
            <Database className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-sky-300 via-cyan-300 to-amber-300 bg-clip-text text-xl font-semibold text-transparent">
              Chess Matches Database
            </h1>
            <p className="font-mono text-[11px] text-slate-500">
              todas as partidas (praça e torneio) · 20 por página{data ? ` · ${data.total} no total` : ''}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load(applied)}
              disabled={busy}
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recarregar
            </button>
            <Link to="/admin" className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}>
              <ArrowLeft className="h-3.5 w-3.5" /> Administração
            </Link>
          </div>
        </header>

        {data?.tableMissing && (
          <SqlBanner text="Tabela matches ausente no Supabase — nada é gravado até ela existir." sql={tableSql} />
        )}
        {data?.ratingHistoryMissing && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            Histórico de rating (chess_rating_history) ainda não existe — as colunas de rating antes/depois ficam vazias até rodar a migração em{' '}
            <Link to="/admin/rating-gambits" className="underline">Rating &amp; Gambits</Link>.
          </div>
        )}
        {error && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}
        {data?.warning && !error && <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">{data.warning}</div>}

        <form
          className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 md:grid-cols-4 xl:grid-cols-8"
          onSubmit={(e) => { e.preventDefault(); apply(); }}
        >
          <label className="col-span-2 flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Jogador
            <input
              value={form.player}
              onChange={(e) => setForm({ ...form, player: e.target.value })}
              placeholder="nome (parcial) ou id"
              className={`${inputClass} w-full normal-case tracking-normal`}
              data-testid="filter-player"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Resultado
            <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className={`${inputClass} w-full normal-case tracking-normal`}>
              {RESULT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Tipo
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MatchListQuery['kind'] })} className={`${inputClass} w-full normal-case tracking-normal`}>
              <option value="all">Praça + torneio</option>
              <option value="plaza">Praça</option>
              <option value="tournament">Torneio</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MatchListQuery['status'] })} className={`${inputClass} w-full normal-case tracking-normal`}>
              <option value="all">Todos</option>
              <option value="playing">Em andamento</option>
              <option value="finished">Finalizadas</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            De
            <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={`${inputClass} w-full`} />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Até
            <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={`${inputClass} w-full`} />
          </label>
          <div className="flex items-end gap-1.5">
            <button type="submit" disabled={busy} className={`${buttonClass} flex-1 justify-center bg-sky-500 text-slate-950 hover:bg-sky-400`} data-testid="apply-filters">
              <Search className="h-3.5 w-3.5" /> Filtrar
            </button>
            {hasFilters && (
              <button type="button" onClick={() => { setForm(EMPTY_QUERY); setApplied(EMPTY_QUERY); }} className={`${buttonClass} border border-slate-700/60 bg-slate-800/80`} title="Limpar filtros">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-900/70">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-slate-950/60 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Brancas</th>
                <th className="px-3 py-2">Pretas</th>
                <th className="px-3 py-2 text-center">Placar</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2 text-right">Lances</th>
                <th className="px-3 py-2 text-right">Duração</th>
                <th className="px-3 py-2">Relógio</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {!data && busy && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
              )}
              {data && data.matches.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">Nenhuma partida{hasFilters ? ' com esses filtros' : ' gravada ainda'}.</td></tr>
              )}
              {data?.matches.map((m) => (
                <tr key={m.id} className="border-t border-slate-800/60 hover:bg-slate-800/30" data-testid={`match-row-${m.id}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-300">{fmtDate(m.createdAt)}</td>
                  <td className="px-3 py-2">
                    {m.kind === 'tournament' ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] text-amber-300" title={m.tournamentId ?? ''}>
                        torneio{m.tournamentRound !== null ? ` R${m.tournamentRound}` : ''}{m.tournamentBoardNumber !== null ? ` M${m.tournamentBoardNumber}` : ''}
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] text-sky-300" title={m.boardId ?? ''}>praça</span>
                    )}
                  </td>
                  <PlayerCell player={m.white} winner={!!m.white.id && m.winnerUserId === m.white.id} />
                  <PlayerCell player={m.black} winner={!!m.black.id && m.winnerUserId === m.black.id} />
                  <td className="px-3 py-2 text-center font-mono text-slate-100">{scoreLabel(m)}</td>
                  <td className="px-3 py-2 text-slate-300">{m.status === 'finished' ? (RESULT_LABEL[m.result ?? ''] ?? (m.result || '—')) : <span className="text-emerald-300">em andamento</span>}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{m.plies}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{durationLabel(m)}</td>
                  <td className="px-3 py-2 font-mono text-slate-400">{m.timeMinutes !== null ? `${m.timeMinutes}+${m.incrementSeconds ?? 0}` : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled
                      title="Em breve: replay da partida"
                      className={`${buttonClass} border border-slate-700/60 bg-slate-800/60 text-slate-400`}
                      data-testid={`view-match-${m.id}`}
                    >
                      <Eye className="h-3.5 w-3.5" /> Ver Partida
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>
            Página {applied.page} de {totalPages}
            {data ? ` · ${data.matches.length} nesta página` : ''}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => apply({ page: applied.page - 1 })}
              disabled={busy || applied.page <= 1}
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
              data-testid="page-prev"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <button
              type="button"
              onClick={() => apply({ page: applied.page + 1 })}
              disabled={busy || applied.page >= totalPages}
              className={`${buttonClass} border border-slate-700/60 bg-slate-800/80 hover:bg-slate-700/80`}
              data-testid="page-next"
            >
              Próxima <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerCell({ player, winner }: { player: MatchListEntry['white']; winner: boolean }) {
  const delta = player.ratingDelta;
  return (
    <td className="px-3 py-2">
      <div className={`truncate ${winner ? 'font-semibold text-slate-100' : 'text-slate-300'}`} title={player.id ?? ''}>
        {player.username || player.id?.slice(0, 8) || '—'}
      </div>
      {player.ratingBefore !== null && player.ratingAfter !== null && (
        <div className="font-mono text-[10px] text-slate-500">
          {Math.round(player.ratingBefore)} → {Math.round(player.ratingAfter)}{' '}
          {delta !== null && (
            <span className={delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-500'}>
              ({delta > 0 ? '+' : ''}{Math.round(delta)})
            </span>
          )}
        </div>
      )}
    </td>
  );
}
