/*
# Create Swiss Tournament Persistence Tables

1. New Tables
   - `swiss_tournaments` - stores full tournament state as JSONB
     - `id` (text, primary key) - tournament ID from nanoid
     - `name` (text) - tournament name
     - `status` (text) - setup/active/finished/cancelled
     - `is_test` (boolean) - distinguishes test vs official tournaments
     - `data` (jsonb) - full tournament state (config, players, rounds, standings)
     - `created_by` (uuid) - user who created it
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)

2. Security
   - Enable RLS on `swiss_tournaments`
   - Authenticated users can read all tournaments
   - Only the creator can insert/update/delete their own test tournaments
   - Service role (server) bypasses RLS for all operations

3. Notes
   - The server uses service_role key so RLS doesn't block server operations
   - The full tournament domain object is stored as JSONB in `data` for flexibility
   - Index on is_test + status for filtered queries
*/

CREATE TABLE IF NOT EXISTS swiss_tournaments (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'setup',
  is_test boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swiss_tournaments_test_status ON swiss_tournaments(is_test, status);
CREATE INDEX IF NOT EXISTS idx_swiss_tournaments_created_by ON swiss_tournaments(created_by);

ALTER TABLE swiss_tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tournaments" ON swiss_tournaments;
CREATE POLICY "select_tournaments" ON swiss_tournaments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_tournaments" ON swiss_tournaments;
CREATE POLICY "insert_own_tournaments" ON swiss_tournaments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "update_own_tournaments" ON swiss_tournaments;
CREATE POLICY "update_own_tournaments" ON swiss_tournaments FOR UPDATE
  TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "delete_own_tournaments" ON swiss_tournaments;
CREATE POLICY "delete_own_tournaments" ON swiss_tournaments FOR DELETE
  TO authenticated USING (auth.uid() = created_by);
