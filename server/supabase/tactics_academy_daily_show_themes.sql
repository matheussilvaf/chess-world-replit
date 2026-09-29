-- Tactics Academy — toggle "mostrar tema" dos puzzles diários (config do admin).
-- Idempotente: rode no SQL Editor do Supabase em bancos criados antes desta coluna.
-- (tactics_academy_phase2.sql já inclui a coluna para instalações novas.)
ALTER TABLE public.academy_daily_config
  ADD COLUMN IF NOT EXISTS show_themes boolean NOT NULL DEFAULT true;
