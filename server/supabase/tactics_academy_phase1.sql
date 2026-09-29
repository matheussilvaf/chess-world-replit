-- Execute este script no SQL Editor do projeto Supabase antes de salvar bots ou partidas.
CREATE TABLE IF NOT EXISTS public.academy_bots (
  id text PRIMARY KEY CHECK (id IN ('bot_1', 'bot_2', 'bot_3', 'bot_4')),
  name text NOT NULL,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  updated_at timestamptz DEFAULT now()
);
INSERT INTO public.academy_bots (id, name, level) VALUES
  ('bot_1', 'Leo', 1), ('bot_2', 'Victor', 2),
  ('bot_3', 'Catarina', 3), ('bot_4', 'Marta', 4)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bot_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bot_id text NOT NULL,
  bot_name text NOT NULL,
  bot_level smallint NOT NULL,
  player_color char(1) NOT NULL CHECK (player_color IN ('w', 'b')),
  result text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss', 'draw', 'aborted')),
  reason text NOT NULL DEFAULT '',
  time_minutes int NOT NULL DEFAULT 0,
  increment_seconds int NOT NULL DEFAULT 0,
  time_label text NOT NULL DEFAULT '',
  moves_count int NOT NULL DEFAULT 0,
  pgn text NOT NULL DEFAULT '',
  final_fen text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_games_user_finished_idx ON public.bot_games (user_id, finished_at DESC);
ALTER TABLE public.academy_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_games ENABLE ROW LEVEL SECURITY;