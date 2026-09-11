/**
 * Big Chess Board — tabuleiro gigante do Mundo de Coleta.
 *
 * Peças craftáveis (12 itens embutidos: cor × tipo) são posicionadas na casa
 * INICIAL correspondente do tabuleiro (layer `big_chess_table` do
 * crafting-world.tmj — as casas vivem aqui como constantes porque o servidor
 * não carrega o TMJ; o cliente confere em DEV que o mapa bate).
 *
 * Uma peça posicionada gera renda (Crowns/dia) e pontos (por hora) para o
 * dono, regenera HP em intervalos se não for atacada e só sai do tabuleiro
 * quando destruída por outro jogador (arma principal). Defesas (capa +
 * itens de defesa) vêm de craft items marcados com badges:
 *   `cover`          → capa: reduz o dano (%) por uma duração
 *   `defense-piece`  → item de defesa (2 slots) por uma duração
 *     +`hp-plus`        → aumenta o HP máximo (%) enquanto ativo
 *     +`counter-attack` → ao ser atingida, rajada de contra-ataque em raio
 *
 * As regras numéricas ficam no documento único `BigChessConfig` (/admin/bigchess).
 * Tudo aqui é puro (sem I/O) — as funções de acúmulo são testadas no cliente.
 */
import type { Rect } from '../craft/PlaceableStations.js';
import { CRAFT_ITEM_ID_RE, isInventoryItemId } from '../craft/CraftShapes.js';
import { BADGE_COUNTER_ATTACK, BADGE_COVER, BADGE_DEFENSE_PIECE, BADGE_HP_PLUS } from '../craft/CraftBadges.js';

// ------------------------------------------------------------------- peças

export const BIGCHESS_PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;
export type BigChessPieceType = (typeof BIGCHESS_PIECE_TYPES)[number];
export const BIGCHESS_COLORS = ['white', 'black'] as const;
export type BigChessColor = (typeof BIGCHESS_COLORS)[number];

export const BIGCHESS_TYPE_LABELS: Record<BigChessPieceType, string> = {
  pawn: 'Peão',
  knight: 'Cavalo',
  bishop: 'Bispo',
  rook: 'Torre',
  queen: 'Rainha',
  king: 'Rei',
};

/** Nome PT-BR do item (concordância de gênero por tipo). */
const PIECE_NAMES: Record<BigChessPieceType, Record<BigChessColor, string>> = {
  pawn: { white: 'Peão branco', black: 'Peão preto' },
  knight: { white: 'Cavalo branco', black: 'Cavalo preto' },
  bishop: { white: 'Bispo branco', black: 'Bispo preto' },
  rook: { white: 'Torre branca', black: 'Torre preta' },
  queen: { white: 'Rainha branca', black: 'Rainha preta' },
  king: { white: 'Rei branco', black: 'Rei preto' },
};

export const BIGCHESS_ITEM_PREFIX = 'bigchess-';
const PIECE_IMAGE_DIR = '/assets/CraftingWorld/resources/bischessboard-pieces';

export interface BigChessPieceDef {
  /** Slug do craft item (formato CRAFT_ITEM_ID_RE), ex.: "bigchess-white-pawn". */
  itemId: string;
  color: BigChessColor;
  type: BigChessPieceType;
  name: string;
  /** Caminho público (app do jogo) do PNG da peça — imagem fixa, não editável. */
  imageUrl: string;
}

export function bigChessPieceItemKey(color: BigChessColor, type: BigChessPieceType): string {
  return `${BIGCHESS_ITEM_PREFIX}${color}-${type}`;
}

export const BIGCHESS_PIECES: readonly BigChessPieceDef[] = BIGCHESS_COLORS.flatMap((color) =>
  BIGCHESS_PIECE_TYPES.map((type): BigChessPieceDef => ({
    itemId: bigChessPieceItemKey(color, type),
    color,
    type,
    name: PIECE_NAMES[type][color],
    imageUrl: `${PIECE_IMAGE_DIR}/${color}_${type}.png`,
  })),
);

const PIECE_BY_ITEM = new Map(BIGCHESS_PIECES.map((def) => [def.itemId, def]));

export function bigChessPieceFor(itemKey: unknown): BigChessPieceDef | null {
  return typeof itemKey === 'string' ? (PIECE_BY_ITEM.get(itemKey) ?? null) : null;
}

