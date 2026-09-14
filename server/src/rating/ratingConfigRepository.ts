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
 * Liquidação ATÔMICA de uma partida (uma transação): trava os dois perfis em
 * ordem fixa, confere idempotência (histórico) e o estado pré-partida usado no
 * cálculo (CAS em chess_rated_games_played + contadores do ledger do dia),
 * depois grava histórico + ledger + perfil dos dois. Qualquer falha desfaz
 * tudo — nunca fica histórico sem perfil atualizado nem prêmio sem saldo.
 * O cálculo (Glicko-2 e limites de gambits) continua no servidor Node; o SQL
 * só verifica que as premissas ainda valem e devolve 'conflict' se não.
 */
export const RATING_SETTLE_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION chessworld_settle_match(
  p_match_id text,
  p_kind text,
  p_settled_at timestamptz,
  p_players jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_player jsonb;
  v_current integer;
  v_games_today integer;
  v_earned_today integer;
  v_balance integer;
  v_balances jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_players) <> 'array' OR jsonb_array_length(p_players) <> 2 THEN
    RAISE EXCEPTION 'chessworld_settle_match: esperados exatamente 2 jogadores';
  END IF;
  SELECT array_agg(pid ORDER BY pid) INTO v_ids
    FROM (SELECT (e->>'player_id')::uuid AS pid FROM jsonb_array_elements(p_players) e) s;
  IF v_ids[1] = v_ids[2] THEN
    RAISE EXCEPTION 'chessworld_settle_match: jogadores iguais';
  END IF;

  -- 1) Trava os dois perfis sempre na mesma ordem (sem deadlock entre liquidações simultâneas).
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM profiles WHERE user_id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'profile_missing', 'player_id', v_id);
    END IF;
  END LOOP;

  -- 2) Idempotência: a partida já foi liquidada (por este ou outro processo)?
  IF EXISTS (SELECT 1 FROM chess_rating_history WHERE match_id = p_match_id) THEN
    RETURN jsonb_build_object('status', 'already_settled');
  END IF;

  -- 3) As premissas do cálculo ainda valem? (estado pré-partida dos dois + ledger do dia)
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_id := (v_player->>'player_id')::uuid;
    SELECT chess_rated_games_played INTO v_current FROM profiles WHERE user_id = v_id;
    IF v_current IS DISTINCT FROM (v_player->>'expected_rated_games')::integer THEN
      RETURN jsonb_build_object('status', 'conflict', 'player_id', v_id, 'field', 'rated_games');
    END IF;
    SELECT COUNT(*) FILTER (WHERE opponent_id = (v_player->>'opponent_id')::uuid AND amount > 0),
           COALESCE(SUM(amount), 0)
      INTO v_games_today, v_earned_today
      FROM gambit_awards
      WHERE player_id = v_id AND created_at >= (v_player->>'day_start')::timestamptz;
    IF v_games_today <> (v_player->>'expected_opponent_games_today')::integer
       OR v_earned_today <> (v_player->>'expected_earned_today')::integer THEN
      RETURN jsonb_build_object('status', 'conflict', 'player_id', v_id, 'field', 'gambit_day');
    END IF;
  END LOOP;

  -- 4) Grava tudo (histórico + ledger + perfil) dos dois jogadores.
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_id := (v_player->>'player_id')::uuid;
    INSERT INTO chess_rating_history (
      player_id, match_id, opponent_id, result, rating_before, rating_after, rating_delta,
      rd_before, rd_after, volatility_after, opponent_rating_before, match_kind, created_at
    ) VALUES (
      v_id, p_match_id, (v_player->>'opponent_id')::uuid, v_player->>'result',
      (v_player->>'rating_before')::double precision, (v_player->>'rating_after')::double precision,
      (v_player->>'rating_delta')::double precision, (v_player->>'rd_before')::double precision,
      (v_player->>'rd_after')::double precision, (v_player->>'volatility_after')::double precision,
      (v_player->>'opponent_rating_before')::double precision, p_kind, p_settled_at
    );
    INSERT INTO gambit_awards (player_id, match_id, opponent_id, amount, kind, reason, created_at)
    VALUES (
      v_id, p_match_id, (v_player->>'opponent_id')::uuid, (v_player->>'gambits_amount')::integer,
      p_kind, v_player->>'gambits_reason', p_settled_at
    );
    UPDATE profiles SET
      rating = ROUND((v_player->>'rating_after')::double precision)::integer,
      chess_rating = (v_player->>'rating_after')::double precision,
      chess_rating_deviation = (v_player->>'rd_after')::double precision,
      chess_rating_volatility = (v_player->>'volatility_after')::double precision,
      chess_rated_games_played = chess_rated_games_played + 1,
      chess_peak_rating = GREATEST(chess_peak_rating, (v_player->>'rating_after')::double precision),
      chess_last_rated_at = p_settled_at,
      wins = COALESCE(wins, 0) + CASE WHEN v_player->>'result' = 'win' THEN 1 ELSE 0 END,
      losses = COALESCE(losses, 0) + CASE WHEN v_player->>'result' = 'loss' THEN 1 ELSE 0 END,
      draws = COALESCE(draws, 0) + CASE WHEN v_player->>'result' = 'draw' THEN 1 ELSE 0 END,
      games_played = COALESCE(games_played, 0) + 1,
      gambits = gambits + GREATEST((v_player->>'gambits_amount')::integer, 0),
      updated_at = now()
    WHERE user_id = v_id
    RETURNING gambits INTO v_balance;
    v_balances := v_balances || jsonb_build_object(v_id::text, v_balance);
  END LOOP;

  RETURN jsonb_build_object('status', 'applied', 'gambits', v_balances);
