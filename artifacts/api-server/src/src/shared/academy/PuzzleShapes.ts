/**
 * Tactics Academy — Fase 2: SALA DE PUZZLES (contratos cliente/servidor).
 *
 * Fonte dos puzzles: `public.lichess_puzzles` (importação do banco aberto do
 * Lichess): puzzle_id, fen, moves (uci[]), rating, rating_deviation, popularity,
 * nb_plays, themes (text[]), game_url, opening_tags, random_key (float 0..1).
 *
 * FORMATO (regra obrigatória): `fen` é a posição ANTES do lance do adversário.
 * `moves[0]` é aplicado automaticamente (com animação) e a solução começa em
 * `moves[1]`; depois de cada lance certo do jogador, o lance seguinte é jogado
 * automaticamente pelo adversário. O servidor NUNCA envia lances futuros da
 * solução ao cliente: ele valida lance a lance e devolve só a resposta.
 *
 * Recompensas: SOMENTE Gambitos (diário e batalhas), configuráveis no /admin;
 * nada de XP nem Coroas. Batalhas podem ficar sem recompensa (0 / desligado).
 */
import type { LessonDifficultyId, LessonThemeId, ProblemFilters } from './LessonShapes.js';

// ---------------------------------------------------------------------------
// Faixas e rótulos
// ---------------------------------------------------------------------------

/** Faixa de dificuldade das BATALHAS (escolhida por quem cria o desafio). */
export type PuzzleBand = 'beginner' | 'intermediate' | 'advanced' | 'master';
export const PUZZLE_BANDS: readonly PuzzleBand[] = ['beginner', 'intermediate', 'advanced', 'master'] as const;
export const PUZZLE_BAND_INFO: Record<PuzzleBand, { label: string; min: number; max: number }> = {
  beginner: { label: 'Iniciante', min: 600, max: 1100 },
  intermediate: { label: 'Intermediário', min: 1100, max: 1600 },
  advanced: { label: 'Avançado', min: 1600, max: 2100 },
  master: { label: 'Mestre', min: 2100, max: 2600 },
};
export function isPuzzleBand(v: unknown): v is PuzzleBand {
  return typeof v === 'string' && (PUZZLE_BANDS as readonly string[]).includes(v);
}

/** Rótulo de dificuldade exibido para UM puzzle (pelo rating). */
export function puzzleDifficultyLabel(rating: number): string {
  if (rating < 1000) return 'Iniciante';
  if (rating < 1400) return 'Fácil';
  if (rating < 1800) return 'Intermediário';
  if (rating < 2200) return 'Avançado';
  if (rating < 2600) return 'Expert';
  return 'Mestre';
}

