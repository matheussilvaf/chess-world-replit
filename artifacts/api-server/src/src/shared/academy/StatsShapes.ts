/**
 * Estatísticas da academia: quadros do ranking e pesos de pontos.
 * Espelhado em server/src/shared, artifacts/api-server/src/src/shared e artifacts/chessworld/src/shared.
 * Os DEFAULTS de pontos também vivem no SQL (`tactics_academy_stats.sql`, COALESCE): manter iguais.
 */
export const STATS_BOARDS = ['points', 'solved', 'battles', 'lessons', 'problems', 'firsttry', 'hardest'] as const;
export type StatsBoard = typeof STATS_BOARDS[number];
export const STATS_PERIODS = ['week', 'month', 'all'] as const;
export type StatsPeriod = typeof STATS_PERIODS[number];
export const isStatsBoard = (value: unknown): value is StatsBoard => STATS_BOARDS.includes(value as StatsBoard);
export const isStatsPeriod = (value: unknown): value is StatsPeriod => STATS_PERIODS.includes(value as StatsPeriod);

/** Rótulo do quadro, unidade da coluna de valor e de onde o número vem. */
export const STATS_BOARD_INFO: Record<StatsBoard, { label: string; unit: string; description: string }> = {
  points: { label: 'Pontos', unit: 'pts', description: 'Soma dos pontos de cada ação da academia no período (os valores de cada ação são definidos na administração).' },
  solved: { label: 'Resolvidos', unit: 'puzzles', description: 'Quantidade de puzzles resolvidos: puzzle do dia, puzzles de batalha, práticas de lição e problemas.' },
  battles: { label: 'Batalhas', unit: 'vitórias', description: 'Batalhas de puzzles vencidas.' },
  lessons: { label: 'Lições', unit: 'temas', description: 'Temas de lição concluídos (todas as posições do tema feitas).' },
  problems: { label: 'Problemas', unit: 'resolvidos', description: 'Problemas resolvidos na Sala de Lições.' },
  firsttry: { label: '1ª tentativa', unit: 'acertos', description: 'Práticas de lição e problemas resolvidos sem nenhum erro.' },
  hardest: { label: 'Rating máx.', unit: 'rating', description: 'Maior rating de puzzle resolvido no período (puzzle do dia, práticas e problemas).' },
};
export const STATS_PERIOD_INFO: Record<StatsPeriod, { label: string; description: string }> = {
  week: { label: 'Semana', description: 'últimos 7 dias' },
  month: { label: 'Mês', description: 'últimos 30 dias' },
  all: { label: 'Sempre', description: 'desde o início' },
};

/** Ações que rendem pontos no quadro "Pontos"; o peso de cada uma é configurável na administração. */
export const ACADEMY_POINT_ACTIONS = [
  { key: 'daily_solved', label: 'Puzzle do dia resolvido', description: 'Cada puzzle do dia resolvido (qualquer número de vidas).', defaultPoints: 10 },
  { key: 'battle_puzzle_solved', label: 'Puzzle resolvido em batalha', description: 'Cada puzzle resolvido durante uma batalha.', defaultPoints: 2 },
  { key: 'battle_won', label: 'Batalha vencida', description: 'Cada batalha de puzzles vencida.', defaultPoints: 20 },
  { key: 'practice_solved', label: 'Prática de lição resolvida', description: 'Cada posição de prática resolvida na Sala de Lições.', defaultPoints: 3 },
  { key: 'problem_solved', label: 'Problema resolvido', description: 'Cada problema resolvido na Sala de Lições.', defaultPoints: 5 },
  { key: 'first_try_bonus', label: 'Bônus de 1ª tentativa', description: 'Extra por prática ou problema resolvido sem errar (soma ao valor da ação).', defaultPoints: 2 },
  { key: 'lesson_completed', label: 'Tema de lição concluído', description: 'Cada tema de lição concluído (vela acesa).', defaultPoints: 30 },
] as const;
export type AcademyPointKey = typeof ACADEMY_POINT_ACTIONS[number]['key'];
export const isAcademyPointKey = (value: unknown): value is AcademyPointKey =>
  ACADEMY_POINT_ACTIONS.some((action) => action.key === value);
export const ACADEMY_POINTS_MAX = 1000;

export interface AcademyPointsItem { key: AcademyPointKey; label: string; description: string; points: number; defaultPoints: number }
/** Resposta de GET /api/academy/stats/points e das rotas de administração. */
export interface AcademyPointsResponse { items: AcademyPointsItem[]; schemaMissing: boolean }

export interface StatsBoardRow { rank: number; userId: string; username: string; value: number }
export interface StatsBoardResponse {
  rows: StatsBoardRow[]; me: { rank: number; value: number } | null;
  page: number; size: number; totalPlayers: number; schemaMissing: boolean;
}
export interface StatsSummaryResponse {
  summary: { solvedToday: number; activeToday: number; battlesToday: number; lessonsToday: number;
    topThemeWeek: string | null; totalSolved: number; totalBattles: number } | null;
  myTraining: { lessonsCompleted: number; lessonsTotal: number; attempted: number;
    solvedFirstTry: number; strongest: { theme: string }[] };
  schemaMissing: boolean;
}
