export interface Profile {
  id: string;
  user_id: string;
  username: string;
  avatar: string;
  current_region: string;
  /** Espelho inteiro do rating Glicko-2 (mantido para leitores legados). */
  rating: number;
  /** Legado (casas) — o HUD mostra `gambits`. */
  trophies: number;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  board_theme: string;
  piece_style: string;
  created_at: string;
  updated_at: string;
  /** Rating Glicko-2 (server-authoritative; ausentes até a migração rodar). */
  chess_rating?: number;
  chess_rating_deviation?: number;
  chess_rating_volatility?: number;
  chess_rated_games_played?: number;
  chess_peak_rating?: number;
  chess_last_rated_at?: string | null;
  /** Gambits — moeda ganha nas partidas (praça/torneio), gasta no craft. */
  gambits?: number;
}

export interface PlayerPresence {
  id: string;
  user_id: string;
  region: string;
  x: number;
  y: number;
  status: string;
  current_board_id: string | null;
  updated_at: string;
}

export interface Board {
  id: string;
  region: string;
  name: string;
  x: number;
  y: number;
  status: string;
  waiting_user_id: string | null;
  current_match_id: string | null;
  time_minutes: number | null;
  increment_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  region: string;
  board_id: string;
  white_user_id: string;
  black_user_id: string;
  current_fen: string;
  pgn: string;
  status: string;
  winner_user_id: string | null;
  result: string | null;
  turn: string;
  time_minutes: number;
  increment_seconds: number;
  white_time_ms: number;
  black_time_ms: number;
  last_move_at: string;
  created_at: string;
  finished_at: string | null;
}

export interface MatchMove {
  id: string;
  match_id: string;
  move_number: number;
  user_id: string;
  from_square: string;
  to_square: string;
  san: string;
  fen_after: string;
  created_at: string;
}

export interface House {
  id: string;
  region: string;
  name: string;
  x: number;
  y: number;
  price_trophies: number;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  region: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
}

export interface FriendRequest {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}
