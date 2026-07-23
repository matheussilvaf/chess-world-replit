export interface Profile {
  id: string;
  user_id: string;
  username: string;
  avatar: string;
  current_region: string;
  rating: number;
  trophies: number;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  board_theme: string;
  piece_style: string;
  created_at: string;
  updated_at: string;
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
