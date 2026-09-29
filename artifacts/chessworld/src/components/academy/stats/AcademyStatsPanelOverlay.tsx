import { useEffect, useRef, useState } from 'react';
import { puzzleThemeLabel } from '../../../shared/academy/PuzzleShapes';
import { STATS_BOARDS, STATS_BOARD_INFO, STATS_PERIODS, STATS_PERIOD_INFO, type StatsBoard, type StatsPeriod } from '../../../shared/academy/StatsShapes';
import { statsClient } from '../../../game/academy/academyStatsClient';
import { pageCount, truncateName, type BoardResponse, type SummaryResponse } from '../../../game/academy/academyStatsLayout';
import { supabase } from '../../../lib/supabase';
import { useAcademyStatsStore } from '../../../stores/academyStatsStore';
import type { StatsModalSource } from './AcademyStatsModal';

const DESIGN_WIDTH = 560;
type ScreenRect = { x: number; y: number; width: number; height: number };
type Status = 'loading' | 'ready' | 'missing' | 'error';

/** DOM panel above the world canvas, following the academy's Tiled ui_anchors rect. */
export function AcademyStatsPanelOverlay({ source = statsClient, mockUserId }: {
  source?: StatsModalSource;
  mockUserId?: string;
}) {
  const [rect, setRect] = useState<ScreenRect | null>(null);
  const [board, setBoard] = useState<StatsBoard>('points');
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [page, setPage] = useState(1);
  const [boardData, setBoardData] = useState<BoardResponse | null>(null);
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [userId, setUserId] = useState(mockUserId ?? '');
  const [refresh, setRefresh] = useState(0);
  const revision = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinchActive = useRef(false);
  const openModal = useAcademyStatsStore((s) => s.openModal);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const next = window.__uiAnchorScreenRects?.tactics_academy_stats;
      setRect((previous) => {
        if (!next) return previous === null ? previous : null;
        if (previous && previous.x === next.x && previous.y === next.y &&
          previous.width === next.width && previous.height === next.height) return previous;
        return { x: next.x, y: next.y, width: next.width, height: next.height };
      });
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (mockUserId !== undefined) { setUserId(mockUserId); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user.id ?? '');
    });
    return () => { active = false; };
  }, [mockUserId]);

  // One request sequence per selection/refresh; stale replies cannot overwrite newer tabs.
  useEffect(() => {
    const currentRevision = ++revision.current;
    setStatus('loading');
    setError('');
    setBoardData(null);
    void Promise.all([source.board(board, period, page), source.summary()])
      .then(([nextBoard, nextSummary]) => {
        if (revision.current !== currentRevision) return;
        setBoardData(nextBoard);
        setSummaryData(nextSummary);
        setStatus(nextBoard.schemaMissing || nextSummary.schemaMissing ? 'missing' : 'ready');
        if (!nextBoard.schemaMissing && nextBoard.page !== page) setPage(nextBoard.page);
      })
      .catch((cause: unknown) => {
        if (revision.current !== currentRevision) return;
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as estatísticas.');
      });
    return () => { ++revision.current; };
  }, [source, board, period, page, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Two-finger pinching on the DOM surface continues to zoom the Phaser camera.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const forward = (event: TouchEvent, phase: 'start' | 'move') => {
      if (event.touches.length < 2) return;
      event.preventDefault();
      (window as any).__worldScene?.handleBoardPinch?.(
        { x: event.touches[0].clientX, y: event.touches[0].clientY },
        { x: event.touches[1].clientX, y: event.touches[1].clientY }, phase);
    };
    const onStart = (event: TouchEvent) => {
      pinchActive.current = event.touches.length >= 2;
      if (pinchActive.current) forward(event, 'start');
    };
    const onMove = (event: TouchEvent) => { if (pinchActive.current) forward(event, 'move'); };
    const onEnd = (event: TouchEvent) => {
      if (!pinchActive.current || event.touches.length >= 2) return;
      pinchActive.current = false;
      (window as any).__worldScene?.handleBoardPinch?.({ x: 0, y: 0 }, { x: 0, y: 0 }, 'end');
    };
    const blockGesture = (event: Event) => event.preventDefault();
    el.addEventListener('touchstart', onStart, { passive: false, capture: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', blockGesture);
    el.addEventListener('gesturechange', blockGesture);
    el.addEventListener('gestureend', blockGesture);
    return () => {
      el.removeEventListener('touchstart', onStart, true);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', blockGesture);
      el.removeEventListener('gesturechange', blockGesture);
      el.removeEventListener('gestureend', blockGesture);
    };
  }, [rect !== null]); // Reattach when the anchor appears/disappears.

  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const scale = rect.width / DESIGN_WIDTH;
  const designHeight = DESIGN_WIDTH * rect.height / rect.width;
  const pages = pageCount(boardData?.totalPlayers ?? 0);
  const overview = summaryData?.summary;
  const training = summaryData?.myTraining;
  const percent = training?.attempted ? Math.round(training.solvedFirstTry / training.attempted * 100) : 0;
  const strongest = training?.strongest?.[0]?.theme;
  const meInRows = boardData?.rows.some((row) => row.userId === userId && !!userId);

  return <div ref={containerRef} data-testid="academy-stats-panel" className="fixed z-[100] overflow-hidden select-none"
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, pointerEvents: 'auto', touchAction: 'none' }}>
    <section aria-label="Estatísticas da Academia" onClick={() => openModal({ board, period, page })}
      className="flex flex-col overflow-hidden border-[4px] border-[#ad8e54] bg-[#121e28] p-[12px] text-[#f5edd9] shadow-[inset_0_0_0_3px_#0b131b,inset_0_0_0_5px_#78613c,0_12px_35px_#0009]"
      style={{ width: DESIGN_WIDTH, height: designHeight, transform: `scale(${scale})`, transformOrigin: '0 0',
        fontFamily: 'Georgia, serif' }}>
      <header className="relative shrink-0 border-b border-[#987f50] pb-[12px]">
        <div className="text-[15px] font-bold tracking-[1px] text-[#e0b96d]">✦ TACTICS ACADEMY</div>
        <h2 className="text-[23px] font-bold leading-[27px] text-[#fff0cb]">Estatísticas</h2>
        <span className="absolute bottom-[13px] right-0 text-[12px] text-[#aab9bb]">toque para ampliar</span>
      </header>
      <nav aria-label="Quadros do ranking" className="grid shrink-0 grid-cols-4 gap-[5px] pt-[12px]">
        {STATS_BOARDS.map((id) => <button key={id} type="button" aria-pressed={board === id}
          onClick={(event) => { event.stopPropagation(); if (id !== board) { setBoard(id); setPage(1); } }}
          className={`h-[37px] truncate rounded-[4px] border px-[5px] text-[15px] font-bold ${board === id
            ? 'border-[#d5ac66] bg-[#675031] text-[#ffe1a1]'
            : 'border-[#43515a] bg-[#1c2a34] text-[#c4cfcd] hover:border-[#aa8852]'}`}>
          {STATS_BOARD_INFO[id].label}</button>)}
      </nav>
      <nav aria-label="Período" className="grid shrink-0 grid-cols-3 gap-[8px] pt-[12px]">
        {STATS_PERIODS.map((id) => <button key={id} type="button" aria-pressed={period === id}
          onClick={(event) => { event.stopPropagation(); if (id !== period) { setPeriod(id); setPage(1); } }}
          className={`h-[36px] rounded-[4px] border text-[15px] font-bold ${period === id
            ? 'border-[#dbad69] bg-[#725330] text-[#fff0c2]'
            : 'border-[#43515a] bg-[#1c2a34] text-[#bcc9c9] hover:border-[#aa8852]'}`}>
          {STATS_PERIOD_INFO[id].label}</button>)}
      </nav>
      <p className="shrink-0 truncate py-[10px] text-[13px] text-[#b3c0c0]" title={STATS_BOARD_INFO[board].description}>
        {STATS_BOARD_INFO[board].description}
      </p>
      <div className="grid shrink-0 grid-cols-[65px_1fr_95px] border-b border-[#796640] px-[12px] pb-[6px] text-[13px] font-bold text-[#d3c29b]">
        <span>POS.</span><span>JOGADOR</span><span className="text-right">{STATS_BOARD_INFO[board].unit.toUpperCase()}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pt-[5px]" aria-live="polite">
        {status !== 'ready' ? <div role={status === 'error' || status === 'missing' ? 'alert' : 'status'}
          className="flex h-full items-center justify-center px-[25px] text-center text-[16px] text-[#d3bb88]">
          {status === 'loading' ? 'Consultando os registros…' :
            status === 'missing' ? 'Estatísticas indisponíveis — execute tactics_academy_stats.sql.' :
              `Não foi possível carregar: ${error}`}
        </div> : !boardData?.rows.length
          ? <p className="pt-[36px] text-center text-[16px] text-[#bac4bd]">Ninguém pontuou neste período.</p>
          : boardData.rows.slice(0, 8).map((row, index) => {
            const mine = !!userId && row.userId === userId;
            const medal = row.rank === 1 ? 'text-[#f4c55c]' : row.rank === 2 ? 'text-[#cbd6dc]' :
              row.rank === 3 ? 'text-[#ca9163]' : 'text-[#a9b9bb]';
            return <div key={`${row.rank}-${row.userId}`}
              className={`grid h-[31px] grid-cols-[65px_1fr_95px] items-center rounded-[3px] px-[12px] text-[16px] ${mine
                ? 'bg-[#594529] font-bold text-[#ffe0a1]' : index % 2 ? 'bg-[#1d2b34] text-[#e9e5d7]' : 'bg-[#17242d] text-[#e9e5d7]'}`}>
              <span className={`font-bold ${medal}`}>{row.rank <= 3 ? `◆${row.rank}` : `${row.rank}.`}</span>
              <span className="truncate">{truncateName(row.username, 32)}</span>
              <span className="text-right font-bold tabular-nums">{row.value}</span>
            </div>;
          })}
      </div>
      {status === 'ready' && boardData?.me && !meInRows &&
        <div className="shrink-0 rounded-[3px] border border-[#b48c4d] bg-[#524026] px-[12px] py-[4px] text-[14px] font-bold text-[#ffe1a2]">
          Você · #{boardData.me.rank} · {boardData.me.value}
        </div>}
      <div className="flex h-[42px] shrink-0 items-center justify-between px-[10px] text-[15px] text-[#d7c9ac]">
        <button type="button" aria-label="Página anterior" disabled={page <= 1}
          onClick={(event) => { event.stopPropagation(); setPage((value) => Math.max(1, value - 1)); }}
          className="px-[8px] text-[25px] leading-none text-[#e8bd75] disabled:text-[#68777a]">‹</button>
        <span>página {page}/{pages}</span>
        <button type="button" aria-label="Próxima página" disabled={page >= pages}
          onClick={(event) => { event.stopPropagation(); setPage((value) => Math.min(pages, value + 1)); }}
          className="px-[8px] text-[25px] leading-none text-[#e8bd75] disabled:text-[#68777a]">›</button>
      </div>
      <footer className="shrink-0 rounded-[4px] border border-[#8d7349] bg-[#1c2a34] px-[12px] py-[8px]">
        <strong className="text-[14px] text-[#e3b975]">HOJE</strong>
        <p className="truncate text-[14px] leading-[23px] text-[#ece3cd]">
          ✓ {overview?.solvedToday ?? '—'} resolvidos　 ⚔ {overview?.battlesToday ?? '—'} batalhas　 ♙ {overview?.activeToday ?? '—'} jogadores
        </p>
        <div className="mt-[3px] border-t border-[#806a45] pt-[5px] text-[14px] text-[#efcf94]">
          <strong>MEU TREINO</strong>　{training?.lessonsCompleted ?? 0}/{training?.lessonsTotal ?? 26} lições · {percent}% 1ª tentativa
        </div>
        <p className="truncate text-[12px] text-[#a7b5b4]">Ponto forte: {strongest ? puzzleThemeLabel(strongest) : '—'}</p>
      </footer>
    </section>
  </div>;
}