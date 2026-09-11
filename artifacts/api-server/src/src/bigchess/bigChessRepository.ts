/**
 * Persistência do Big Chess Board (Supabase, service-role; RLS sem policies):
 *
 *   bigchess_pieces  — uma linha por casa ocupada (PK region+square); as
 *                      âncoras de tempo permitem recomputar renda/pontos/regen
 *                      ao recarregar (ver advanceBigChessPiece).
 *   player_wallets   — Crowns por jogador; o crédito é a função SQL atômica
 *                      chessworld_add_crowns (várias salas/processos escrevem
 *                      na mesma carteira — nada de ler-somar-gravar).
 *   bigchess_config  — documento único de regras (mesmo padrão de
 *                      energy_skills_config), cacheado 30 s.
 *
 * Escritas de peça são condicionais: posicionar é INSERT (a PK recusa a casa
 * ocupada por outra sala/processo) e o resto é UPDATE filtrado por dono — uma
 * sala com estado velho não ressuscita nem sobrescreve peça destruída.
 */
import {
  BIGCHESS_CONFIG_ID,
  DEFAULT_BIGCHESS_CONFIG,
  gateBigChessConfigByBadges,
  parseBigChessConfig,
  type BigChessConfig,
  type BigChessDefenseSlot,
  type BigChessPieceRecord,
} from '../shared/bigchess/BigChessShapes.js';
import { itemHasBadge } from '../shared/craft/CraftBadges.js';
import { getCraftBadgesCached } from '../craft/craftBadgeRepository.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

/** Mensagem única para "rode o SQL do Controlador do Big Chessboard". */
export const BIGCHESS_SCHEMA_MISSING = 'Tabuleiro sem persistência — o admin precisa rodar o SQL do Controlador do Big Chessboard';

/** PGRST202 = função fora do schema cache do PostgREST; 42883 = função inexistente no Postgres. */
function isFunctionMissing(code: string | undefined): boolean {
  return code === 'PGRST202' || code === '42883';
}

export const BIGCHESS_PIECES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS bigchess_pieces (
  region text NOT NULL,
  square text NOT NULL,
  item_key text NOT NULL,
  owner_id text NOT NULL,
  owner_name text NOT NULL DEFAULT '',
  hp double precision NOT NULL,
  placed_at bigint NOT NULL,
  regen_anchor bigint NOT NULL,
  income_anchor bigint NOT NULL,
  points_anchor bigint NOT NULL,
  income_accrued double precision NOT NULL DEFAULT 0,
  income_collected double precision NOT NULL DEFAULT 0,
  points double precision NOT NULL DEFAULT 0,
  cover jsonb,
  defenses jsonb NOT NULL DEFAULT '[]'::jsonb,
  counter_until bigint NOT NULL DEFAULT 0,
  counter_item_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, square)
);
CREATE INDEX IF NOT EXISTS bigchess_pieces_owner_idx ON bigchess_pieces (owner_id);
ALTER TABLE bigchess_pieces ENABLE ROW LEVEL SECURITY;`;

export const PLAYER_WALLETS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS player_wallets (
  user_id text PRIMARY KEY,
  crowns bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_wallets ENABLE ROW LEVEL SECURITY;

-- Crédito atômico (UPSERT + soma no banco). Só o service_role pode chamar:
-- exposta a anon/authenticated, qualquer um cunharia Crowns pela API REST.
CREATE OR REPLACE FUNCTION chessworld_add_crowns(p_user_id text, p_delta bigint)
RETURNS bigint
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO player_wallets (user_id, crowns, updated_at)
  VALUES (p_user_id, GREATEST(p_delta, 0), now())
  ON CONFLICT (user_id) DO UPDATE
    SET crowns = player_wallets.crowns + GREATEST(EXCLUDED.crowns, 0),
        updated_at = now()
  RETURNING crowns;
$$;
REVOKE ALL ON FUNCTION chessworld_add_crowns(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chessworld_add_crowns(text, bigint) TO service_role;`;

export const BIGCHESS_CONFIG_TABLE_SQL = `CREATE TABLE IF NOT EXISTS bigchess_config (
  config_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bigchess_config ENABLE ROW LEVEL SECURITY;`;

export const BIGCHESS_TABLES_SQL = `${BIGCHESS_CONFIG_TABLE_SQL}\n\n${BIGCHESS_PIECES_TABLE_SQL}\n\n${PLAYER_WALLETS_TABLE_SQL}`;

const CACHE_TTL_MS = 30_000;

// ------------------------------------------------------------------ config

