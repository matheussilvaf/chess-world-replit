import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { puzzleThemeLabel } from '../../../shared/academy/PuzzleShapes';
import { STATS_BOARDS, STATS_BOARD_INFO, STATS_PERIODS, STATS_PERIOD_INFO, type AcademyPointsResponse } from '../../../shared/academy/StatsShapes';
import { statsClient } from '../../../game/academy/academyStatsClient';
import { pageCount, truncateName, type BoardResponse, type SummaryResponse } from '../../../game/academy/academyStatsLayout';
import { supabase } from '../../../lib/supabase';
import { useAcademyStatsStore } from '../../../stores/academyStatsStore';

export interface StatsModalSource {
  board: typeof statsClient.board;
  summary: typeof statsClient.summary;
  points: () => Promise<AcademyPointsResponse>;
}
const SQL_HINT = 'Estatísticas indisponíveis — rode server/supabase/tactics_academy_stats.sql no Supabase';

export function AcademyStatsModal({ source = statsClient }: { source?: StatsModalSource }) {
  const open = useAcademyStatsStore((s) => s.open);
  return open ? <StatsDialog source={source} /> : null;
}

function StatsDialog({ source }: { source: StatsModalSource }) {
  const { board, period, page, close, setBoard, setPeriod, setPage } = useAcademyStatsStore();
  const [data, setData] = useState<BoardResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [points, setPoints] = useState<AcademyPointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pointsError, setPointsError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pointsRetry, setPointsRetry] = useState(0);
  const [userId, setUserId] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    void supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? ''));
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    setData(null);
    Promise.all([source.board(board, period, page), source.summary()])
      .then(([next, nextSummary]) => {
        if (!active) return;
        setData(next); setSummary(nextSummary); setLoading(false);
        if (!next.schemaMissing && next.page !== page) setPage(next.page);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as estatísticas.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [source, board, period, page, retry, setPage]);
  useEffect(() => {
    if (board !== 'points') return;
    let active = true;
    setPointsError('');
    source.points().then((result) => { if (active) setPoints(result); })
      .catch((cause: unknown) => { if (active) setPointsError(cause instanceof Error ? cause.message : 'Não foi possível carregar os pontos.'); });
    return () => { active = false; };
  }, [source, board, pointsRetry]);
  const pages = pageCount(data?.totalPlayers ?? 0);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const elements = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!elements.length) return;
    if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1].focus(); }
    else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0].focus(); }
  };
  const missing = data?.schemaMissing || summary?.schemaMissing || (board === 'points' && points?.schemaMissing);
  const training = summary?.myTraining;
  const overview = summary?.summary;
  return <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/75 p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="academy-stats-title" onKeyDown={onKeyDown}
      className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-amber-700/50 bg-slate-900 text-slate-100 shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3 sm:px-6">
        <h2 id="academy-stats-title" className="text-lg font-bold text-amber-200">Estatísticas da Academia</h2>
        <button ref={closeRef} type="button" aria-label="Fechar" onClick={close} className="rounded p-2 text-slate-300 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-amber-400"><X size={20} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
        <nav aria-label="Quadros do ranking" className="flex flex-wrap gap-2">
          {STATS_BOARDS.map((id) => <button key={id} type="button" aria-pressed={board === id} onClick={() => setBoard(id)}
            className={`rounded-md px-3 py-2 text-sm font-medium ${board === id ? 'bg-amber-600 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{STATS_BOARD_INFO[id].label}</button>)}
        </nav>
        <nav aria-label="Período" className="flex gap-2">
          {STATS_PERIODS.map((id) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}
            className={`rounded-md px-3 py-1.5 text-sm ${period === id ? 'bg-amber-800 text-amber-100' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{STATS_PERIOD_INFO[id].label}</button>)}
        </nav>
        <p className="text-sm text-slate-300">{STATS_BOARD_INFO[board].description} <span className="text-amber-300">Período: {STATS_PERIOD_INFO[period].description}.</span></p>
        {missing ? <p role="alert" className="rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-amber-200">{SQL_HINT}</p> :
          error ? <div role="alert" className="rounded-lg border border-red-700 p-4 text-red-200">{error} <button type="button" onClick={() => setRetry((n) => n + 1)} className="ml-2 underline">Tentar de novo</button></div> :
          loading ? <div role="status" className="animate-pulse space-y-2" aria-label="Carregando estatísticas">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-9 rounded bg-slate-800" />)}</div> :
          <><div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full min-w-[280px] text-left text-sm">
              <thead className="bg-slate-800 text-xs uppercase text-amber-200"><tr><th className="p-3">#</th><th className="p-3">Jogador</th><th className="p-3 text-right">{STATS_BOARD_INFO[board].unit}</th></tr></thead>
              <tbody>{data?.rows.map((row) => <tr key={`${row.rank}-${row.userId}`} className={`border-t border-slate-800 ${row.userId === userId && userId ? 'bg-amber-800/40 text-amber-100' : ''}`}>
                <td className="p-3">{row.rank}</td><td className="p-3">{truncateName(row.username, 32)}</td><td className="p-3 text-right tabular-nums">{row.value}</td>
              </tr>)}</tbody>
            </table>
            {!data?.rows.length && <p className="p-4 text-sm text-slate-400">Ninguém pontuou neste período.</p>}
          </div>
          <div className="flex items-center justify-center gap-4 text-sm">
            <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded bg-slate-800 px-3 py-1 text-xl disabled:opacity-40">‹</button>
            <span>página {page} de {pages}</span>
            <button type="button" aria-label="Próxima página" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded bg-slate-800 px-3 py-1 text-xl disabled:opacity-40">›</button>
          </div>
          {!data?.rows.some((row) => row.userId === userId && userId) && <p className="text-sm text-amber-200">{data?.me ? `Sua posição: #${data.me.rank} · ${data.me.value} ${STATS_BOARD_INFO[board].unit}` : 'Você ainda não pontuou neste período'}</p>}
          <section className="rounded-lg bg-slate-800 p-4 text-sm"><h3 className="mb-2 font-bold text-amber-200">Resumo da Academia</h3>
            <p>Hoje: {overview?.solvedToday ?? 0} resolvidos · {overview?.activeToday ?? 0} jogadores ativos · {overview?.battlesToday ?? 0} batalhas · {overview?.lessonsToday ?? 0} lições</p>
            <p>Tema da semana: {overview?.topThemeWeek ? puzzleThemeLabel(overview.topThemeWeek) : '—'}</p>
            <p>Totais: {overview?.totalSolved ?? 0} resolvidos · {overview?.totalBattles ?? 0} batalhas</p>
          </section>
          <section className="rounded-lg bg-slate-800 p-4 text-sm"><h3 className="mb-2 font-bold text-amber-200">Meu treino</h3>
            <p>Lições concluídas: {training?.lessonsCompleted ?? 0}/{training?.lessonsTotal ?? 0} · {training?.attempted ? Math.round(training.solvedFirstTry / training.attempted * 100) : 0}% 1ª tentativa</p>
            <p>Pontos fortes: {training?.strongest.map((item) => puzzleThemeLabel(item.theme)).join(', ') || '—'}</p>
          </section></>}
        {board === 'points' && !missing && <section className="rounded-lg border border-amber-800/50 bg-slate-800/70 p-4 text-sm">
          <h3 className="font-bold text-amber-200">Como os pontos são contados</h3>
          <p className="mb-2 text-xs text-slate-400">Valores definidos na administração</p>
          {pointsError ? <p role="alert" className="text-red-300">{pointsError} <button type="button" onClick={() => setPointsRetry((n) => n + 1)} className="underline">Tentar de novo</button></p> :
            !points ? <p className="animate-pulse">Carregando pontos…</p> :
              <ul className="space-y-1">{points.items.map((item) => <li key={item.key} className="flex justify-between gap-4"><span>{item.label}</span><strong className="whitespace-nowrap">{item.points} pts</strong></li>)}</ul>}
        </section>}
      </div>
    </div>
  </div>;
}