-- Estatísticas da academia. Execute após phase2 e phase3 no SQL Editor.
-- Chamadas apenas pelo servidor com service role.
-- Ranking completo (uso interno): uma única passada sobre os eventos, já com a posição e o total de jogadores.
CREATE OR REPLACE FUNCTION public.academy_rank_all(p_board text, p_period text)
RETURNS TABLE(rank int, user_id uuid, username text, value int, total_players int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH since AS (
    SELECT CASE p_period WHEN 'week' THEN now() - interval '7 days'
                         WHEN 'month' THEN now() - interval '30 days'
                         ELSE '-infinity'::timestamptz END AS t
  ), events AS (
    SELECT h.user_id AS uid, h.rating AS points, h.created_at AS happened, 'history'::text AS source, h.mode, h.first_try
      FROM public.academy_puzzle_history h WHERE h.solved
    UNION ALL
    SELECT d.user_id, dp.rating, COALESCE(d.finished_at, d.started_at), 'daily', ''::text, false
      FROM public.academy_daily_attempts d
      JOIN public.academy_daily_puzzles dp ON dp.puzzle_date = d.puzzle_date AND dp.slot = d.slot
      WHERE d.status = 'solved'
    UNION ALL
    SELECT b.player_a, NULL::int, b.finished_at, 'battle', ''::text, false
      FROM public.academy_puzzle_battles b, generate_series(1, GREATEST(b.a_solved, 0))
    UNION ALL
    SELECT b.player_b, NULL::int, b.finished_at, 'battle', ''::text, false
      FROM public.academy_puzzle_battles b, generate_series(1, GREATEST(b.b_solved, 0))
  ), scores AS (
    SELECT e.uid, CASE WHEN p_board = 'hardest' THEN max(e.points)::int ELSE count(*)::int END AS score
      FROM events e, since
      WHERE p_board IN ('solved','problems','firsttry','hardest')
        AND e.happened >= since.t
        AND (p_board <> 'problems' OR (e.source = 'history' AND e.mode = 'problem'))
        AND (p_board <> 'firsttry' OR (e.source = 'history' AND e.first_try))
        AND (p_board <> 'hardest' OR e.points IS NOT NULL)
      GROUP BY e.uid
    UNION ALL
    SELECT b.winner_id, count(*)::int FROM public.academy_puzzle_battles b, since
      WHERE p_board = 'battles' AND b.winner_id IS NOT NULL AND b.finished_at >= since.t
      GROUP BY b.winner_id
    UNION ALL
    SELECT l.user_id, count(*)::int FROM public.academy_lesson_progress l, since
      WHERE p_board = 'lessons' AND l.completed_at IS NOT NULL AND l.completed_at >= since.t
      GROUP BY l.user_id
  ), ranked AS (
    SELECT rank() OVER (ORDER BY s.score DESC, s.uid)::int AS place, s.uid, s.score,
           count(*) OVER ()::int AS players FROM scores s WHERE s.score > 0
  )
  SELECT r.place, r.uid, COALESCE(NULLIF(p.username, ''), 'Jogador'), r.score, r.players
    FROM ranked r LEFT JOIN public.profiles p ON p.user_id = r.uid
    ORDER BY r.place;
$$;

-- Página do ranking. Boards: solved, battles, lessons, problems, firsttry, hardest. Períodos: week, month, all.
CREATE OR REPLACE FUNCTION public.academy_rank_board(p_board text, p_period text, p_limit int, p_offset int)
RETURNS TABLE(rank int, user_id uuid, username text, value int, total_players int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_board NOT IN ('solved','battles','lessons','problems','firsttry','hardest')
     OR p_period NOT IN ('week','month','all')
     OR p_limit NOT BETWEEN 1 AND 10 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Filtro de ranking inválido';
  END IF;
  RETURN QUERY SELECT a.rank, a.user_id, a.username, a.value, a.total_players
    FROM public.academy_rank_all(p_board, p_period) a
    ORDER BY a.rank LIMIT p_limit OFFSET p_offset;
END $$;

-- Posição do próprio jogador (rank NULL quando ainda não pontuou no período).
CREATE OR REPLACE FUNCTION public.academy_my_rank(p_board text, p_period text, p_user uuid)
RETURNS TABLE(rank int, value int, total_players int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_board NOT IN ('solved','battles','lessons','problems','firsttry','hardest')
     OR p_period NOT IN ('week','month','all') THEN
    RAISE EXCEPTION 'Filtro de ranking inválido';
  END IF;
  RETURN QUERY SELECT a.rank, a.value, a.total_players FROM public.academy_rank_all(p_board, p_period) a WHERE a.user_id = p_user;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::int, 0, COALESCE((SELECT max(a.total_players) FROM public.academy_rank_all(p_board, p_period) a), 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.academy_stats_summary()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
-- "Hoje" no fuso do jogo (UTC-3), o mesmo dia do puzzle diário.
WITH today AS (
  SELECT (date_trunc('day', now() AT TIME ZONE 'America/Recife') AT TIME ZONE 'America/Recife') AS t
), solved AS (
  SELECT user_id, created_at AS happened FROM public.academy_puzzle_history WHERE solved
  UNION ALL SELECT user_id, COALESCE(finished_at, started_at) FROM public.academy_daily_attempts WHERE status = 'solved'
  UNION ALL SELECT player_a, finished_at FROM public.academy_puzzle_battles b, generate_series(1, GREATEST(b.a_solved, 0))
  UNION ALL SELECT player_b, finished_at FROM public.academy_puzzle_battles b, generate_series(1, GREATEST(b.b_solved, 0))
), activity AS (
  SELECT user_id FROM solved WHERE happened >= (SELECT t FROM today)
  UNION SELECT player_a FROM public.academy_puzzle_battles WHERE finished_at >= (SELECT t FROM today)
  UNION SELECT player_b FROM public.academy_puzzle_battles WHERE finished_at >= (SELECT t FROM today)
  UNION SELECT user_id FROM public.academy_lesson_progress WHERE updated_at >= (SELECT t FROM today)
)
SELECT json_build_object(
 'solvedToday', (SELECT count(*) FROM solved WHERE happened >= (SELECT t FROM today)),
 'activeToday', (SELECT count(*) FROM activity),
 'battlesToday', (SELECT count(*) FROM public.academy_puzzle_battles WHERE finished_at >= (SELECT t FROM today)),
 'lessonsToday', (SELECT count(*) FROM public.academy_lesson_progress WHERE completed_at >= (SELECT t FROM today)),
 'topThemeWeek', (SELECT theme FROM public.academy_puzzle_history WHERE solved AND theme IS NOT NULL AND created_at >= now() - interval '7 days' GROUP BY theme ORDER BY count(*) DESC, theme LIMIT 1),
 'totalSolved', (SELECT count(*) FROM solved),
 'totalBattles', (SELECT count(*) FROM public.academy_puzzle_battles)
) $$;

REVOKE ALL ON FUNCTION public.academy_rank_all(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.academy_rank_board(text,text,int,int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.academy_my_rank(text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.academy_stats_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.academy_rank_all(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.academy_rank_board(text,text,int,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.academy_my_rank(text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.academy_stats_summary() TO service_role;