export interface BigChessConfigReadResult {
  config: BigChessConfig | null;
  updatedAt: string | null;
  tableMissing: boolean;
  error: string | null;
}

export interface BigChessWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

export async function getBigChessConfig(): Promise<BigChessConfigReadResult> {
  const client = getServiceClient();
  if (!client) return { config: null, updatedAt: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client
    .from('bigchess_config')
    .select('config_id, config, updated_at')
    .eq('config_id', BIGCHESS_CONFIG_ID)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { config: null, updatedAt: null, tableMissing: true, error: null };
    return { config: null, updatedAt: null, tableMissing: false, error: error.message };
  }
  if (!data) return { config: null, updatedAt: null, tableMissing: false, error: null };
  const parsed = parseBigChessConfig(data.config);
  if (!parsed.ok) {
    console.warn('[bigchess] config armazenada inválida; usando defaults:', parsed.errors[0]);
    return { config: null, updatedAt: null, tableMissing: false, error: null };
  }
  return { config: parsed.config, updatedAt: (data as { updated_at?: string }).updated_at ?? null, tableMissing: false, error: null };
}

export async function saveBigChessConfig(config: BigChessConfig): Promise<BigChessWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { config_id: BIGCHESS_CONFIG_ID, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('bigchess_config').upsert(row, { onConflict: 'config_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateBigChessConfigCache();
  return { ok: true, tableMissing: false, error: null };
}

let configCache: { config: BigChessConfig; expiresAt: number } | null = null;

export function invalidateBigChessConfigCache(): void {
  configCache = null;
}

/**
 * Config EFETIVA (salva ou defaults) com os efeitos filtrados pelas badges
 * atuais dos itens (ver gateBigChessConfigByBadges), cacheada 30 s. Nunca falha.
 */
export async function getBigChessConfigCached(): Promise<BigChessConfig> {
  if (configCache && Date.now() < configCache.expiresAt) return configCache.config;
  let config: BigChessConfig = DEFAULT_BIGCHESS_CONFIG;
  try {
    const result = await getBigChessConfig();
    if (result.config) config = result.config;
    const badges = await getCraftBadgesCached();
    config = gateBigChessConfigByBadges(config, (itemKey, badge) => itemHasBadge(badges, itemKey, badge));
  } catch (error) {
    console.warn(`[bigchess] config indisponível: ${error instanceof Error ? error.message : String(error)}`);
  }
  configCache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

// ------------------------------------------------------------------- peças

interface PieceRow {
  region: string;
  square: string;
  item_key: string;
  owner_id: string;
  owner_name: string | null;
  hp: number;
  placed_at: number | string;
  regen_anchor: number | string;
  income_anchor: number | string;
  points_anchor: number | string;
  income_accrued: number | null;
  income_collected: number | null;
  points: number | null;
  cover: unknown;
  defenses: unknown;
  counter_until: number | string | null;
  counter_item_key: string | null;
}

function slotFrom(raw: unknown): BigChessDefenseSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.itemKey !== 'string' || typeof value.expiresAt !== 'number') return null;
  return { itemKey: value.itemKey, expiresAt: value.expiresAt };
}

function rowToRecord(row: PieceRow): BigChessPieceRecord {
  const defenses = Array.isArray(row.defenses) ? row.defenses.map(slotFrom).filter((slot): slot is BigChessDefenseSlot => slot !== null) : [];
  return {
    region: row.region,
    square: row.square,
    itemKey: row.item_key,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? '',
    hp: Number(row.hp) || 0,
    placedAt: Number(row.placed_at) || 0,
    regenAnchor: Number(row.regen_anchor) || 0,
    incomeAnchor: Number(row.income_anchor) || 0,
    pointsAnchor: Number(row.points_anchor) || 0,
    incomeAccrued: Number(row.income_accrued) || 0,
    incomeCollected: Number(row.income_collected) || 0,
    points: Number(row.points) || 0,
    cover: slotFrom(row.cover),
    defenses,
    counterUntil: Number(row.counter_until) || 0,
    counterItemKey: row.counter_item_key ?? null,
  };
}

function recordToRow(record: BigChessPieceRecord) {
  return {
    region: record.region,
    square: record.square,
    item_key: record.itemKey,
    owner_id: record.ownerId,
    owner_name: record.ownerName,
    hp: record.hp,
    placed_at: Math.round(record.placedAt),
    regen_anchor: Math.round(record.regenAnchor),
    income_anchor: Math.round(record.incomeAnchor),
    points_anchor: Math.round(record.pointsAnchor),
    income_accrued: record.incomeAccrued,
    income_collected: record.incomeCollected,
    points: record.points,
    cover: record.cover,
    defenses: record.defenses,
    counter_until: Math.round(record.counterUntil),
    counter_item_key: record.counterItemKey,
    updated_at: new Date().toISOString(),
  };
}

export interface BigChessPiecesReadResult {
  pieces: BigChessPieceRecord[];
  tableMissing: boolean;
  error: string | null;
}

export async function loadBigChessPieces(region: string): Promise<BigChessPiecesReadResult> {
  const client = getServiceClient();
  if (!client) return { pieces: [], tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client.from('bigchess_pieces').select('*').eq('region', region);
  if (error) {
    if (isTableMissing(error.code)) return { pieces: [], tableMissing: true, error: null };
    return { pieces: [], tableMissing: false, error: error.message };
  }
  return { pieces: ((data ?? []) as PieceRow[]).map(rowToRecord), tableMissing: false, error: null };
}

export interface BigChessInsertResult extends BigChessWriteResult {
  /** A casa já tinha linha no banco (outra sala/processo chegou antes). */
  conflict: boolean;
}

/** Posicionar: INSERT puro — a PK (region, square) é a trava distribuída da casa. */
export async function insertBigChessPiece(record: BigChessPieceRecord): Promise<BigChessInsertResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, conflict: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('bigchess_pieces').insert(recordToRow(record));
  if (error) {
    if (error.code === '23505') return { ok: false, conflict: true, tableMissing: false, error: null };
    if (isTableMissing(error.code)) return { ok: false, conflict: false, tableMissing: true, error: null };
    return { ok: false, conflict: false, tableMissing: false, error: error.message };
  }
  return { ok: true, conflict: false, tableMissing: false, error: null };
}

/**
 * Atualizar uma peça existente: UPDATE filtrado por casa E dono. Zero linhas
 * afetadas = a peça já não existe no banco (destruída por outra sala) — a
 * chamada falha em vez de recriá-la.
 */
export async function updateBigChessPiece(record: BigChessPieceRecord): Promise<BigChessWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { region, square, ...row } = recordToRow(record);
  const { data, error } = await client
    .from('bigchess_pieces')
    .update(row)
    .eq('region', region)
    .eq('square', square)
    .eq('owner_id', record.ownerId)
    .select('square');
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, tableMissing: false, error: `peça ${square} não existe mais no banco` };
  return { ok: true, tableMissing: false, error: null };
}

