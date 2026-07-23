/*
# Create helper function for profile stats

1. New Functions
  - `increment_profile_stats(p_user_id uuid, p_is_win boolean)` - Atomically updates wins/losses, rating, trophies, games_played

2. Important Notes
  - Uses atomic SQL updates to prevent race conditions
  - Applies GAME_CONFIG values: +8 rating on win, 0 on loss, +1 trophy on win
*/

CREATE OR REPLACE FUNCTION increment_profile_stats(p_user_id uuid, p_is_win boolean)
RETURNS void AS $$
BEGIN
  IF p_is_win THEN
    UPDATE profiles SET
      wins = wins + 1,
      games_played = games_played + 1,
      rating = rating + 8,
      trophies = trophies + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE profiles SET
      losses = losses + 1,
      games_played = games_played + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
