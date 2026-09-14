/**
 * Config de Rating (Glicko-2) + Gambits (documento único em jsonb) e o SQL da
 * migração completa do sistema (colunas do `profiles`, histórico de rating,
 * ledger de gambits, tabela de config).
 *
 * Storage: Supabase `chess_rating_config` (config_id text PK, config jsonb,
 * updated_at), service-role only — mesmo padrão de energy_skills_config.
 */
import {
  DEFAULT_RATING_GAMBITS_CONFIG,
  RATING_CONFIG_ID,
  parseRatingGambitsConfig,
  type RatingGambitsConfig,
} from '../shared/rating/RatingShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const RATING_CONFIG_TABLE_SQL = `CREATE TABLE IF NOT EXISTS chess_rating_config (
  config_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chess_rating_config ENABLE ROW LEVEL SECURITY;`;

/**
 * Migração completa (idempotente). Rodar UMA vez no SQL editor do Supabase.
 * O reset final coloca TODOS os jogadores no estado inicial 1200/350/0.06.
 */
export const RATING_MIGRATION_SQL = `-- 1) Rating Glicko-2 + gambits no perfil
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS chess_rating double precision NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS chess_rating_deviation double precision NOT NULL DEFAULT 350,
  ADD COLUMN IF NOT EXISTS chess_rating_volatility double precision NOT NULL DEFAULT 0.06,
  ADD COLUMN IF NOT EXISTS chess_rated_games_played integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chess_peak_rating double precision NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS chess_last_rated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS gambits integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ALTER COLUMN rating SET DEFAULT 1200;

-- 2) Histórico de rating (uma linha por jogador por partida = trava de idempotência)
CREATE TABLE IF NOT EXISTS chess_rating_history (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL,
  match_id text NOT NULL,
  opponent_id uuid NOT NULL,
  result text NOT NULL,
  rating_before double precision NOT NULL,
  rating_after double precision NOT NULL,
  rating_delta double precision NOT NULL,
  rd_before double precision NOT NULL,
  rd_after double precision NOT NULL,
  volatility_after double precision NOT NULL,
  opponent_rating_before double precision NOT NULL,
  match_kind text NOT NULL DEFAULT 'plaza',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS chess_rating_history_player_idx ON chess_rating_history (player_id, created_at DESC);
ALTER TABLE chess_rating_history ENABLE ROW LEVEL SECURITY;

-- 3) Ledger de gambits (limite por adversário/dia e teto diário)
CREATE TABLE IF NOT EXISTS gambit_awards (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL,
  match_id text NOT NULL,
  opponent_id uuid NOT NULL,
  amount integer NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL DEFAULT 'awarded',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS gambit_awards_player_day_idx ON gambit_awards (player_id, created_at DESC);
ALTER TABLE gambit_awards ENABLE ROW LEVEL SECURITY;

-- 4) Config do admin
${RATING_CONFIG_TABLE_SQL}

-- 5) Partidas: todas as partidas da sala passam a ser gravadas (busca por id da sala)
CREATE INDEX IF NOT EXISTS matches_colyseus_match_id_idx ON matches (colyseus_match_id);
CREATE INDEX IF NOT EXISTS matches_created_at_idx ON matches (created_at DESC);

-- 6) Reset de TODOS os jogadores ao estado inicial
UPDATE profiles SET
  rating = 1200,
  chess_rating = 1200,
  chess_rating_deviation = 350,
  chess_rating_volatility = 0.06,
  chess_rated_games_played = 0,
  chess_peak_rating = 1200,
  chess_last_rated_at = NULL;`;

const CACHE_TTL_MS = 30_000;

export interface RatingConfigReadResult {
  config: RatingGambitsConfig | null;
  updatedAt: string | null;
  tableMissing: boolean;
  error: string | null;
}

export interface RatingConfigWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

export async function getRatingConfig(): Promise<RatingConfigReadResult> {
  const client = getServiceClient();
  if (!client) return { config: null, updatedAt: null, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client
    .from('chess_rating_config')
    .select('config_id, config, updated_at')
    .eq('config_id', RATING_CONFIG_ID)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error.code)) return { config: null, updatedAt: null, tableMissing: true, error: null };
    return { config: null, updatedAt: null, tableMissing: false, error: error.message };
  }
  if (!data) return { config: null, updatedAt: null, tableMissing: false, error: null };
  const parsed = parseRatingGambitsConfig(data.config);
  if (!parsed.ok) {
    console.warn('[rating] config armazenada inválida; usando defaults:', parsed.errors[0]);
    return { config: null, updatedAt: null, tableMissing: false, error: null };
  }
  return {
    config: parsed.config,
    updatedAt: (data as { updated_at?: string }).updated_at ?? null,
    tableMissing: false,
    error: null,
  };
}

export async function saveRatingConfig(config: RatingGambitsConfig): Promise<RatingConfigWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { config_id: RATING_CONFIG_ID, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('chess_rating_config').upsert(row, { onConflict: 'config_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateRatingConfigCache();
  return { ok: true, tableMissing: false, error: null };
}

let cache: { config: RatingGambitsConfig; expiresAt: number } | null = null;

export function invalidateRatingConfigCache(): void {
  cache = null;
}

/** Config efetiva (salva ou defaults), cacheada 30 s. Nunca falha. */
export async function getRatingConfigCached(): Promise<RatingGambitsConfig> {
  if (cache && Date.now() < cache.expiresAt) return cache.config;
  let config = DEFAULT_RATING_GAMBITS_CONFIG;
  try {
    const result = await getRatingConfig();
    if (result.config) config = result.config;
  } catch (error) {
    console.warn(`[rating] config indisponível: ${error instanceof Error ? error.message : String(error)}`);
  }
  cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}
