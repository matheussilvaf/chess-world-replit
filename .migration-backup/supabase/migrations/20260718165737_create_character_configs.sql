/*
# Create character_configs table

Stores per-character visual configuration for origin point and collision body positioning.
Loaded at game startup so admins can adjust character geometry in real-time.

1. New Tables
  - `character_configs`
    - `character_id` (text, primary key) - matches the character catalog ID
    - `origin_x` (real) - sprite origin X as fraction of frame width (0-1)
    - `origin_y` (real) - sprite origin Y as fraction of frame height (0-1)
    - `body_offset_x` (real) - collision circle center X offset from origin in pixels
    - `body_offset_y` (real) - collision circle center Y offset from origin in pixels
    - `body_radius` (real) - collision circle radius in pixels
    - `updated_at` (timestamptz)

2. Security
  - Enable RLS.
  - Allow anon + authenticated to SELECT (game clients read config).
  - Allow anon + authenticated full CRUD (admin panel has no separate auth for now).

3. Seed data
  - Insert default config for 'test-character-01'.
*/

CREATE TABLE IF NOT EXISTS character_configs (
  character_id text PRIMARY KEY,
  origin_x real NOT NULL DEFAULT 0.5,
  origin_y real NOT NULL DEFAULT 0.5,
  body_offset_x real NOT NULL DEFAULT 0,
  body_offset_y real NOT NULL DEFAULT 21,
  body_radius real NOT NULL DEFAULT 10,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE character_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_character_configs" ON character_configs;
CREATE POLICY "anon_select_character_configs" ON character_configs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_character_configs" ON character_configs;
CREATE POLICY "anon_insert_character_configs" ON character_configs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_character_configs" ON character_configs;
CREATE POLICY "anon_update_character_configs" ON character_configs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_character_configs" ON character_configs;
CREATE POLICY "anon_delete_character_configs" ON character_configs FOR DELETE
  TO anon, authenticated USING (true);

INSERT INTO character_configs (character_id, origin_x, origin_y, body_offset_x, body_offset_y, body_radius)
VALUES ('test-character-01', 0.5, 0.5, 0, 21, 10)
ON CONFLICT (character_id) DO NOTHING;