/** Temas do Lichess → pt-BR (lista completa do banco aberto). */
export const PUZZLE_THEME_LABELS: Record<string, string> = {
  advancedPawn: 'Peão avançado', advantage: 'Vantagem', anastasiaMate: 'Mate de Anastasia', arabianMate: 'Mate árabe',
  attackingF2F7: 'Ataque a f2/f7', attraction: 'Atração', backRankMate: 'Mate na última fileira', bishopEndgame: 'Final de bispos',
  bodenMate: 'Mate de Boden', capturingDefender: 'Captura do defensor', castling: 'Roque', clearance: 'Desobstrução',
  crushing: 'Esmagador', defensiveMove: 'Lance defensivo', deflection: 'Desvio', discoveredAttack: 'Ataque descoberto',
  doubleBishopMate: 'Mate dos dois bispos', doubleCheck: 'Xeque duplo', dovetailMate: 'Mate de cauda de andorinha', enPassant: 'En passant',
  endgame: 'Final', equality: 'Igualdade', exposedKing: 'Rei exposto', fork: 'Garfo', hangingPiece: 'Peça pendurada',
  hookMate: 'Mate do gancho', interference: 'Interferência', intermezzo: 'Intermezzo', killBoxMate: 'Mate da caixa',
  kingsideAttack: 'Ataque na ala do rei', knightEndgame: 'Final de cavalos', long: 'Longo', master: 'Partida de mestre',
  masterVsMaster: 'Mestre vs mestre', mate: 'Mate', mateIn1: 'Mate em 1', mateIn2: 'Mate em 2', mateIn3: 'Mate em 3',
  mateIn4: 'Mate em 4', mateIn5: 'Mate em 5', middlegame: 'Meio-jogo', oneMove: 'Um lance', opening: 'Abertura',
  pawnEndgame: 'Final de peões', pin: 'Cravada', promotion: 'Promoção', queenEndgame: 'Final de damas',
  queenRookEndgame: 'Final de dama e torre', queensideAttack: 'Ataque na ala da dama', quietMove: 'Lance quieto',
  rookEndgame: 'Final de torres', sacrifice: 'Sacrifício', short: 'Curto', skewer: 'Raio X (espeto)', smotheredMate: 'Mate sufocado',
  superGM: 'Super GM', trappedPiece: 'Peça presa', underPromotion: 'Subpromoção', veryLong: 'Muito longo',
  vukovicMate: 'Mate de Vukovic', xRayAttack: 'Ataque raio X', zugzwang: 'Zugzwang',
};
export function puzzleThemeLabel(theme: string): string {
  return PUZZLE_THEME_LABELS[theme] ?? theme;
}
/** Temas "estruturais" que não descrevem a ideia tática (não mostrar como tema principal). */
export const PUZZLE_META_THEMES: readonly string[] = ['short', 'long', 'veryLong', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality', 'middlegame', 'endgame', 'opening'] as const;
export function puzzleMainThemes(themes: readonly string[], max = 3): string[] {
  const tactical = themes.filter((t) => !PUZZLE_META_THEMES.includes(t));
  return (tactical.length > 0 ? tactical : themes).slice(0, max);
}

// ---------------------------------------------------------------------------
// Puzzle (visão do cliente — sem lances futuros)
// ---------------------------------------------------------------------------

export interface PuzzleSummary {
  puzzleId: string;
  rating: number;
  /** Temas (chaves do Lichess) — só quando podem ser exibidos. */
  themes: string[];
}

/** Lado que resolve = lado a jogar DEPOIS do lance de preparação (`moves[0]`). */
export type PuzzleColor = 'w' | 'b';

export const DAILY_PUZZLE_SLOTS = [1, 2, 3] as const;
export type DailySlot = (typeof DAILY_PUZZLE_SLOTS)[number];
export function isDailySlot(v: unknown): v is DailySlot {
  return v === 1 || v === 2 || v === 3;
}

export const DAILY_PUZZLE_LIVES = 3;
/** Recompensa proporcional às vidas restantes ao acertar: 3 = 100% | 2 = 70% | 1 = 40%. */
export const DAILY_REWARD_BY_LIVES: Record<number, number> = { 3: 1, 2: 0.7, 1: 0.4 };
export function dailyRewardFor(baseGambits: number, livesLeft: number): number {
  return Math.max(0, Math.round(baseGambits * (DAILY_REWARD_BY_LIVES[livesLeft] ?? 0)));
}
/**
 * Fuso do "dia" dos puzzles diários (sorteio às 00:00 no horário de Brasília,
 * UTC−3, sem horário de verão). Data local = `dailyPuzzleDate(now)`.
 */
export const DAILY_PUZZLE_UTC_OFFSET_MIN = -180;
export function dailyPuzzleDate(now: Date | number = Date.now()): string {
  const t = typeof now === 'number' ? now : now.getTime();
  return new Date(t + DAILY_PUZZLE_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
/** Instante (ms) da próxima virada de dia (00:00 no fuso acima). */
export function dailyPuzzleNextReset(now: Date | number = Date.now()): number {
  const t = typeof now === 'number' ? now : now.getTime();
  const shifted = new Date(t + DAILY_PUZZLE_UTC_OFFSET_MIN * 60_000);
  const nextLocalMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return nextLocalMidnight - DAILY_PUZZLE_UTC_OFFSET_MIN * 60_000;
}
export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export type DailySlotStatus = 'available' | 'in_progress' | 'solved' | 'failed';

export interface DailySlotView extends PuzzleSummary {
  slot: DailySlot;
  /** Recompensa base (100%) em Gambitos. */
  rewardGambits: number;
  status: DailySlotStatus;
  livesLeft: number;
  /** Gambitos efetivamente creditados (quando `solved`). */
  earnedGambits: number;
}

/** servidor → cliente (`PUZZLE_MSG.dailyState`). */
export interface DailyStatePayload {
  date: string;
  slots: DailySlotView[];
  /** epoch ms da próxima virada (00:00). */
  nextResetAt: number;
  serverNow: number;
  /** true quando as tabelas da fase 2 ainda não existem no Supabase. */
  schemaMissing: boolean;
  /** Config do admin: mostrar o tema dos puzzles diários (lista e durante a resolução). */
  showThemes: boolean;
}

/** Cadeira física da mesa (mesmo conceito das partidas normais: bottom = brancas). */
export type PuzzleSeat = 'bottom' | 'top';
export function isPuzzleSeat(v: unknown): v is PuzzleSeat {
  return v === 'bottom' || v === 'top';
}

/** cliente → servidor (`PUZZLE_MSG.dailySit`): sentar na mesa do puzzle diário. */
export interface DailySitPayload {
  boardId: string;
}
/** servidor → cliente (`PUZZLE_MSG.dailySeated`): cadeira reservada nesta mesa. */
export interface DailySeatedPayload {
  boardId: string;
  seat: PuzzleSeat;
}

// ---------------------------------------------------------------------------
// Sessão de resolução (diário e batalha usam o MESMO fluxo de lances)
// ---------------------------------------------------------------------------

export type PuzzleContext =
  | { kind: 'daily'; slot: DailySlot }
  | { kind: 'battle'; battleId: string; index: number }
  | { kind: 'lesson'; theme: LessonThemeId; difficulty: LessonDifficultyId; index: number; total: number }
  | { kind: 'problem'; index: number; filters: ProblemFilters };

/** Restringe um contexto aos modos antigos, para evitar tratar lições como batalhas. */
export function isTablePuzzleContext(context: PuzzleContext): context is Extract<PuzzleContext, { kind: 'daily' | 'battle' }> {
  return context.kind === 'daily' || context.kind === 'battle';
}

/** servidor → cliente: um puzzle para resolver (`PUZZLE_MSG.puzzleStarted`). */
export interface PuzzleStartedPayload extends PuzzleSummary {
  /** Identificador da sessão (vai em todo `puzzleMove`). Muda a cada reinício/puzzle. */
  sessionId: string;
  context: PuzzleContext;
  /** Mesa do mapa onde o puzzle é resolvido e a cadeira do jogador nela. */
  boardId: string;
  seat: PuzzleSeat;
  /** Posição ANTES do lance de preparação. */
  fen: string;
  /** `moves[0]` em UCI — o cliente anima este lance antes de liberar o tabuleiro. */
  setupMove: string;
  playerColor: PuzzleColor;
  /** Quantos lances o JOGADOR precisa acertar. */
  solutionLength: number;
  /** Vidas restantes (diário e Survival); ausente nos demais modos. */
  livesLeft?: number;
  /** Prazo (epoch ms) deste puzzle (Melhor de N). */
  deadlineAt?: number;
  /** Temas só quando visíveis (diário: config do admin; batalha: `showThemes`). Vazio caso contrário. */
  themes: string[];
  /** Batalha: o tema pedido não tinha puzzle na faixa e o sorteio caiu em qualquer tema — `themes` traz o tema real. */
  themeFallback?: boolean;
}

/** cliente → servidor (`PUZZLE_MSG.puzzleMove`). `uci` com promoção quando houver (e7e8q). */
export interface PuzzleMovePayload {
  sessionId: string;
  uci: string;
}

/** servidor → cliente (`PUZZLE_MSG.puzzleFeedback`). */
export interface PuzzleFeedbackPayload {
  sessionId: string;
  /** Lance aceito? */
  ok: boolean;
  /** Índice (0-based) do lance do jogador que foi avaliado. */
  moveIndex: number;
  /** Resposta automática do adversário (UCI) após um acerto que ainda não completou o puzzle. */
  reply?: string;
  /** Sequência completa acertada. */
  solved: boolean;
  /** Diário: errou e o puzzle reinicia do começo (nova `sessionId` chega via `puzzleStarted`). */
  restart?: boolean;
  livesLeft?: number;
  /** Diário reprovado (0 vidas): solução completa em UCI a partir de `moves[1]` (para exibir). */
  solutionMoves?: string[];
  /** Diário resolvido: Gambitos creditados e saldo resultante. */
  rewardGambits?: number;
  gambitsBalance?: number | null;
  /** Diário: status final do slot depois deste lance. */
  dailyStatus?: DailySlotStatus;
  /** Temas revelados ao terminar um puzzle que estava com o tema oculto (problemas "Misto"). */
  themes?: string[];
  /** Batalha: o puzzle foi encerrado para este jogador (errou / adversário resolveu antes / prazo). */
  puzzleOver?: boolean;
  puzzleOverReason?: 'wrong' | 'opponent_first' | 'timeout';
}

// ---------------------------------------------------------------------------
// Batalhas de puzzle (4 tabuleiros de desafio)
// ---------------------------------------------------------------------------

export type BattleMode = 'race' | 'streak' | 'best_of_5' | 'best_of_10' | 'best_of_15' | 'survival' | 'pressure';
export const BATTLE_MODES: readonly BattleMode[] = ['race', 'streak', 'best_of_5', 'best_of_10', 'best_of_15', 'survival', 'pressure'] as const;
export function isBattleMode(v: unknown): v is BattleMode {
  return typeof v === 'string' && (BATTLE_MODES as readonly string[]).includes(v);
}

export interface BattleModeInfo {
  label: string;
  /** Descrição curta mostrada na escolha do modo. */
  description: string;
  /** Duração total (ms) — só nos modos com relógio de partida. */
  durationMs?: number;
  /** Melhor de N: total de puzzles. */
  bestOf?: number;
  /** Vidas iniciais (Survival). */
  lives?: number;
  /** Pressão: relógio inicial de cada jogador e desconto no adversário por acerto. */
  clockMs?: number;
  penaltyMs?: number;
}

export const BATTLE_MODE_INFO: Record<BattleMode, BattleModeInfo> = {
  race: { label: 'Corrida', description: '3 minutos. Vence quem resolver mais puzzles.', durationMs: 3 * 60_000 },
  streak: { label: 'Sequência', description: 'A dificuldade sobe a cada acerto. Um erro encerra a sua vez. Vence quem for mais longe.', durationMs: 10 * 60_000 },
  best_of_5: { label: 'Melhor de 5', description: 'Um puzzle por vez, os dois veem ao mesmo tempo. Cada puzzle é de quem resolver primeiro.', bestOf: 5 },
  best_of_10: { label: 'Melhor de 10', description: 'Um puzzle por vez, os dois veem ao mesmo tempo. Cada puzzle é de quem resolver primeiro.', bestOf: 10 },
  best_of_15: { label: 'Melhor de 15', description: 'Um puzzle por vez, os dois veem ao mesmo tempo. Cada puzzle é de quem resolver primeiro.', bestOf: 15 },
  survival: { label: 'Survival', description: '3 vidas e 3 minutos. Errar tira uma vida; quem zerar as vidas perde. Desempate: vidas, acertos e tempo.', durationMs: 3 * 60_000, lives: 3 },
  pressure: { label: 'Pressão', description: 'Os dois começam com 2 minutos. Cada acerto tira 10 segundos do relógio do adversário. Vence quem zerar o relógio do outro.', clockMs: 2 * 60_000, penaltyMs: 10_000 },
};

/** Desafio aberto expira em 10 minutos. */
export const BATTLE_CHALLENGE_TTL_MS = 10 * 60_000;
/** Contagem regressiva antes de começar. */
export const BATTLE_COUNTDOWN_MS = 3_000;
/** Melhor de N: prazo por puzzle (ninguém resolveu → sem ponto). */
export const BATTLE_BEST_OF_PUZZLE_MS = 90_000;
/** Sequência: incremento de rating alvo a cada puzzle (a partir do mínimo da faixa). */
export const BATTLE_STREAK_RATING_STEP = 50;
/** Puzzles que o servidor mantém pré-sorteados à frente de cada jogador. */
export const BATTLE_PREFETCH = 2;

/**
 * Temas que podem ser escolhidos como FILTRO de uma batalha (todos os temas
 * táticos do banco; ficam de fora os meta-temas de tamanho/origem/fase e as
 * etiquetas de avaliação, que não descrevem uma ideia). Ordenados pelo rótulo.
 */
export const BATTLE_THEME_OPTIONS: readonly string[] = Object.keys(PUZZLE_THEME_LABELS)
  .filter((t) => !PUZZLE_META_THEMES.includes(t))
  .sort((a, b) => puzzleThemeLabel(a).localeCompare(puzzleThemeLabel(b), 'pt-BR'));
export function isBattleTheme(v: unknown): v is string {
  return typeof v === 'string' && BATTLE_THEME_OPTIONS.includes(v);
}

/** cliente → servidor (`PUZZLE_MSG.battleCreate`). */
export interface BattleCreatePayload {
  boardId: string;
  mode: BattleMode;
  band: PuzzleBand;
  /** Mostrar o tema de cada puzzle aos dois jogadores. */
  showThemes: boolean;
  /** Filtro opcional: só puzzles que contenham este tema (chave do Lichess, ver `BATTLE_THEME_OPTIONS`). */
  theme?: string;
}

/** cliente → servidor (`PUZZLE_MSG.battleAccept` / `battleCancel`). */
export interface BattleBoardPayload {
  boardId: string;
}

/** cliente → servidor (`PUZZLE_MSG.battleLeave`): desistir da batalha em andamento. */
export interface BattleLeavePayload {
  battleId: string;
}

export type BattlePhase = 'countdown' | 'running' | 'finished';

/** Progresso de UM jogador (o adversário vê isto, nunca o tabuleiro). */
export interface BattlePlayerView {
  playerId: string;
  name: string;
  /** Cor do solucionador no puzzle atual deste participante. */
  color: PuzzleColor;
  /** Índice do puzzle atual na sequência (0-based). */
  index: number;
  solved: number;
  failed: number;
  /** Survival. */
  lives?: number;
  /** Pressão: relógio restante (ms) no instante `serverNow`; corre enquanto `phase === 'running'`. */
  clockMs?: number;
  /** Melhor de N: pontos. */
  points?: number;
  /** Terminou a própria vez (Sequência: errou; Survival: 0 vidas; Pressão: relógio zerou). */
  done: boolean;
  /** Soma do tempo (ms) gasto nos puzzles resolvidos (desempate do Survival). */
  solveTimeMs: number;
  /** Desconectado no momento. */
  offline: boolean;
}

export type BattleEndReason = 'time' | 'score' | 'lives' | 'clock' | 'both_done' | 'forfeit' | 'all_puzzles' | 'aborted';

export interface BattleResultView {
  /** '' = empate. */
  winnerId: string;
  reason: BattleEndReason;
  /** Gambitos creditados a MIM (0 quando desligado/empate sem prêmio). */
  myRewardGambits: number;
  gambitsBalance: number | null;
}

/** servidor → cliente (`PUZZLE_MSG.battleState`): snapshot completo, enviado a cada mudança. */
export interface BattleStatePayload {
  battleId: string;
  boardId: string;
  /** Minha cadeira na mesa (criador = bottom, quem aceitou = top). */
  mySeat: PuzzleSeat;
  mode: BattleMode;
  band: PuzzleBand;
  showThemes: boolean;
  /** Filtro de tema escolhido na criação (ausente = qualquer tema). */
  theme?: string;
  phase: BattlePhase;
  serverNow: number;
  /** Início do jogo (fim da contagem regressiva). */
  startsAt: number;
  /** Fim programado (modos com duração). */
  endsAt?: number;
  /** Melhor de N: puzzle atual (0-based) e prazo dele. */
  bestOf?: { total: number; current: number; deadlineAt: number };
  me: BattlePlayerView;
  opponent: BattlePlayerView;
  result?: BattleResultView;
}

/** Histórico (`academy_puzzle_battles`) — GET /api/academy/battles/me */
export interface PuzzleBattleRecord {
  id: string;
  mode: BattleMode;
  band: PuzzleBand;
  showThemes: boolean;
  /** Do ponto de vista de quem consulta. */
  opponentName: string;
  outcome: 'win' | 'loss' | 'draw';
  reason: BattleEndReason;
  mySolved: number;
  opponentSolved: number;
  rewardGambits: number;
  startedAt: string;
  finishedAt: string;
}

// ---------------------------------------------------------------------------
// Mensagens Colyseus (sala `academy`)
// ---------------------------------------------------------------------------

export const PUZZLE_MSG = {
  /** C→S {} — pede o estado do dia (também reenviado pelo servidor após mudanças). */
  dailyOpen: 'academy_daily_open',
  /** S→C DailyStatePayload */
  dailyState: 'academy_daily_state',
  /** C→S DailySitPayload — reserva uma cadeira na mesa do puzzle diário (obrigatório antes de `dailyStart`). */
  dailySit: 'academy_daily_sit',
  /** S→C DailySeatedPayload */
  dailySeated: 'academy_daily_seated',
  /** C→S {} — levanta da mesa do puzzle diário (encerra a sessão aberta). */
  dailyLeave: 'academy_daily_leave',
  /** C→S { slot } — começa (ou retoma do zero) a tentativa do slot. */
  dailyStart: 'academy_daily_start',

  /** S→C PuzzleStartedPayload */
  puzzleStarted: 'academy_puzzle_started',
  /** C→S PuzzleMovePayload */
  puzzleMove: 'academy_puzzle_move',
  /** S→C PuzzleFeedbackPayload */
  puzzleFeedback: 'academy_puzzle_feedback',

  /** C→S BattleCreatePayload */
  battleCreate: 'academy_battle_create',
  /** C→S BattleBoardPayload — criador desiste do desafio aberto. */
  battleCancel: 'academy_battle_cancel',
  /** C→S BattleBoardPayload */
  battleAccept: 'academy_battle_accept',
  /** C→S BattleLeavePayload — abandona a batalha (derrota). */
  battleLeave: 'academy_battle_leave',
  /** S→C BattleStatePayload (só para os dois participantes). */
  battleState: 'academy_battle_state',
  /** S→C { boardId } — o desafio aberto do criador expirou (10 min) ou foi cancelado. */
  battleChallengeClosed: 'academy_battle_challenge_closed',
  /** C→S {} — cliente saiu da tela da batalha encerrada (libera estado no servidor). */
  battleDismiss: 'academy_battle_dismiss',
} as const;

export interface DailyStartPayload {
  slot: DailySlot;
}

export interface BattleChallengeClosedPayload {
  boardId: string;
  reason: 'expired' | 'cancelled';
}

/** Códigos de `academy_error` usados pela Sala de Puzzles (`{ code, message }`). */
export type PuzzleErrorCode =
  | 'schema_missing' | 'not_academy' | 'board_busy' | 'board_missing' | 'already_seated'
  | 'daily_done' | 'daily_unavailable' | 'session_invalid' | 'illegal_move' | 'battle_missing'
  | 'battle_not_yours' | 'battle_self' | 'battle_expired' | 'invalid_payload' | 'no_puzzles' | 'not_seated';

// ---------------------------------------------------------------------------
// BoardState (campos extras nos tabuleiros de desafio, Colyseus schema)
// ---------------------------------------------------------------------------
// status 'waiting' + waitingPlayerId/Name + battleMode/battleBand/battleShowThemes/
// battleExpiresAt (epoch ms) enquanto o desafio está aberto; status 'playing' +
// matchId = battleId durante a batalha. `resetBoard` limpa tudo.

// ---------------------------------------------------------------------------
// REST — configuração (admin) e histórico
// ---------------------------------------------------------------------------

/** Configuração de UM slot diário (linha de `academy_daily_config`). */
export interface DailySlotConfig {
  slot: DailySlot;
  ratingMin: number;
  ratingMax: number;
  /** Tema do Lichess ou '' = qualquer tema. */
  theme: string;
  /** Recompensa base em Gambitos (3 vidas = 100%). */
  rewardGambits: number;
}

export const DEFAULT_DAILY_SLOT_CONFIGS: DailySlotConfig[] = [
  { slot: 1, ratingMin: 600, ratingMax: 1100, theme: '', rewardGambits: 10 },
  { slot: 2, ratingMin: 1100, ratingMax: 1600, theme: '', rewardGambits: 20 },
  { slot: 3, ratingMin: 1600, ratingMax: 2200, theme: '', rewardGambits: 30 },
];

export const DAILY_REWARD_MAX_GAMBITS = 1000;
export const PUZZLE_RATING_MIN = 400;
export const PUZZLE_RATING_MAX = 3200;

/** Conjunto de configs válido a partir de uma data (agendamento). */
export interface DailyConfigSet {
  /** YYYY-MM-DD (fuso dos puzzles diários). '0001-01-01' = padrão sem agendamento. */
  effectiveFrom: string;
  slots: DailySlotConfig[];
  /** Mostrar o tema dos puzzles diários aos jogadores (coluna `show_themes`). */
  showThemes: boolean;
  updatedAt: string | null;
}

/** Puzzle fixado para (data, slot), sobrescrevendo o sorteio. */
export interface DailyPin {
  date: string;
  slot: DailySlot;
  puzzleId: string;
}

/** Recompensas das batalhas (Gambitos; tudo 0 / `enabled: false` = sem recompensa). */
export interface BattleRewardConfig {
  enabled: boolean;
  winGambits: number;
  drawGambits: number;
  lossGambits: number;
  /** Teto diário de Gambitos vindos de batalhas por jogador (null = sem teto). */
  dailyCapGambits: number | null;
}
export const DEFAULT_BATTLE_REWARDS: BattleRewardConfig = { enabled: true, winGambits: 10, drawGambits: 4, lossGambits: 0, dailyCapGambits: 100 };

/** GET /api/admin/academy/puzzles/config */
export interface PuzzleAdminConfigResponse {
  /** Conjuntos ordenados por `effectiveFrom` (o atual e os agendados). */
  configSets: DailyConfigSet[];
  /** Conjunto em vigor HOJE (resolvido). */
  activeToday: DailyConfigSet;
  pins: DailyPin[];
  battleRewards: BattleRewardConfig;
  today: string;
  schemaMissing: boolean;
}

/** PUT /api/admin/academy/puzzles/config/daily — cria/atualiza o conjunto de `effectiveFrom`. */
export interface DailyConfigUpsertRequest {
  effectiveFrom: string;
  slots: DailySlotConfig[];
  showThemes: boolean;
}
/** DELETE /api/admin/academy/puzzles/config/daily/:effectiveFrom (só agendamentos futuros). */

/** PUT /api/admin/academy/puzzles/pins — fixa (ou remove com puzzleId '') um puzzle. */
export interface DailyPinUpsertRequest {
  date: string;
  slot: DailySlot;
  puzzleId: string;
}

/** PUT /api/admin/academy/puzzles/config/battles */
export type BattleRewardsUpdateRequest = BattleRewardConfig;

/** GET /api/academy/puzzles/themes (público, cacheado) — temas existentes no banco com contagem. */
export interface PuzzleThemesResponse {
  themes: { theme: string; label: string; count: number }[];
  schemaMissing: boolean;
}

/** GET /api/admin/academy/puzzles/count?theme=&ratingMin=&ratingMax= */
export interface PuzzleCountResponse {
  count: number;
}

/** POST /api/admin/academy/puzzles/preview { ratingMin, ratingMax, theme } — "sortear agora" (não persiste). */
export interface PuzzlePreviewResponse {
  puzzle: (PuzzleSummary & { fen: string; setupMove: string; playerColor: PuzzleColor; solutionLength: number; gameUrl: string | null }) | null;
  count: number;
}

/** GET /api/admin/academy/puzzles/lookup/:puzzleId — valida um id para fixar. */
export type PuzzleLookupResponse = PuzzlePreviewResponse;

/** GET /api/academy/daily/me — resumo do dia (mesmo que `dailyState`, via REST). */
export type DailyMeResponse = DailyStatePayload;

/** GET /api/academy/battles/me */
export interface BattleHistoryResponse {
  battles: PuzzleBattleRecord[];
  schemaMissing: boolean;
}

/** GET /api/admin/academy/puzzles/daily/:date — puzzles sorteados/fixados para a data (preview do admin). */
export interface DailyDrawResponse {
  date: string;
  slots: (PuzzleSummary & { slot: DailySlot; pinned: boolean; rewardGambits: number })[];
  /** true = já sorteado e gravado; false = projeção do que sairia com a config atual. */
  drawn: boolean;
}
