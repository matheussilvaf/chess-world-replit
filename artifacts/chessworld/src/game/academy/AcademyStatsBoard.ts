import Phaser from 'phaser';
import { puzzleThemeLabel } from '../../shared/academy/PuzzleShapes';
import { supabase } from '../../lib/supabase';
import { statsClient } from './academyStatsClient';
import { BOARDS, PERIODS, PAGE_SIZE, pageCount, truncateName,
  type BoardId, type PeriodId, type BoardResponse, type SummaryResponse } from './academyStatsLayout';

type Rect = { x: number; y: number; w: number; h: number; action: () => void };
type Bounds = { x: number; y: number; width: number; height: number };
const COLORS = { bg: 0x111c26, inset: 0x1c2a34, gold: 0xdab66b, muted: 0x899ca5, white: 0xf5edd9 };

export class AcademyStatsBoard {
  readonly container: Phaser.GameObjects.Container;
  private regions: Rect[] = [];
  private board: BoardId = 'solved';
  private period: PeriodId = 'week';
  private page = 1;
  private boardData: BoardResponse | null = null;
  private summaryData: SummaryResponse | null = null;
  private status: 'loading' | 'ready' | 'missing' | 'error' = 'loading';
  private error = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private revision = 0;
  private destroyed = false;
  private currentUserId = '';

