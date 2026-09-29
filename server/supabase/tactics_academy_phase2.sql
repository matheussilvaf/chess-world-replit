-- Tactics Academy — Fase 2 (Sala de Puzzles). Execute no SQL Editor do Supabase
-- DEPOIS de importar `public.lichess_puzzles` e de rodar tactics_academy_phase1.sql.
-- Pré-requisito já existente: função chessworld_award_gambits (migração de rating/Gambitos).

-- Índices para o sorteio por random_key com filtros (nunca ORDER BY random()).
CREATE INDEX IF NOT EXISTS lichess_puzzles_random_key_idx ON public.lichess_puzzles (random_key);
CREATE INDEX IF NOT EXISTS lichess_puzzles_rating_random_idx ON public.lichess_puzzles (rating, random_key);
CREATE INDEX IF NOT EXISTS lichess_puzzles_themes_gin_idx ON public.lichess_puzzles USING gin (themes);

-- Temas disponíveis no banco, com contagem (lista do admin). Recalcule se reimportar os puzzles.
CREATE TABLE IF NOT EXISTS public.academy_puzzle_themes (
  theme text PRIMARY KEY,
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.academy_puzzle_themes (theme, count)
  SELECT t, count(*) FROM public.lichess_puzzles, unnest(themes) AS t GROUP BY t
ON CONFLICT (theme) DO UPDATE SET count = EXCLUDED.count, updated_at = now();

-- Configuração dos 3 slots diários, com agendamento por data (effective_from).
-- A linha '0001-01-01' é o padrão; conjuntos com data futura entram em vigor naquele dia.
CREATE TABLE IF NOT EXISTS public.academy_daily_config (
  effective_from date NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  rating_min int NOT NULL DEFAULT 600,
  rating_max int NOT NULL DEFAULT 1100,
  theme text NOT NULL DEFAULT '',
  reward_gambits int NOT NULL DEFAULT 0 CHECK (reward_gambits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (effective_from, slot)
);
INSERT INTO public.academy_daily_config (effective_from, slot, rating_min, rating_max, theme, reward_gambits) VALUES
  ('0001-01-01', 1, 600, 1100, '', 10),
  ('0001-01-01', 2, 1100, 1600, '', 20),
  ('0001-01-01', 3, 1600, 2200, '', 30)
ON CONFLICT (effective_from, slot) DO NOTHING;

-- Puzzle fixado pelo admin para (data, slot): sobrescreve o sorteio daquele dia.
CREATE TABLE IF NOT EXISTS public.academy_daily_pins (
  puzzle_date date NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  puzzle_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (puzzle_date, slot)
);

-- Puzzles do dia (iguais para todo o servidor). Gerados na primeira abertura do dia
-- (INSERT ... ON CONFLICT DO NOTHING garante um único sorteio mesmo com vários processos).
CREATE TABLE IF NOT EXISTS public.academy_daily_puzzles (
  puzzle_date date NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  puzzle_id text NOT NULL,
  rating int NOT NULL DEFAULT 0,
  themes text[] NOT NULL DEFAULT '{}',
  theme text NOT NULL DEFAULT '',
  rating_min int,
  rating_max int,
  reward_gambits int NOT NULL DEFAULT 0,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (puzzle_date, slot)
);
CREATE INDEX IF NOT EXISTS academy_daily_puzzles_puzzle_idx ON public.academy_daily_puzzles (puzzle_id);

-- Uma tentativa por jogador, por slot, por dia (3 vidas).
CREATE TABLE IF NOT EXISTS public.academy_daily_attempts (
  user_id uuid NOT NULL,
  puzzle_date date NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  puzzle_id text NOT NULL,
  lives_left smallint NOT NULL DEFAULT 3 CHECK (lives_left BETWEEN 0 AND 3),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'solved', 'failed')),
  earned_gambits int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (user_id, puzzle_date, slot)
);

-- Recompensas das batalhas (Gambitos). enabled=false ou tudo 0 = sem recompensa.
CREATE TABLE IF NOT EXISTS public.academy_battle_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  win_gambits int NOT NULL DEFAULT 10 CHECK (win_gambits >= 0),
  draw_gambits int NOT NULL DEFAULT 4 CHECK (draw_gambits >= 0),
  loss_gambits int NOT NULL DEFAULT 0 CHECK (loss_gambits >= 0),
  daily_cap_gambits int CHECK (daily_cap_gambits IS NULL OR daily_cap_gambits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.academy_battle_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Histórico das batalhas de puzzle.
CREATE TABLE IF NOT EXISTS public.academy_puzzle_battles (
  id uuid PRIMARY KEY,
  mode text NOT NULL,
  band text NOT NULL,
  show_themes boolean NOT NULL DEFAULT false,
  board_id text NOT NULL DEFAULT '',
  player_a uuid NOT NULL,
  player_a_name text NOT NULL DEFAULT '',
  player_b uuid NOT NULL,
  player_b_name text NOT NULL DEFAULT '',
  winner_id uuid,
  reason text NOT NULL DEFAULT '',
  a_solved int NOT NULL DEFAULT 0,
  b_solved int NOT NULL DEFAULT 0,
  a_reward int NOT NULL DEFAULT 0,
  b_reward int NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academy_puzzle_battles_a_idx ON public.academy_puzzle_battles (player_a, finished_at DESC);
CREATE INDEX IF NOT EXISTS academy_puzzle_battles_b_idx ON public.academy_puzzle_battles (player_b, finished_at DESC);

ALTER TABLE public.academy_puzzle_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_daily_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_daily_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_daily_puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_daily_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_battle_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_puzzle_battles ENABLE ROW LEVEL SECURITY;
