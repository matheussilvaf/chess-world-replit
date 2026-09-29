/**
 * Tactics Academy — contratos compartilhados entre cliente e servidor
 * (mapa interno `tactics-academy.tmj`: Sala dos Bots, Sala de Puzzles, Sala de Lições).
 *
 * Fase 1 (esta versão): mapa + Sala dos Bots (4 bots de Stockfish).
 * Regras da spec: nomes de pessoa, nível SEMPRE visual (barras), nunca rating
 * numérico; força só via UCI_LimitStrength + UCI_Elo (nunca profundidade/tempo);
 * Iniciante sorteia entre os 3 melhores lances (UCI_Elo < 1320 não é calibrado);
 * partidas contra bot não alteram Glicko nem geram Gambitos; PGN vai para o
 * histórico do jogador (tabela `bot_games`).
 */

// ---------------------------------------------------------------------------
// Mapa / sala
// ---------------------------------------------------------------------------

/** Chave do tilemap (basename do TMJ, como `switchMap` deriva). */
export const ACADEMY_MAP_KEY = 'tactics-academy';
export const ACADEMY_MAP_PATH = '/assets/world-v2/tactics-academy.tmj';
/** `targetMap` do objeto `enter_building` no mundo principal. */
export const ACADEMY_TARGET_MAP = 'tactics_academy_interior';
/** Nome do pin de spawn dentro da academia (o `spawnId` do TMJ veio copiado da recepção). */
export const ACADEMY_ENTRY_SPAWN = 'tactics_academy_entry_spawn';
/** Spawn no mundo principal ao sair da academia. */
export const ACADEMY_EXIT_SPAWN = 'tactics_academy_exit';
/** Nome da sala Colyseus (mesma classe WorldRoom, filtrada por região). */
export const ACADEMY_ROOM_NAME = 'academy';

export function isAcademyMapKey(mapKey: string): boolean {
  return mapKey === ACADEMY_MAP_KEY;
}

// ---------------------------------------------------------------------------
// Mesas (tableId derivado do NOME DA PASTA do Tiled)
// ---------------------------------------------------------------------------
// O TMJ veio com as props `tableId` duplicadas em todas as mesas (copiar/colar):
// o cliente reescreve o tableId de cada objeto da pasta a partir do nome dela.
//   Bot_1..4 → academy_bot_1..4 | challenge_1..4 → academy_challenge_1..4
//   puzzle_day → academy_puzzle_day | lesson_1..5 → academy_lesson_1..5

export type AcademyTableKind = 'bot' | 'puzzle_day' | 'puzzle_battle' | 'lesson';

export const ACADEMY_TABLE_PREFIX = 'academy_';

export function academyTableIdFromFolder(folderName: string): string | null {
  const f = folderName.trim().toLowerCase();
  let m = /^bot_?(\d+)$/.exec(f);
  if (m) return `${ACADEMY_TABLE_PREFIX}bot_${Number(m[1])}`;
  m = /^challenge_?(\d+)$/.exec(f);
  if (m) return `${ACADEMY_TABLE_PREFIX}challenge_${Number(m[1])}`;
  if (f === 'puzzle_day' || f === 'puzzleday' || f === 'daily_puzzle') return `${ACADEMY_TABLE_PREFIX}puzzle_day`;
  m = /^lesson_?(\d+)$/.exec(f);
  if (m) return `${ACADEMY_TABLE_PREFIX}lesson_${Number(m[1])}`;
  return null;
}