  constructor(private scene: Phaser.Scene, private bounds: Bounds, private mock?: {
    board: BoardResponse; summary: SummaryResponse; userId: string;
  }) {
    this.container = scene.add.container(bounds.x, bounds.y).setDepth(20);
    this.draw();
    if (mock) {
      this.boardData = mock.board;
      this.summaryData = mock.summary;
      this.status = 'ready';
      this.draw();
    } else {
      void supabase.auth.getSession().then(({ data }) => {
        if (!this.destroyed) { this.currentUserId = data.session?.user.id ?? ''; this.draw(); }
      });
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), 60_000);
    }
  }

  private async refresh() {
    const revision = ++this.revision;
    this.status = 'loading';
    this.draw();
    try {
      const [board, summary] = await Promise.all([
        statsClient.board(this.board, this.period, this.page), statsClient.summary(),
      ]);
      if (this.destroyed || revision !== this.revision) return;
      this.boardData = board;
      if (!board.schemaMissing) this.page = board.page; // o servidor limita a página ao total real
      this.summaryData = summary;
      this.status = board.schemaMissing || summary.schemaMissing ? 'missing' : 'ready';
    } catch (error) {
      if (this.destroyed || revision !== this.revision) return;
      this.status = 'error';
      this.error = error instanceof Error ? error.message : 'Erro ao carregar.';
    }
    this.draw();
  }

  private chooseBoard(board: BoardId) {
    if (board === this.board) return;
    this.board = board; this.page = 1;
    if (this.mock) this.draw(); else void this.refresh();
  }
  private choosePeriod(period: PeriodId) {
    if (period === this.period) return;
    this.period = period; this.page = 1;
    if (this.mock) this.draw(); else void this.refresh();
  }
  private turn(delta: number) {
    const next = Math.max(1, Math.min(pageCount(this.boardData?.totalPlayers ?? 0), this.page + delta));
    if (next === this.page) return;
    this.page = next;
    if (this.mock) this.draw(); else void this.refresh();
  }

  /** Ponto do mundo dentro do painel (o jogador não anda ao tocar nele, mesmo fora dos botões). */
  contains(x: number, y: number): boolean {
    return x >= this.bounds.x && x <= this.bounds.x + this.bounds.width && y >= this.bounds.y && y <= this.bounds.y + this.bounds.height;
  }
  /** Consome o clique se caiu no painel; executa a ação da aba/seta tocada. */
  hitTest(x: number, y: number): boolean {
    if (!this.contains(x, y)) return false;
    const localX = x - this.bounds.x, localY = y - this.bounds.y;
    const region = this.regions.find((r) =>
      localX >= r.x && localX <= r.x + r.w && localY >= r.y && localY <= r.y + r.h);
    region?.action();
    return true;
  }
  destroy() {
    this.destroyed = true; ++this.revision;
    if (this.timer) clearInterval(this.timer);
    this.container.destroy();
  }

  private draw() {
    this.container.removeAll(true);
    this.regions = [];
    const w = this.bounds.width, h = this.bounds.height;
    const g = this.scene.add.graphics();
    this.container.add(g);
    const box = (x: number, y: number, bw: number, bh: number, color: number, border = COLORS.gold) => {
      g.fillStyle(color, 0.98).fillRoundedRect(x, y, bw, bh, 4);
      g.lineStyle(1, border, 0.65).strokeRoundedRect(x + 0.5, y + 0.5, bw - 1, bh - 1, 4);
    };
    const text = (value: string, x: number, y: number, size = 10, color = '#f5edd9', bold = false) => {
      const obj = this.scene.add.text(x, y, value, {
        fontFamily: 'Georgia, serif', fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal',
        color, resolution: 2,
      }).setOrigin(0, 0);
      this.container.add(obj);
      return obj;
    };
    box(0, 0, w, h, COLORS.bg);
    g.lineStyle(2, COLORS.gold, 0.7).strokeRoundedRect(3, 3, w - 6, h - 6, 4);
    g.fillStyle(COLORS.gold, 0.12).fillRect(7, 7, w - 14, 35);
    text('✦  TACTICS ACADEMY', 13, 10, 10, '#dab66b', true);
    text('Estatísticas', 13, 23, 12, '#fff1cb', true);
    g.lineStyle(1, COLORS.gold, 0.6).lineBetween(10, 44, w - 10, 44);

    const gap = 4, tabW = (w - 24 - gap * 2) / 3;
    BOARDS.forEach((item, index) => {
      const x = 10 + index % 3 * (tabW + gap), y = 51 + Math.floor(index / 3) * 25;
      box(x, y, tabW, 22, item.id === this.board ? 0x55472f : COLORS.inset,
        item.id === this.board ? COLORS.gold : 0x43515a);
      const label = text(item.label, x + tabW / 2, y + 5, 9,
        item.id === this.board ? '#ffe0a0' : '#bdc8c7', item.id === this.board);
      label.setOrigin(0.5, 0);
      this.regions.push({ x, y, w: tabW, h: 22, action: () => this.chooseBoard(item.id) });
    });
    PERIODS.forEach((item, index) => {
      const cw = (w - 28) / 3, x = 10 + index * (cw + 4), y = 107;
      box(x, y, cw, 20, item.id === this.period ? 0x725330 : COLORS.inset,
        item.id === this.period ? COLORS.gold : 0x43515a);
      text(item.label, x + cw / 2, y + 4, 9,
        item.id === this.period ? '#fff0c2' : '#aab9bb').setOrigin(0.5, 0);
      this.regions.push({ x, y, w: cw, h: 20, action: () => this.choosePeriod(item.id) });
    });
    text('POS.', 17, 136, 8, '#a69a7c', true);
    text('JOGADOR', 54, 136, 8, '#a69a7c', true);
    text('PTS', w - 34, 136, 8, '#a69a7c', true);
    g.lineStyle(1, 0x6f613f, 0.55).lineBetween(11, 150, w - 11, 150);

    if (this.status !== 'ready') {
      const message = this.status === 'loading' ? 'Consultando os registros…' :
        this.status === 'missing' ? 'Estatísticas indisponíveis\nExecute tactics_academy_stats.sql' :
        `Não foi possível carregar\n${truncateName(this.error, 37)}`;
      text(message, w / 2, 223, 10, '#d3bb88').setOrigin(0.5, 0.5).setAlign('center');
    } else if (!this.boardData?.rows.length) {
      text('Ninguém pontuou ainda', w / 2, 230, 11, '#bac4bd').setOrigin(0.5, 0.5);
    } else {
      this.boardData.rows.slice(0, PAGE_SIZE).forEach((row, index) => {
        const y = 154 + index * 18;
        const mine = row.userId === (this.mock?.userId ?? this.userId());
        g.fillStyle(mine ? 0x594529 : index % 2 ? 0x1d2b34 : 0x17242d, 0.92)
          .fillRoundedRect(11, y, w - 22, 17, 2);
        const medal = row.rank === 1 ? '#f4c55c' : row.rank === 2 ? '#cbd6dc' :
          row.rank === 3 ? '#ca9163' : '#879aa0';
        text(row.rank <= 3 ? `◆${row.rank}` : `${row.rank}.`, 17, y + 4, 10, medal, row.rank <= 3);
        text(truncateName(row.username, Math.max(10, Math.floor((w - 105) / 6))), 54, y + 4, 10,
          mine ? '#ffd98d' : '#e9e5d7', mine);
        text(String(row.value), w - 18, y + 4, 10, mine ? '#ffd98d' : '#ddd2ac', true).setOrigin(1, 0);
      });
    }
    const pages = pageCount(this.boardData?.totalPlayers ?? 0);
    const paginationY = h - 93;
    if (this.status === 'ready' && this.boardData?.me &&
      !this.boardData.rows.some((row) => row.userId === (this.mock?.userId ?? this.userId()))) {
      box(11, paginationY - 24, w - 22, 20, 0x524026, 0xc79c54);
      text(`Você  ·  #${this.boardData.me.rank}  ·  ${this.boardData.me.value}`, 18, paginationY - 20, 10, '#ffe1a2', true);
    }
    text('‹', 19, paginationY, 17, this.page > 1 ? '#f4cd84' : '#68777a', true);
    text(`página ${this.page}/${pages}`, w / 2, paginationY + 6, 9, '#c6bba4').setOrigin(0.5, 0);
    text('›', w - 30, paginationY, 17, this.page < pages ? '#f4cd84' : '#68777a', true);
    this.regions.push({ x: 11, y: paginationY, w: 35, h: 23, action: () => this.turn(-1) });
    this.regions.push({ x: w - 46, y: paginationY, w: 35, h: 23, action: () => this.turn(1) });
    const footer = h - 67;
    box(10, footer, w - 20, 57, COLORS.inset, 0x8d7349);
    const summary = this.summaryData?.summary;
    const training = this.summaryData?.myTraining;
    text('HOJE', 18, footer + 6, 8, '#dcb878', true);
    text(`✓ ${summary?.solvedToday ?? '—'} resolvidos    ⚔ ${summary?.battlesToday ?? '—'} batalhas    ♙ ${summary?.activeToday ?? '—'} jogadores`,
      18, footer + 18, 9, '#ece3cd');
    g.lineStyle(1, 0x806a45, 0.55).lineBetween(17, footer + 31, w - 17, footer + 31);
    const percent = training?.attempted ? Math.round(training.solvedFirstTry / training.attempted * 100) : 0;
    const strongest = training?.strongest?.[0]?.theme;
    text(`MEU TREINO   ${training?.lessonsCompleted ?? 0}/${training?.lessonsTotal ?? 26} lições  ·  ${percent}% 1ª tentativa`,
      18, footer + 35, 9, '#efcf94');
    text(`Ponto forte: ${strongest ? puzzleThemeLabel(strongest) : '—'}`, 18, footer + 46, 8, '#a7b5b4');
  }
  private userId(): string {
    return this.currentUserId;
  }
}