export function isBigChessPieceItemKey(itemKey: unknown): itemKey is string {
  return typeof itemKey === 'string' && PIECE_BY_ITEM.has(itemKey);
}

// Sanidade: os slugs precisam respeitar o formato dos craft items.
for (const def of BIGCHESS_PIECES) {
  if (!CRAFT_ITEM_ID_RE.test(def.itemId)) throw new Error(`bigchess: itemId inválido ${def.itemId}`);
}

// -------------------------------------------------------------- tabuleiro

/**
 * Grade regular ajustada aos 64 retângulos desenhados no TMJ (jitter < 1 px):
 * coluna `a` à esquerda, fileira 8 em cima (y menor), fileira 1 embaixo.
 */
export const BIGCHESS_BOARD = Object.freeze({
  x: 3035.5,
  y: 2365.6,
  square: 53.85,
});

export const BIGCHESS_FILES = 'abcdefgh';
export const BIGCHESS_RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const BIGCHESS_SQUARE_RE = /^[a-h][1-8]$/;

/** As 64 casas na ordem a1..h8 (coluna dentro de fileira). */
export const BIGCHESS_SQUARES: readonly string[] = BIGCHESS_RANKS.flatMap((rank) =>
  [...BIGCHESS_FILES].map((file) => `${file}${rank}`),
);

export function isBigChessSquare(value: unknown): value is string {
  return typeof value === 'string' && BIGCHESS_SQUARE_RE.test(value);
}

/** Nome de objeto do TMJ ("a_1") → casa canônica ("a1"); null se não for casa. */
export function bigChessSquareFromTmjName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const match = /^([a-h])_([1-8])$/.exec(name.trim());
  return match ? `${match[1]}${match[2]}` : null;
}

export function bigChessSquareRect(square: string): Rect {
  const file = BIGCHESS_FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  const size = BIGCHESS_BOARD.square;
  return { x: BIGCHESS_BOARD.x + file * size, y: BIGCHESS_BOARD.y + (8 - rank) * size, width: size, height: size };
}

