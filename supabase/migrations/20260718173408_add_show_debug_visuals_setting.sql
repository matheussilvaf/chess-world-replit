/*
# Add show_debug_visuals column to game_settings

1. Modified Tables
   - `game_settings`
     - `show_debug_visuals` (boolean, default false) - toggles character debug drawings visibility

2. Notes
   - Default is false (debug off), admin can enable it from the admin panel.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_settings' AND column_name = 'show_debug_visuals'
  ) THEN
    ALTER TABLE game_settings ADD COLUMN show_debug_visuals boolean NOT NULL DEFAULT false;
  END IF;
END $$;