EXCEPTION WHEN unique_violation THEN
  -- Outro processo gravou o histórico entre a checagem e o insert: nada foi aplicado aqui.
  RETURN jsonb_build_object('status', 'already_settled');
END;
$$;
REVOKE ALL ON FUNCTION chessworld_settle_match(text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chessworld_settle_match(text, text, timestamptz, jsonb) TO service_role;`;

/**
 * Prêmio avulso de gambits (hoje: bônus do campeão de torneio) — ledger +
 * saldo numa transação, idempotente por (match_id, player_id) e, para o
 * campeão, um único prêmio por torneio (match_id) seja quem for o jogador.
 * Sem adversário (opponent_id NULL) e sem limite por adversário; o teto
 * diário, se houver, é aplicado aqui dentro com o perfil travado.
 */
export const GAMBIT_AWARD_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION chessworld_award_gambits(
  p_match_id text,
  p_player_id uuid,
  p_amount integer,
  p_kind text,
  p_day_start timestamptz,
  p_daily_cap integer,
  p_awarded_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_earned integer;
  v_amount integer;
  v_reason text;
  v_balance integer;
BEGIN
  IF p_match_id IS NULL OR p_match_id = '' OR p_player_id IS NULL THEN
    RAISE EXCEPTION 'chessworld_award_gambits: match_id e player_id são obrigatórios';
  END IF;

  PERFORM 1 FROM profiles WHERE user_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'profile_missing', 'player_id', p_player_id);
  END IF;
  -- Idempotência: mesmo jogador no mesmo match_id; e o bônus de campeão é
  -- UM por torneio, seja quem for o jogador (índice parcial garante sob
  -- concorrência → unique_violation → already_awarded).
  IF EXISTS (
    SELECT 1 FROM gambit_awards
    WHERE match_id = p_match_id
      AND (player_id = p_player_id OR (p_kind = 'tournament_champion' AND kind = 'tournament_champion'))
  ) THEN
    RETURN jsonb_build_object('status', 'already_awarded');
  END IF;

  v_amount := GREATEST(COALESCE(p_amount, 0), 0);
  v_reason := CASE WHEN v_amount > 0 THEN 'awarded' ELSE 'zero' END;
  IF p_daily_cap IS NOT NULL AND v_amount > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_earned
      FROM gambit_awards
      WHERE player_id = p_player_id AND created_at >= p_day_start;
    IF v_earned + v_amount > p_daily_cap THEN
      v_amount := GREATEST(p_daily_cap - v_earned, 0);
      v_reason := 'daily_cap';
    END IF;
  END IF;

  INSERT INTO gambit_awards (player_id, match_id, opponent_id, amount, kind, reason, created_at)
  VALUES (p_player_id, p_match_id, NULL, v_amount, p_kind, v_reason, COALESCE(p_awarded_at, now()));
  UPDATE profiles SET gambits = gambits + v_amount, updated_at = now()
    WHERE user_id = p_player_id
    RETURNING gambits INTO v_balance;

  RETURN jsonb_build_object('status', 'applied', 'amount', v_amount, 'reason', v_reason, 'gambits', v_balance);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'already_awarded');
END;
$$;
REVOKE ALL ON FUNCTION chessworld_award_gambits(text, uuid, integer, text, timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chessworld_award_gambits(text, uuid, integer, text, timestamptz, integer, timestamptz) TO service_role;`;

/**
 * Migração completa — segura para rodar de novo (IF NOT EXISTS / OR REPLACE / ALTER idempotente;
 * o passo 6 só toca quem ainda não tem partida avaliada pelo Glicko-2, então
 * na primeira execução zera TODOS ao estado inicial 1200/350/0.06 e depois
 * nunca mais apaga rating de ninguém). Rodar no SQL editor do Supabase.
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
  opponent_id uuid NULL,
  amount integer NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL DEFAULT 'awarded',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS gambit_awards_player_day_idx ON gambit_awards (player_id, created_at DESC);
ALTER TABLE gambit_awards ENABLE ROW LEVEL SECURITY;
-- prêmios sem adversário (bônus de campeão de torneio): um por torneio, seja quem for o campeão
ALTER TABLE gambit_awards ALTER COLUMN opponent_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gambit_awards_tournament_champion_idx
  ON gambit_awards (match_id) WHERE kind = 'tournament_champion';

-- 4) Config do admin
${RATING_CONFIG_TABLE_SQL}

-- 5) Partidas: todas as partidas da sala passam a ser gravadas (busca por id da sala)
CREATE INDEX IF NOT EXISTS matches_colyseus_match_id_idx ON matches (colyseus_match_id);
CREATE INDEX IF NOT EXISTS matches_created_at_idx ON matches (created_at DESC);

-- 6) Estado inicial para quem ainda não tem partida avaliada (na 1ª execução = todos;
--    rodar de novo depois NÃO apaga rating de quem já jogou)
UPDATE profiles SET
  rating = 1200,
  chess_rating = 1200,
  chess_rating_deviation = 350,
  chess_rating_volatility = 0.06,
  chess_peak_rating = 1200,
  chess_last_rated_at = NULL
WHERE chess_rated_games_played = 0
  AND NOT EXISTS (SELECT 1 FROM chess_rating_history h WHERE h.player_id = profiles.user_id);

-- 7) Liquidação atômica (histórico + ledger + perfil numa transação)
${RATING_SETTLE_FUNCTION_SQL}

-- 8) Prêmio avulso (bônus do campeão de torneio): ledger + saldo numa transação
${GAMBIT_AWARD_FUNCTION_SQL}`;

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
