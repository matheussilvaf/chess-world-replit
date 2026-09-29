import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { AcademyStatsBoard } from '../../game/academy/AcademyStatsBoard';
import type { BoardResponse, SummaryResponse } from '../../game/academy/academyStatsLayout';
import { ACADEMY_POINT_ACTIONS } from '../../shared/academy/StatsShapes';
import { AcademyStatsModal, type StatsModalSource } from '../academy/stats/AcademyStatsModal';
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
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('modal') === '1') useAcademyStatsStore.getState().openModal();
    return () => useAcademyStatsStore.getState().close();
  }, []);
  useEffect(() => {
    if (!host.current) return;
    const width = Math.min(window.innerWidth - 16, 600);
    const game = new Phaser.Game({
      type: Phaser.CANVAS, parent: host.current, width, height: 690,
      backgroundColor: '#15202b', render: { pixelArt: false },
      scene: {
        create(this: Phaser.Scene) {
          const g = this.add.graphics();
          g.fillStyle(0x263948).fillRect(0, 0, width, 690);
          g.lineStyle(1, 0x405363, 0.45);
          for (let y = 0; y < 690; y += 32) g.lineBetween(0, y, width, y);
          for (let x = 0; x < width; x += 32) g.lineBetween(x, 0, x, 690);
          const offset = (width - 320.5) / 2;
          const stats = new AcademyStatsBoard(this, { x: offset, y: 100, width: 320.5, height: 420.3 },
            { board, summary, userId: 'me' }, { onOpen: (selectedBoard, period, page) =>
              useAcademyStatsStore.getState().openModal({ board: selectedBoard, period, page }) });
          // Silhueta acima do painel, como o jogador no mundo (depth 100).
          const player = this.add.graphics().setDepth(100);
          player.fillStyle(0x14151d).fillEllipse(width / 2, 455, 22, 8);
          player.fillStyle(0x425b91).fillRoundedRect(width / 2 - 9, 428, 17, 25, 4);
          player.fillStyle(0xf0c69b).fillCircle(width / 2, 423, 9);
          this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => stats.hitTest(pointer.worldX, pointer.worldY));
          this.events.once('shutdown', () => stats.destroy());
        },
      },
    });
    return () => game.destroy(true);
  }, []);
  return <main style={{ minHeight: '100vh', background: '#0c1520', color: '#e7d6b6',
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 8px',
    fontFamily: 'Georgia, serif' }}>
    <h1 style={{ fontSize: 20, margin: '8px 0' }}>Tactics Academy · Estatísticas</h1>
    <p style={{ fontSize: 12, color: '#a6afac', margin: '0 0 12px' }}>Bancada visual · jogador acima do painel · clique nas abas</p>
    <button type="button" onClick={() => useAcademyStatsStore.getState().openModal()}
      style={{ background: '#b48a45', color: '#111c26', borderRadius: 8, padding: '8px 16px', marginBottom: 12, fontWeight: 700 }}>Abrir modal</button>
    <div ref={host} style={{ width: 'fit-content', maxWidth: '100%', overflow: 'hidden',
      boxShadow: '0 15px 60px #0008', border: '1px solid #79623d' }} />
    <AcademyStatsModal source={source} />
  </main>;
}