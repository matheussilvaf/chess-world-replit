-- Add unique constraint on (region, name) to prevent duplicate boards
-- This allows upsert logic when boards are created from the Tiled map
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_region_name ON boards(region, name);
