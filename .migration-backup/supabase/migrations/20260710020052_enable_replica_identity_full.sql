/*
# Enable REPLICA IDENTITY FULL on matches and boards

This is required for Supabase Realtime postgres_changes to deliver
full row data on UPDATE events (including all columns needed for filtering
and state sync). Without REPLICA IDENTITY FULL, UPDATE events may only
contain the changed columns, breaking real-time synchronization.

1. Changes
  - Set REPLICA IDENTITY FULL on `matches` table
  - Set REPLICA IDENTITY FULL on `boards` table

2. Important Notes
  - This enables complete row delivery in Realtime UPDATE payloads
  - Required for chess move sync, timer sync, and game-over events
*/

ALTER TABLE matches REPLICA IDENTITY FULL;
ALTER TABLE boards REPLICA IDENTITY FULL;