export function academyTableKind(tableId: string): AcademyTableKind | null {
  if (!tableId.startsWith(ACADEMY_TABLE_PREFIX)) return null;
  const rest = tableId.slice(ACADEMY_TABLE_PREFIX.length);
  if (/^bot_\d+$/.test(rest)) return 'bot';
  if (/^challenge_\d+$/.test(rest)) return 'puzzle_battle';
  if (rest === 'puzzle_day') return 'puzzle_day';
  if (/^lesson_\d+$/.test(rest)) return 'lesson';
  return null;
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

export type BotLevel = 1 | 2 | 3 | 4;
export const BOT_LEVELS: readonly BotLevel[] = [1, 2, 3, 4] as const;

export const BOT_LEVEL_LABELS: Record<BotLevel, string> = {
  1: 'Iniciante',
  2: 'Fácil',
  3: 'Intermediário',
  4: 'Avançado',
};

/** Cor das barrinhas de nível (1 barra verde … 4 barras vermelhas). */
export const BOT_LEVEL_COLORS: Record<BotLevel, string> = {
  1: '#4ade80',
  2: '#facc15',
  3: '#fb923c',
  4: '#f87171',
};

export interface BotEngineParams {
  /** `setoption name UCI_Elo` (com `UCI_LimitStrength true`). */
  uciElo: number;
  /** MultiPV: 3 = sorteia entre os 3 melhores lances (Iniciante); 1 = melhor lance. */
  multiPv: 1 | 3;
  /** `go movetime` em ms — igual para todos (nunca enfraquecer por tempo/profundidade). */
  movetimeMs: number;
}

export const BOT_ENGINE_PARAMS: Record<BotLevel, BotEngineParams> = {
  1: { uciElo: 1320, multiPv: 3, movetimeMs: 800 },
  2: { uciElo: 1500, multiPv: 1, movetimeMs: 800 },
  3: { uciElo: 1900, multiPv: 1, movetimeMs: 800 },
  4: { uciElo: 2400, multiPv: 1, movetimeMs: 800 },
};

export const ACADEMY_BOT_IDS = ['bot_1', 'bot_2', 'bot_3', 'bot_4'] as const;
export type AcademyBotId = (typeof ACADEMY_BOT_IDS)[number];

export function isAcademyBotId(v: unknown): v is AcademyBotId {
  return typeof v === 'string' && (ACADEMY_BOT_IDS as readonly string[]).includes(v);
}

export function isBotLevel(v: unknown): v is BotLevel {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

export interface AcademyBot {
  id: AcademyBotId;
  /** Nome de pessoa exibido no tabuleiro (editável no /admin). */
  name: string;
  /** Nível 1–4 (editável no /admin). */
  level: BotLevel;
}

export const BOT_NAME_MAX_LEN = 20;

export const DEFAULT_ACADEMY_BOTS: AcademyBot[] = [
  { id: 'bot_1', name: 'Leo', level: 1 },
  { id: 'bot_2', name: 'Victor', level: 2 },
  { id: 'bot_3', name: 'Catarina', level: 3 },
  { id: 'bot_4', name: 'Marta', level: 4 },
];

/** Mesa da Sala dos Bots → bot que senta nela. */
export const ACADEMY_BOT_TABLES: Record<string, AcademyBotId> = {
  academy_bot_1: 'bot_1',
  academy_bot_2: 'bot_2',
  academy_bot_3: 'bot_3',
  academy_bot_4: 'bot_4',
};

export function botIdForTable(tableId: string): AcademyBotId | null {
  return ACADEMY_BOT_TABLES[tableId] ?? null;
}

/** Id de "jogador" usado pelo bot dentro do MatchState/BoardState (`bot:bot_1`). */
export const BOT_PLAYER_ID_PREFIX = 'bot:';

export function botPlayerId(botId: AcademyBotId): string {
  return `${BOT_PLAYER_ID_PREFIX}${botId}`;
}

export function isBotPlayerId(playerId: string | null | undefined): boolean {
  return typeof playerId === 'string' && playerId.startsWith(BOT_PLAYER_ID_PREFIX);
}

export function botIdFromPlayerId(playerId: string | null | undefined): AcademyBotId | null {
  if (!isBotPlayerId(playerId)) return null;
  const id = (playerId as string).slice(BOT_PLAYER_ID_PREFIX.length);
  return isAcademyBotId(id) ? id : null;
}

/** Mescla a config persistida com os padrões (sempre 4 bots, na ordem). */
export function mergeAcademyBots(saved: Partial<AcademyBot>[] | null | undefined): AcademyBot[] {
  return DEFAULT_ACADEMY_BOTS.map((def) => {
    const row = saved?.find((s) => s.id === def.id);
    const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim().slice(0, BOT_NAME_MAX_LEN) : def.name;
    const level = isBotLevel(row?.level) ? row.level : def.level;
    return { id: def.id, name, level };
  });
}

// ---------------------------------------------------------------------------
// Mensagens Colyseus (sala `academy`)
// ---------------------------------------------------------------------------

export const ACADEMY_MSG = {
  /** cliente → servidor: sentar numa mesa de bot e começar a partida na hora. */
  createBotChallenge: 'create_bot_challenge',
  /** cliente (humano da partida) → servidor: lance calculado pelo engine para o bot. */
  botMove: 'bot_move',
  /** servidor → cliente: erro/recusa de uma ação da academia. */
  error: 'academy_error',
} as const;

export interface CreateBotChallengePayload {
  boardId: string;
  timeCategory: string;
  baseMinutes: number;
  incrementSeconds: number;
  timeLabel: string;
  /** Cor do HUMANO. */
  side: 'w' | 'b' | 'random';
}

export interface BotMovePayload {
  matchId: string;
  from: string;
  to: string;
  promotion?: string;
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/** GET /api/academy/bots (público, cacheado) */
export interface AcademyBotsResponse {
  bots: AcademyBot[];
  /** true quando a tabela `academy_bots` ainda não existe (usando padrões). */
  schemaMissing: boolean;
}

/** PUT /api/admin/academy/bots (admin) */
export interface AcademyBotsUpdateRequest {
  bots: { id: AcademyBotId; name: string; level: BotLevel }[];
}

/** Linha de `bot_games` (histórico do jogador). */
export interface BotGameRecord {
  id: string;
  userId: string;
  botId: AcademyBotId;
  botName: string;
  botLevel: BotLevel;
  /** Cor do humano. */
  playerColor: 'w' | 'b';
  /** '1-0' | '0-1' | '1/2-1/2' | '*' (abortada) */
  result: string;
  /** Do ponto de vista do humano. */
  outcome: 'win' | 'loss' | 'draw' | 'aborted';
  reason: string;
  timeMinutes: number;
  incrementSeconds: number;
  timeLabel: string;
  movesCount: number;
  pgn: string;
  finalFen: string;
  startedAt: string;
  finishedAt: string;
}
