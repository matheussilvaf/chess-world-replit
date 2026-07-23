/*
# Create game_settings table

1. New Tables
  - `game_settings`
    - `id` (integer, primary key, always 1 - singleton row)
    - `default_zoom` (numeric, default camera zoom level)
    - `player_speed` (numeric, character movement speed)
    - `updated_at` (timestamp)

2. Security
  - Enable RLS on `game_settings`.
  - Allow all authenticated users to read (game needs to fetch settings).
  - Allow all authenticated users to update (admin page).

3. Notes
  - Singleton pattern: only one row (id=1) holds global game config.
  - Seed with default values.
*/

CREATE TABLE IF NOT EXISTS game_settings (
  id integer PRIMARY KEY DEFAULT 1,
  default_zoom numeric NOT NULL DEFAULT 2,
  player_speed numeric NOT NULL DEFAULT 3,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

ALTER TABLE game_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_read_settings" ON game_settings;
CREATE POLICY "anyone_can_read_settings" ON game_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_can_update_settings" ON game_settings;
CREATE POLICY "authenticated_can_update_settings" ON game_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_can_insert_settings" ON game_settings;
CREATE POLICY "authenticated_can_insert_settings" ON game_settings FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "no_delete_settings" ON game_settings;
CREATE POLICY "no_delete_settings" ON game_settings FOR DELETE
  TO authenticated USING (false);

-- Seed default row
INSERT INTO game_settings (id, default_zoom, player_speed)
VALUES (1, 2, 3)
ON CONFLICT (id) DO NOTHING;
