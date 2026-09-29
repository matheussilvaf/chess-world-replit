import { useEffect, useState } from 'react';
import type { BoardResponse, SummaryResponse } from '../../game/academy/academyStatsLayout';
import { ACADEMY_POINT_ACTIONS } from '../../shared/academy/StatsShapes';
import { AcademyStatsModal, type StatsModalSource } from '../academy/stats/AcademyStatsModal';
import { AcademyStatsPanelOverlay } from '../academy/stats/AcademyStatsPanelOverlay';
import { useAcademyStatsStore } from '../../stores/academyStatsStore';

const board: BoardResponse = {
  rows: [
    { rank: 1, userId: 'a', username: 'RainhaDoTabuleiro', value: 218 },
    { rank: 2, userId: 'b', username: 'Cavaleiro de Prata', value: 191 },
    { rank: 3, userId: 'c', username: 'Bispo da Aurora', value: 173 },
    { rank: 4, userId: 'd', username: 'Xeque-mate', value: 156 },
    { rank: 5, userId: 'e', username: 'Abertura Italiana', value: 149 },
    { rank: 6, userId: 'f', username: 'Peão Valente', value: 127 },
    { rank: 7, userId: 'g', username: 'Dama das Estrelas', value: 112 },
    { rank: 8, userId: 'h', username: 'Torre de Ouro', value: 104 },
  ], me: { rank: 23, value: 41 }, page: 1, size: 8, totalPlayers: 38, schemaMissing: false,
};
const summary: SummaryResponse = {
  summary: { solvedToday: 147, battlesToday: 28, activeToday: 63, lessonsToday: 12,
    topThemeWeek: 'fork', totalSolved: 7238, totalBattles: 913 },
  myTraining: { lessonsCompleted: 12, lessonsTotal: 26, attempted: 54,
    solvedFirstTry: 38, strongest: [{ theme: 'fork' }] },
  schemaMissing: false,
};
const source: StatsModalSource = {
  board: async (_board, _period, page) => ({
    ...board, page, rows: page === 1 ? board.rows : [],
  }),
  summary: async () => summary,
  points: async () => ({ items: ACADEMY_POINT_ACTIONS.map((item) => ({ ...item, points: item.defaultPoints })), schemaMissing: false }),
};

export function StatsBenchPage() {
  const [zoom, setZoom] = useState(1.6);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const width = 320 * zoom;
  const height = 420 * zoom;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('modal') === '1') useAcademyStatsStore.getState().openModal();
    return () => useAcademyStatsStore.getState().close();
  }, []);
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    window.__uiAnchorScreenRects = {
      ...window.__uiAnchorScreenRects,
      tactics_academy_stats: {
        x: (viewport.width - width) / 2,
        y: (viewport.height - height) / 2,
        width, height,
      },
    };
    return () => {
      if (!window.__uiAnchorScreenRects) return;
      const { tactics_academy_stats: _anchor, ...others } = window.__uiAnchorScreenRects;
      window.__uiAnchorScreenRects = others;
    };
  }, [viewport, width, height]);
  return <main style={{ minHeight: '100vh', color: '#f5edd9',
    backgroundColor: '#c3c0b9',
    backgroundImage: 'linear-gradient(#8f8b83 2px, transparent 2px), linear-gradient(90deg, #8f8b83 2px, transparent 2px), linear-gradient(90deg, #8f8b83 2px, transparent 2px)',
    backgroundSize: '100px 42px, 100px 84px, 100px 84px',
    backgroundPosition: '0 0, 0 0, 50px 42px',
    fontFamily: 'Georgia, serif' }}>
    <div className="relative z-[110] mx-auto flex w-fit flex-wrap items-center justify-center gap-3 rounded-b-lg border border-[#8d7349] bg-[#111c26] px-5 py-3 shadow-xl">
      <strong className="text-[#e3b975]">Estatísticas da Academia · bancada</strong>
      <label htmlFor="stats-bench-zoom">Zoom</label>
      <input id="stats-bench-zoom" type="range" min="0.8" max="3" step="0.01" value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom do painel" />
      <span className="tabular-nums">{zoom.toFixed(2)}× · {width.toFixed(1)} × {height.toFixed(1)} px CSS</span>
      <button type="button" onClick={() => useAcademyStatsStore.getState().openModal()}
        className="rounded bg-[#b48a45] px-3 py-1 font-bold text-[#111c26]">Abrir modal</button>
    </div>
    <AcademyStatsPanelOverlay source={source} mockUserId="b" />
    <AcademyStatsModal source={source} />
  </main>;
}