export async function deleteBigChessPiece(region: string, square: string): Promise<BigChessWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('bigchess_pieces').delete().eq('region', region).eq('square', square);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  return { ok: true, tableMissing: false, error: null };
}

// ---------------------------------------------------------------- carteira

export interface WalletReadResult {
  crowns: number;
  tableMissing: boolean;
  error: string | null;
}

export interface WalletWriteResult extends WalletReadResult {
  ok: boolean;
}

export async function getWallet(userId: string): Promise<WalletReadResult> {
  const client = getServiceClient();
  if (!client) return { crowns: 0, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client.from('player_wallets').select('crowns').eq('user_id', userId).maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { crowns: 0, tableMissing: true, error: null };
    return { crowns: 0, tableMissing: false, error: error.message };
  }
  return { crowns: Number(data?.crowns ?? 0) || 0, tableMissing: false, error: null };
}

/**
 * Soma `amount` (inteiro ≥ 0) de Crowns ao saldo e devolve o novo total.
 * Atômico no banco (função chessworld_add_crowns): duas salas coletando ao
 * mesmo tempo não se sobrescrevem.
 */
export async function addCrowns(userId: string, amount: number): Promise<WalletWriteResult> {
  if (!Number.isSafeInteger(amount) || amount < 0) return { ok: false, crowns: 0, tableMissing: false, error: 'Quantia inválida' };
  const client = getServiceClient();
  if (!client) return { ok: false, crowns: 0, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client.rpc('chessworld_add_crowns', { p_user_id: userId, p_delta: amount });
  if (error) {
    if (isTableMissing(error.code) || isFunctionMissing(error.code)) return { ok: false, crowns: 0, tableMissing: true, error: null };
    return { ok: false, crowns: 0, tableMissing: false, error: error.message };
  }
  const crowns = Number(data);
  if (!Number.isFinite(crowns)) return { ok: false, crowns: 0, tableMissing: false, error: 'Resposta inválida de chessworld_add_crowns' };
  return { ok: true, crowns, tableMissing: false, error: null };
}
