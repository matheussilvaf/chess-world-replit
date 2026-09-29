-- Sala de Lições: executar manualmente após tactics_academy_phase2.sql.
CREATE TABLE IF NOT EXISTS public.academy_lesson_progress (
  user_id uuid NOT NULL,
  theme text NOT NULL,
  best_score int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, theme)
);

CREATE TABLE IF NOT EXISTS public.academy_puzzle_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  puzzle_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('lesson', 'problem')),
  theme text,
  solved boolean NOT NULL,
  first_try boolean NOT NULL,
  rating int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academy_puzzle_history_user_created_idx ON public.academy_puzzle_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS academy_puzzle_history_user_theme_idx ON public.academy_puzzle_history (user_id, theme);

-- Filtro de abertura: lichess_puzzles.opening_tags é text[] (família + variação),
-- então o servidor usa `opening_tags @> ARRAY[:tag]` (PostgREST `contains`).
-- Índice opcional para acelerar o filtro por abertura:
CREATE INDEX IF NOT EXISTS lichess_puzzles_opening_tags_gin_idx ON public.lichess_puzzles USING gin (opening_tags);

ALTER TABLE public.academy_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_puzzle_history ENABLE ROW LEVEL SECURITY;
-- Sem política de INSERT/UPDATE/DELETE: gravação apenas pela service role.
DROP POLICY IF EXISTS academy_lesson_progress_select_own ON public.academy_lesson_progress;
CREATE POLICY academy_lesson_progress_select_own ON public.academy_lesson_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS academy_puzzle_history_select_own ON public.academy_puzzle_history;
CREATE POLICY academy_puzzle_history_select_own ON public.academy_puzzle_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());