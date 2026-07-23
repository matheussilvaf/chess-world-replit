/*
# Update increment_profile_stats to handle draws

1. Modified Functions
  - `increment_profile_stats` - Now accepts a third parameter `p_is_draw` (boolean, default false)
    - Win (p_is_win = true): +8 rating, +1 wins, +1 games_played, +1 trophies
    - Draw (p_is_draw = true): +1 rating, +1 draws, +1 games_played
    - Loss (p_is_win = false, p_is_draw = false): +1 losses, +1 games_played, no rating change

2. Important Notes
  - Uses atomic SQL updates to prevent race conditions
  - Backwards compatible: existing calls with 2 args still work (p_is_draw defaults to false)
  - SECURITY DEFINER allows edge functions/server to call without RLS bypass
*/

CREATE OR REPLACE FUNCTION increment_profile_stats(p_user_id uuid, p_is_win boolean, p_is_draw boolean DEFAULT false)
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
  ELSIF p_is_draw THEN
    UPDATE profiles SET
      draws = draws + 1,
      games_played = games_played + 1,
      rating = rating + 1,
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
