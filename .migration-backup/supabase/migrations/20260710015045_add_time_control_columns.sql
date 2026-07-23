/*
# Add time control columns to boards and matches

1. Modified Tables
  - `boards`
    - `time_minutes` (integer, nullable) - time control minutes chosen by the challenger
    - `increment_seconds` (integer, nullable) - increment in seconds per move
  - `matches`
    - `time_minutes` (integer, default 10) - base time in minutes
    - `increment_seconds` (integer, default 0) - increment in seconds per move
    - `white_time_ms` (bigint) - white's remaining time in milliseconds
    - `black_time_ms` (bigint) - black's remaining time in milliseconds
    - `last_move_at` (timestamptz) - timestamp of the last move for timer calculations

2. Important Notes
  - These columns enable real-time chess clocks
  - `last_move_at` is used to compute elapsed time between moves
  - Time is stored in milliseconds for precision
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boards' AND column_name = 'time_minutes') THEN
    ALTER TABLE boards ADD COLUMN time_minutes integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boards' AND column_name = 'increment_seconds') THEN
    ALTER TABLE boards ADD COLUMN increment_seconds integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'time_minutes') THEN
    ALTER TABLE matches ADD COLUMN time_minutes integer DEFAULT 10;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'increment_seconds') THEN
    ALTER TABLE matches ADD COLUMN increment_seconds integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'white_time_ms') THEN
    ALTER TABLE matches ADD COLUMN white_time_ms bigint DEFAULT 600000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'black_time_ms') THEN
    ALTER TABLE matches ADD COLUMN black_time_ms bigint DEFAULT 600000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'last_move_at') THEN
    ALTER TABLE matches ADD COLUMN last_move_at timestamptz DEFAULT now();
  END IF;
END $$;