export function bigChessSquareCenter(square: string): { x: number; y: number } {
  const rect = bigChessSquareRect(square);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Casa sob o ponto do mundo (null fora do tabuleiro). */
export function bigChessSquareAt(x: number, y: number): string | null {
  const size = BIGCHESS_BOARD.square;
  const file = Math.floor((x - BIGCHESS_BOARD.x) / size);
  const row = Math.floor((y - BIGCHESS_BOARD.y) / size);
  if (file < 0 || file > 7 || row < 0 || row > 7) return null;
  return `${BIGCHESS_FILES[file]}${8 - row}`;
}

const BACK_RANK: readonly BigChessPieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

/** Peça da posição inicial do xadrez naquela casa (brancas nas fileiras 1–2, pretas nas 7–8). */
export function bigChessStartingPieceAt(square: string): { color: BigChessColor; type: BigChessPieceType } | null {
  if (!isBigChessSquare(square)) return null;
  const file = BIGCHESS_FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (rank === 1) return { color: 'white', type: BACK_RANK[file] };
  if (rank === 2) return { color: 'white', type: 'pawn' };
  if (rank === 7) return { color: 'black', type: 'pawn' };
  if (rank === 8) return { color: 'black', type: BACK_RANK[file] };
  return null;
}

/** Casas iniciais válidas para um item de peça (ex.: torre branca → a1, h1). */
export function bigChessSquaresForItem(itemKey: string): string[] {
  const def = bigChessPieceFor(itemKey);
  if (!def) return [];
  return BIGCHESS_SQUARES.filter((square) => {
    const start = bigChessStartingPieceAt(square);
    return !!start && start.color === def.color && start.type === def.type;
  });
}

// ------------------------------------------------------------------ badges

export { BADGE_COVER, BADGE_DEFENSE_PIECE, BADGE_HP_PLUS, BADGE_COUNTER_ATTACK };
export const BIGCHESS_BADGES: readonly string[] = [BADGE_COVER, BADGE_DEFENSE_PIECE, BADGE_HP_PLUS, BADGE_COUNTER_ATTACK];

// ------------------------------------------------------------- constantes

/** Distância máxima (px, do jogador até a borda da casa) para posicionar/coletar/equipar. */
export const BIGCHESS_INTERACT_DISTANCE = 220;
/** Alcance aceito pelo servidor para um golpe corpo a corpo contra a peça (px até a borda da casa). */
export const BIGCHESS_MELEE_RANGE = 150;
/** Alcance aceito para uma flecha (px até a borda da casa). */
export const BIGCHESS_ARROW_RANGE = 900;
/**
 * Um acerto numa peça só vale se veio logo depois de um golpe (`attack`)
 * validado pelo servidor: folga além da duração do golpe para o pedido chegar.
 * A flecha nasce no FIM da animação e voa a ~420 px/s (até 900 px ≈ 2,2 s).
 */
export const BIGCHESS_MELEE_HIT_SLACK_MS = 400;
export const BIGCHESS_ARROW_HIT_SLACK_MS = 3_000;
export const BIGCHESS_COVER_SLOTS = 1;
export const BIGCHESS_DEFENSE_SLOTS = 2;
/** Família de arma cujo dano vale para a flecha (o arco só dispara). */
export const BIGCHESS_ARROW_FAMILY_ID = 'arrow';
export const BIGCHESS_CONFIG_ID = 'default';
/** Intervalo de regeneração: 15 s (teste) ou 1h…24h em passos de 1h. */
export const BIGCHESS_REGEN_INTERVAL_OPTIONS: readonly number[] = [15, ...Array.from({ length: 24 }, (_, i) => (i + 1) * 3600)];
export const BIGCHESS_TEST_REGEN_INTERVAL_SEC = 15;

export const BIGCHESS_HP_RANGE = { min: 1, max: 1_000_000 } as const;
export const BIGCHESS_INCOME_RANGE = { min: 0, max: 1_000_000_000 } as const;
export const BIGCHESS_POINTS_RANGE = { min: 0, max: 1_000_000 } as const;
export const BIGCHESS_PERCENT_RANGE = { min: 0, max: 100 } as const;
export const BIGCHESS_HP_PLUS_RANGE = { min: 0, max: 1000 } as const;
/** Durações de capa/defesa (segundos): 1 s a 30 dias. */
export const BIGCHESS_DURATION_RANGE = { min: 1, max: 30 * 86_400 } as const;
export const BIGCHESS_COUNTER_DAMAGE_RANGE = { min: 0, max: 1_000_000 } as const;
export const BIGCHESS_COUNTER_DURATION_RANGE = { min: 1, max: 600 } as const;
export const BIGCHESS_COUNTER_RADIUS_RANGE = { min: 1, max: 2000 } as const;
export const BIGCHESS_BENEFITS_MAX_LEN = 500;
export const BIGCHESS_NOTES_MAX_LEN = 20_000;
export const BIGCHESS_MAX_CONFIGURED_ITEMS = 200;

// ------------------------------------------------------------------ config

export interface BigChessPieceRules {
  hp: number;
  /** Crowns por 24 h. */
  incomePerDay: number;
  pointsPerHour: number;
  /** % do HP máximo recuperado a cada intervalo sem sofrer ataque. */
  regenPercent: number;
  regenIntervalSec: number;
  /** Texto livre mostrado ao jogador. */
  benefits: string;
}

export interface BigChessCoverRules {
  damageReductionPercent: number;
  durationSec: number;
}

export interface BigChessCounterAttackRules {
  /** Dano por segundo aplicado a cada jogador (não-dono) dentro do raio. */
  damage: number;
  attackDurationSec: number;
  /** Raio em px a partir do centro da casa. */
  radius: number;
}

export interface BigChessDefenseRules {
  durationSec: number;
  /** % de aumento do HP máximo (0 = sem bônus; só faz sentido com badge hp-plus). */
  hpPlusPercent: number;
  /** null = sem contra-ataque (badge counter-attack ausente ou não configurado). */
  counterAttack: BigChessCounterAttackRules | null;
}

export interface BigChessConfig {
  pieces: Record<BigChessPieceType, BigChessPieceRules>;
  /** itemKey (badge `cover`) → regras. */
  covers: Record<string, BigChessCoverRules>;
  /** itemKey (badge `defense-piece`) → regras. */
  defenses: Record<string, BigChessDefenseRules>;
  /** "Regras de Negócio da Big Chessboard" — anotações do admin. */
  notes: string;
}

const DEFAULT_PIECE_NUMBERS: Record<BigChessPieceType, [hp: number, incomePerDay: number, pointsPerHour: number]> = {
  pawn: [100, 10, 1],
  knight: [200, 20, 2],
  bishop: [200, 20, 2],
  rook: [300, 30, 3],
  queen: [500, 50, 5],
  king: [1000, 100, 10],
};

export const DEFAULT_BIGCHESS_CONFIG: BigChessConfig = Object.freeze({
  pieces: Object.fromEntries(
    BIGCHESS_PIECE_TYPES.map((type) => {
      const [hp, incomePerDay, pointsPerHour] = DEFAULT_PIECE_NUMBERS[type];
      return [type, { hp, incomePerDay, pointsPerHour, regenPercent: 10, regenIntervalSec: 3600, benefits: '' }];
    }),
  ) as Record<BigChessPieceType, BigChessPieceRules>,
  covers: {},
  defenses: {},
  notes: '',
}) as BigChessConfig;

export type BigChessConfigParseResult = { ok: true; config: BigChessConfig } | { ok: false; errors: string[] };

function numberIn(value: unknown, range: { min: number; max: number }, label: string, errors: string[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label}: número obrigatório`);
    return range.min;
  }
  if (value < range.min || value > range.max) {
    errors.push(`${label}: fora do intervalo ${range.min}…${range.max}`);
    return Math.min(range.max, Math.max(range.min, value));
  }
  return value;
}

function textUpTo(value: unknown, max: number, label: string, errors: string[]): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    errors.push(`${label}: texto obrigatório`);
    return '';
  }
  if (value.length > max) {
    errors.push(`${label}: no máximo ${max} caracteres`);
    return value.slice(0, max);
  }
  return value;
}

function parseCounterAttack(raw: unknown, label: string, errors: string[]): BigChessCounterAttackRules | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') {
    errors.push(`${label}: contra-ataque inválido`);
    return null;
  }
  const value = raw as Record<string, unknown>;
  return {
    damage: numberIn(value.damage, BIGCHESS_COUNTER_DAMAGE_RANGE, `${label}: dano`, errors),
    attackDurationSec: numberIn(value.attackDurationSec, BIGCHESS_COUNTER_DURATION_RANGE, `${label}: duração do ataque`, errors),
    radius: numberIn(value.radius, BIGCHESS_COUNTER_RADIUS_RANGE, `${label}: raio`, errors),
  };
}

/** Valida/normaliza o documento salvo (estrito nos números; itens desconhecidos são mantidos se válidos). */
export function parseBigChessConfig(raw: unknown): BigChessConfigParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['config deve ser um objeto'] };
  const input = raw as Record<string, unknown>;
  const piecesIn = (input.pieces && typeof input.pieces === 'object' ? input.pieces : {}) as Record<string, unknown>;
  const pieces = {} as Record<BigChessPieceType, BigChessPieceRules>;
  for (const type of BIGCHESS_PIECE_TYPES) {
    const label = BIGCHESS_TYPE_LABELS[type];
    const source = (piecesIn[type] && typeof piecesIn[type] === 'object' ? piecesIn[type] : {}) as Record<string, unknown>;
    const defaults = DEFAULT_BIGCHESS_CONFIG.pieces[type];
    const merged = { ...defaults, ...source };
    const regenIntervalSec = numberIn(merged.regenIntervalSec, { min: 1, max: 86_400 }, `${label}: intervalo de regeneração`, errors);
    if (!BIGCHESS_REGEN_INTERVAL_OPTIONS.includes(regenIntervalSec)) {
      errors.push(`${label}: intervalo de regeneração deve ser 15 s ou 1h…24h em horas cheias`);
    }
    pieces[type] = {
      hp: numberIn(merged.hp, BIGCHESS_HP_RANGE, `${label}: HP`, errors),
      incomePerDay: numberIn(merged.incomePerDay, BIGCHESS_INCOME_RANGE, `${label}: renda diária`, errors),
      pointsPerHour: numberIn(merged.pointsPerHour, BIGCHESS_POINTS_RANGE, `${label}: pontos por hora`, errors),
      regenPercent: numberIn(merged.regenPercent, BIGCHESS_PERCENT_RANGE, `${label}: regeneração (%)`, errors),
      regenIntervalSec,
      benefits: textUpTo(merged.benefits, BIGCHESS_BENEFITS_MAX_LEN, `${label}: benefícios`, errors),
    };
  }

  const covers: Record<string, BigChessCoverRules> = {};
  const coversIn = (input.covers && typeof input.covers === 'object' ? input.covers : {}) as Record<string, unknown>;
  for (const [itemKey, value] of Object.entries(coversIn)) {
    if (!isInventoryItemId(itemKey)) {
      errors.push(`capa "${itemKey}": item inválido`);
      continue;
    }
    if (!value || typeof value !== 'object') {
      errors.push(`capa "${itemKey}": regras inválidas`);
      continue;
    }
    const rules = value as Record<string, unknown>;
    covers[itemKey] = {
      damageReductionPercent: numberIn(rules.damageReductionPercent, BIGCHESS_PERCENT_RANGE, `capa "${itemKey}": redução de dano`, errors),
      durationSec: numberIn(rules.durationSec, BIGCHESS_DURATION_RANGE, `capa "${itemKey}": duração`, errors),
    };
  }

  const defenses: Record<string, BigChessDefenseRules> = {};
  const defensesIn = (input.defenses && typeof input.defenses === 'object' ? input.defenses : {}) as Record<string, unknown>;
  for (const [itemKey, value] of Object.entries(defensesIn)) {
    if (!isInventoryItemId(itemKey)) {
      errors.push(`defesa "${itemKey}": item inválido`);
      continue;
    }
    if (!value || typeof value !== 'object') {
      errors.push(`defesa "${itemKey}": regras inválidas`);
      continue;
    }
    const rules = value as Record<string, unknown>;
    defenses[itemKey] = {
      durationSec: numberIn(rules.durationSec, BIGCHESS_DURATION_RANGE, `defesa "${itemKey}": duração`, errors),
      hpPlusPercent: numberIn(rules.hpPlusPercent ?? 0, BIGCHESS_HP_PLUS_RANGE, `defesa "${itemKey}": HP extra`, errors),
      counterAttack: parseCounterAttack(rules.counterAttack, `defesa "${itemKey}"`, errors),
    };
  }
  if (Object.keys(covers).length + Object.keys(defenses).length > BIGCHESS_MAX_CONFIGURED_ITEMS) {
    errors.push(`no máximo ${BIGCHESS_MAX_CONFIGURED_ITEMS} itens de capa/defesa configurados`);
  }

  const notes = textUpTo(input.notes, BIGCHESS_NOTES_MAX_LEN, 'regras de negócio', errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { pieces, covers, defenses, notes } };
}

/**
 * Config EFETIVA do servidor: cada efeito só vale para itens que carregam a
 * badge correspondente (capa → `cover`; defesa → `defense-piece`; bônus de
 * HP → `hp-plus`; contra-ataque → `counter-attack`). Uma config salva com o
 * item errado (badge removida depois, JSON editado à mão) não vira vantagem.
 */
export function gateBigChessConfigByBadges(
  config: BigChessConfig,
  hasBadge: (itemKey: string, badge: string) => boolean,
): BigChessConfig {
  const covers: Record<string, BigChessCoverRules> = {};
  for (const [itemKey, rules] of Object.entries(config.covers)) {
    if (hasBadge(itemKey, BADGE_COVER)) covers[itemKey] = rules;
  }
  const defenses: Record<string, BigChessDefenseRules> = {};
  for (const [itemKey, rules] of Object.entries(config.defenses)) {
    if (!hasBadge(itemKey, BADGE_DEFENSE_PIECE)) continue;
    defenses[itemKey] = {
      durationSec: rules.durationSec,
      hpPlusPercent: hasBadge(itemKey, BADGE_HP_PLUS) ? rules.hpPlusPercent : 0,
      counterAttack: hasBadge(itemKey, BADGE_COUNTER_ATTACK) ? rules.counterAttack : null,
    };
  }
  return { pieces: config.pieces, covers, defenses, notes: config.notes };
}

// ---------------------------------------------------------- peça no mundo

export interface BigChessDefenseSlot {
  itemKey: string;
  /** Epoch ms (relógio do servidor). */
  expiresAt: number;
}

/**
 * Registro de uma peça posicionada (o que o servidor persiste). Renda, pontos
 * e regeneração acumulam por ÂNCORAS de tempo: `advanceBigChessPiece` traz o
 * registro até `now` — funciona igual no tick da sala e no catch-up ao carregar
 * do banco depois de horas sem sala.
 */
export interface BigChessPieceRecord {
  region: string;
  square: string;
  itemKey: string;
  ownerId: string;
  ownerName: string;
  /** HP atual (pode passar do HP base enquanto um hp-plus estiver ativo). */
  hp: number;
  placedAt: number;
  /** Último dano sofrido ou último tick de regeneração aplicado. */
  regenAnchor: number;
  incomeAnchor: number;
  pointsAnchor: number;
  /** Crowns acumulados e ainda não coletados (fração guardada). */
  incomeAccrued: number;
  /** Total de Crowns já coletados desta peça. */
  incomeCollected: number;
  points: number;
  cover: BigChessDefenseSlot | null;
  defenses: BigChessDefenseSlot[];
  /** Rajada de contra-ataque ativa até este instante (0 = inativa). */
  counterUntil: number;
  counterItemKey: string | null;
}

export function bigChessRulesFor(config: BigChessConfig, itemKey: string): BigChessPieceRules | null {
  const def = bigChessPieceFor(itemKey);
  return def ? config.pieces[def.type] : null;
}

/** Cópia profunda do registro (snapshot para desfazer uma mutação que não persistiu). */
export function cloneBigChessPieceRecord(record: BigChessPieceRecord): BigChessPieceRecord {
  return {
    ...record,
    cover: record.cover ? { ...record.cover } : null,
    defenses: record.defenses.map((slot) => ({ ...slot })),
  };
}

/** Restaura `target` (mesmo objeto, mesma referência) para o conteúdo de `snapshot`. */
export function restoreBigChessPieceRecord(target: BigChessPieceRecord, snapshot: BigChessPieceRecord): void {
  Object.assign(target, cloneBigChessPieceRecord(snapshot));
}

/** HP máximo efetivo = HP base × (1 + Σ hp-plus ativos). */
export function bigChessMaxHp(record: Pick<BigChessPieceRecord, 'itemKey' | 'defenses'>, config: BigChessConfig, now: number): number {
  const rules = bigChessRulesFor(config, record.itemKey);
  if (!rules) return 1;
  let bonusPercent = 0;
  for (const slot of record.defenses) {
    if (slot.expiresAt <= now) continue;
    bonusPercent += config.defenses[slot.itemKey]?.hpPlusPercent ?? 0;
  }
  return Math.max(1, Math.round(rules.hp * (1 + bonusPercent / 100)));
}

/** Instante do próximo tick de regeneração (0 = HP cheio ou regeneração desligada). */
export function bigChessNextRegenAt(record: BigChessPieceRecord, config: BigChessConfig, now: number): number {
  const rules = bigChessRulesFor(config, record.itemKey);
  if (!rules || rules.regenPercent <= 0) return 0;
  if (record.hp >= bigChessMaxHp(record, config, now)) return 0;
  return record.regenAnchor + rules.regenIntervalSec * 1000;
}

export interface BigChessAdvanceResult {
  /** Algum campo mudou (renda/pontos/HP/defesas). */
  changed: boolean;
  /** Defesas/capa que venceram neste avanço. */
  expired: string[];
}

/** Traz o registro até `now`: vencimentos, renda, pontos e regeneração. Muta e devolve o que mudou. */
export function advanceBigChessPiece(record: BigChessPieceRecord, config: BigChessConfig, now: number): BigChessAdvanceResult {
  const rules = bigChessRulesFor(config, record.itemKey);
  const result: BigChessAdvanceResult = { changed: false, expired: [] };
  if (!rules) return result;

  // 1) Capa/defesas vencidas somem; sem o hp-plus o HP não passa do novo máximo.
  if (record.cover && record.cover.expiresAt <= now) {
    result.expired.push(record.cover.itemKey);
    record.cover = null;
    result.changed = true;
  }
  if (record.defenses.some((slot) => slot.expiresAt <= now)) {
    for (const slot of record.defenses) if (slot.expiresAt <= now) result.expired.push(slot.itemKey);
    record.defenses = record.defenses.filter((slot) => slot.expiresAt > now);
    result.changed = true;
  }
  const maxHp = bigChessMaxHp(record, config, now);
  if (record.hp > maxHp) {
    record.hp = maxHp;
    result.changed = true;
  }
  if (record.counterUntil > 0 && record.counterUntil <= now) {
    record.counterUntil = 0;
    record.counterItemKey = null;
    result.changed = true;
  }

  // 2) Renda e pontos contínuos.
  if (now > record.incomeAnchor) {
    if (rules.incomePerDay > 0) {
      record.incomeAccrued += (rules.incomePerDay * (now - record.incomeAnchor)) / 86_400_000;
      result.changed = true;
    }
    record.incomeAnchor = now;
  }
  if (now > record.pointsAnchor) {
    if (rules.pointsPerHour > 0) {
      record.points += (rules.pointsPerHour * (now - record.pointsAnchor)) / 3_600_000;
      result.changed = true;
    }
    record.pointsAnchor = now;
  }

  // 3) Regeneração em intervalos inteiros sem dano (a âncora reseta ao sofrer dano).
  if (record.hp >= maxHp) {
    if (record.regenAnchor !== now) record.regenAnchor = now;
  } else if (rules.regenPercent > 0) {
    const intervalMs = rules.regenIntervalSec * 1000;
    const ticks = Math.floor((now - record.regenAnchor) / intervalMs);
    if (ticks > 0) {
      const perTick = (maxHp * rules.regenPercent) / 100;
      record.hp = Math.min(maxHp, record.hp + ticks * perTick);
      record.regenAnchor += ticks * intervalMs;
      if (record.hp >= maxHp) record.regenAnchor = now;
      result.changed = true;
    }
  }
  return result;
}

export interface BigChessDamageResult {
  /** Dano efetivo depois da capa. */
  damage: number;
  destroyed: boolean;
  /** Um contra-ataque começou neste golpe (item e regras). */
  counter: { itemKey: string; rules: BigChessCounterAttackRules } | null;
}

/** Aplica um golpe: capa reduz, HP cai, regeneração reseta, contra-ataque pode disparar. */
export function applyBigChessDamage(record: BigChessPieceRecord, config: BigChessConfig, rawDamage: number, now: number): BigChessDamageResult {
  const reduction = record.cover && record.cover.expiresAt > now ? (config.covers[record.cover.itemKey]?.damageReductionPercent ?? 0) : 0;
  const damage = Math.max(0, rawDamage * (1 - Math.min(100, Math.max(0, reduction)) / 100));
  record.hp = Math.max(0, record.hp - damage);
  record.regenAnchor = now;
  let counter: BigChessDamageResult['counter'] = null;
  if (record.hp > 0 && record.counterUntil <= now) {
    for (const slot of record.defenses) {
      if (slot.expiresAt <= now) continue;
      const rules = config.defenses[slot.itemKey]?.counterAttack;
      if (!rules || rules.damage <= 0) continue;
      record.counterUntil = now + rules.attackDurationSec * 1000;
      record.counterItemKey = slot.itemKey;
      counter = { itemKey: slot.itemKey, rules };
      break;
    }
  }
  return { damage, destroyed: record.hp <= 0, counter };
}

export type BigChessEquipResult = { ok: true; slot: 'cover' | 'defense'; expiresAt: number; hpBonus: number } | { ok: false; message: string };

/**
 * Equipa capa (badge cover) ou item de defesa (badge defense-piece). O mesmo
 * item repetido SOMA duração; item diferente com slot cheio é recusado. Um
 * hp-plus novo soma o bônus ao HP atual (o máximo cresce junto).
 */
export function equipBigChessItem(
  record: BigChessPieceRecord,
  config: BigChessConfig,
  itemKey: string,
  kind: 'cover' | 'defense',
  now: number,
): BigChessEquipResult {
  if (kind === 'cover') {
    const rules = config.covers[itemKey];
    if (!rules) return { ok: false, message: 'Esta capa ainda não foi configurada no admin do Big Chessboard.' };
    const durationMs = rules.durationSec * 1000;
    const current = record.cover && record.cover.expiresAt > now ? record.cover : null;
    if (current && current.itemKey !== itemKey) return { ok: false, message: 'A peça já usa outra capa — espere vencer para trocar.' };
    const expiresAt = (current ? current.expiresAt : now) + durationMs;
    record.cover = { itemKey, expiresAt };
    return { ok: true, slot: 'cover', expiresAt, hpBonus: 0 };
  }
  const rules = config.defenses[itemKey];
  if (!rules) return { ok: false, message: 'Este item de defesa ainda não foi configurado no admin do Big Chessboard.' };
  const durationMs = rules.durationSec * 1000;
  const active = record.defenses.filter((slot) => slot.expiresAt > now);
  const same = active.find((slot) => slot.itemKey === itemKey);
  if (same) {
    same.expiresAt += durationMs;
    record.defenses = active;
    return { ok: true, slot: 'defense', expiresAt: same.expiresAt, hpBonus: 0 };
  }
  if (active.length >= BIGCHESS_DEFENSE_SLOTS) return { ok: false, message: 'Os dois slots de defesa estão ocupados.' };
  const before = bigChessMaxHp(record, config, now);
  const expiresAt = now + durationMs;
  record.defenses = [...active, { itemKey, expiresAt }];
  const hpBonus = Math.max(0, bigChessMaxHp(record, config, now) - before);
  record.hp += hpBonus;
  return { ok: true, slot: 'defense', expiresAt, hpBonus };
}

/** Crowns inteiros coletáveis agora (a fração continua acumulando na peça). */
export function bigChessCollectableCrowns(record: Pick<BigChessPieceRecord, 'incomeAccrued'>): number {
  return Math.max(0, Math.floor(record.incomeAccrued));
}

/** Registro novo de uma peça recém-posicionada com HP cheio. */
export function newBigChessPieceRecord(
  input: { region: string; square: string; itemKey: string; ownerId: string; ownerName: string },
  config: BigChessConfig,
  now: number,
): BigChessPieceRecord {
  const rules = bigChessRulesFor(config, input.itemKey);
  return {
    ...input,
    hp: rules?.hp ?? 1,
    placedAt: now,
    regenAnchor: now,
    incomeAnchor: now,
    pointsAnchor: now,
    incomeAccrued: 0,
    incomeCollected: 0,
    points: 0,
    cover: null,
    defenses: [],
    counterUntil: 0,
    counterItemKey: null,
  };
}

// ------------------------------------------------------- visão do cliente

/** O que a sala publica de cada peça (schema `bigChessPieces`, chave = casa). */
export interface BigChessPieceView {
  square: string;
  itemKey: string;
  ownerId: string;
  ownerName: string;
  hp: number;
  maxHp: number;
  placedAt: number;
  /** Próximo tick de regeneração (0 = cheio/desligado). */
  nextRegenAt: number;
  incomeAccrued: number;
  incomeCollected: number;
  incomePerDay: number;
  points: number;
  pointsPerHour: number;
  cover: BigChessDefenseSlot | null;
  defenses: BigChessDefenseSlot[];
  counterUntil: number;
  /** Instante (servidor) em que a visão foi calculada — o cliente extrapola renda/pontos a partir dele. */
  syncedAt: number;
}

export function bigChessPieceView(record: BigChessPieceRecord, config: BigChessConfig, now: number): BigChessPieceView {
  const rules = bigChessRulesFor(config, record.itemKey);
  return {
    square: record.square,
    itemKey: record.itemKey,
    ownerId: record.ownerId,
    ownerName: record.ownerName,
    hp: record.hp,
    maxHp: bigChessMaxHp(record, config, now),
    placedAt: record.placedAt,
    nextRegenAt: bigChessNextRegenAt(record, config, now),
    incomeAccrued: record.incomeAccrued,
    incomeCollected: record.incomeCollected,
    incomePerDay: rules?.incomePerDay ?? 0,
    points: record.points,
    pointsPerHour: rules?.pointsPerHour ?? 0,
    cover: record.cover && record.cover.expiresAt > now ? { ...record.cover } : null,
    defenses: record.defenses.filter((slot) => slot.expiresAt > now).map((slot) => ({ ...slot })),
    counterUntil: record.counterUntil > now ? record.counterUntil : 0,
    syncedAt: now,
  };
}

/** Serialização das defesas no schema (string JSON) e leitura tolerante no cliente. */
export function serializeBigChessSlots(slots: readonly BigChessDefenseSlot[]): string {
  return slots.length === 0 ? '' : JSON.stringify(slots.map((slot) => [slot.itemKey, slot.expiresAt]));
}

export function parseBigChessSlots(raw: unknown): BigChessDefenseSlot[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const slots: BigChessDefenseSlot[] = [];
    for (const entry of parsed) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'number') continue;
      slots.push({ itemKey: entry[0], expiresAt: entry[1] });
    }
    return slots;
  } catch {
    return [];
  }
}

/** Formata segundos restantes como "2d 03h", "1h 05m", "4m 09s" ou "12s". */
export function formatBigChessDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(rest)}s`;
  return `${rest}s`;
}
