/*
# Add tournament tracking columns to matches

1. Modified Tables
  - `matches`
    - `colyseus_match_id` (text, nullable) — the in-memory Colyseus match ID used server-side to upsert records
    - `tournament_id` (uuid, nullable) — foreign key to tournament_instances(id), ON DELETE SET NULL
    - `tournament_round` (integer, nullable) — round number within the tournament
    - `tournament_board_number` (integer, nullable) — board/pairing number within the round
    - `runtime_table_id` (text, nullable) — the dynamic string ID of the arena table (e.g. "t1_abc_table_1")
    - `tournament_score` (text, nullable) — Swiss result string: "1-0", "0-1", or "1/2-1/2"

2. Indexes
  - Unique partial index on `colyseus_match_id` where NOT NULL — prevents duplicate server-side inserts

3. Foreign Keys
  - `tournament_id` references `tournament_instances(id)` ON DELETE SET NULL

4. Important Notes
  - All columns are nullable so normal (non-tournament) matches are unaffected
  - Server-side upsert uses `colyseus_match_id` as the idempotency key
  - The existing `board_id` column will be NULL for tournament matches; `runtime_table_id` carries the text identifier instead
  - `tournament_score` is populated when the match finishes, mirroring the Swiss pairing result
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'colyseus_match_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN colyseus_match_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'tournament_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN tournament_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'tournament_round'
  ) THEN
    ALTER TABLE matches ADD COLUMN tournament_round integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'tournament_board_number'
  ) THEN
    ALTER TABLE matches ADD COLUMN tournament_board_number integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'runtime_table_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN runtime_table_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'tournament_score'
  ) THEN
    ALTER TABLE matches ADD COLUMN tournament_score text;
  END IF;
END $$;

-- Add FK to tournament_instances if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'matches'
      AND kcu.column_name = 'tournament_id'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT fk_matches_tournament
      FOREIGN KEY (tournament_id) REFERENCES tournament_instances(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Unique partial index on colyseus_match_id (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_colyseus_match_id
  ON matches (colyseus_match_id)
  WHERE colyseus_match_id IS NOT NULL;

-- Regular index for tournament lookups
CREATE INDEX IF NOT EXISTS idx_matches_tournament_id
  ON matches (tournament_id)
  WHERE tournament_id IS NOT NULL;
