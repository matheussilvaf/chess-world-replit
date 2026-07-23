/*
# Add swiss_tournament_id and transition lock to tournament_instances

1. Modified Tables
   - `tournament_instances`
     - `swiss_tournament_id` (text) - links to swiss_tournaments.id for engine state
     - `transition_lock` (timestamptz) - prevents concurrent state transitions

2. Notes
   - swiss_tournament_id allows coordinator to reuse the existing swiss service
   - transition_lock implements optimistic locking for idempotent state transitions
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournament_instances' AND column_name = 'swiss_tournament_id'
  ) THEN
    ALTER TABLE tournament_instances ADD COLUMN swiss_tournament_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournament_instances' AND column_name = 'transition_lock'
  ) THEN
    ALTER TABLE tournament_instances ADD COLUMN transition_lock timestamptz;
  END IF;
END $$;
