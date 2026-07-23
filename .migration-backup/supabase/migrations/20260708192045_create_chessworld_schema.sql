/*
# ChessWorld MMO - Complete Database Schema

1. New Tables
  - `profiles` - Player profiles with rating, trophies, customization
    - `id` (uuid, primary key)
    - `user_id` (uuid, references auth.users, unique)
    - `username` (text, unique)
    - `avatar` (text) - avatar identifier
    - `current_region` (text) - europe, south_america, asia
    - `rating` (integer, default 500)
    - `trophies` (integer, default 0)
    - `wins` (integer, default 0)
    - `losses` (integer, default 0)
    - `draws` (integer, default 0)
    - `games_played` (integer, default 0)
    - `board_theme` (text, default 'classic')
    - `piece_style` (text, default 'classic')
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  - `player_presence` - Real-time player positions
    - `id` (uuid, primary key)
    - `user_id` (uuid, references auth.users)
    - `region` (text)
    - `x` (float)
    - `y` (float)
    - `status` (text) - online, in_match, idle
    - `current_board_id` (uuid, nullable)
    - `updated_at` (timestamptz)

  - `boards` - Chess board spots in the world
    - `id` (uuid, primary key)
    - `region` (text)
    - `name` (text)
    - `x` (float)
    - `y` (float)
    - `status` (text) - free, waiting, in_match
    - `waiting_user_id` (uuid, nullable)
    - `current_match_id` (uuid, nullable)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  - `matches` - Chess match records
    - `id` (uuid, primary key)
    - `region` (text)
    - `board_id` (uuid, references boards)
    - `white_user_id` (uuid, references auth.users)
    - `black_user_id` (uuid, references auth.users)
    - `current_fen` (text)
    - `pgn` (text)
    - `status` (text) - playing, white_wins, black_wins, draw, abandoned
    - `winner_user_id` (uuid, nullable)
    - `result` (text)
    - `turn` (text) - w or b
    - `created_at` (timestamptz)
    - `finished_at` (timestamptz, nullable)

  - `match_moves` - Individual moves in matches
    - `id` (uuid, primary key)
    - `match_id` (uuid, references matches)
    - `move_number` (integer)
    - `user_id` (uuid, references auth.users)
    - `from_square` (text)
    - `to_square` (text)
    - `san` (text)
    - `fen_after` (text)
    - `created_at` (timestamptz)

  - `houses` - Purchasable houses/castles
    - `id` (uuid, primary key)
    - `region` (text)
    - `name` (text)
    - `x` (float)
    - `y` (float)
    - `price_trophies` (integer)
    - `owner_user_id` (uuid, nullable, references auth.users)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  - `chat_messages` - Public chat messages per region
    - `id` (uuid, primary key)
    - `region` (text)
    - `user_id` (uuid, references auth.users)
    - `username` (text)
    - `message` (text)
    - `created_at` (timestamptz)

  - `friend_requests` - Friend request system
    - `id` (uuid, primary key)
    - `requester_id` (uuid, references auth.users)
    - `receiver_id` (uuid, references auth.users)
    - `status` (text) - pending, accepted, rejected
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

2. Security
  - RLS enabled on all tables
  - Authenticated users can read/write their own data
  - Shared data (boards, presence, chat) readable by all authenticated users
  - Matches readable by participants and all authenticated users
  - Houses readable by all, purchasable by owner

3. Important Notes
  - profiles.user_id defaults to auth.uid()
  - player_presence.user_id defaults to auth.uid()
  - All timestamps default to now()
  - Boards and houses are pre-seeded via separate migration
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  avatar text DEFAULT 'default',
  current_region text DEFAULT 'europe',
  rating integer DEFAULT 500,
  trophies integer DEFAULT 0,
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  draws integer DEFAULT 0,
  games_played integer DEFAULT 0,
  board_theme text DEFAULT 'classic',
  piece_style text DEFAULT 'classic',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_user_id UNIQUE (user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_profiles" ON profiles;
CREATE POLICY "select_profiles" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Player presence table
CREATE TABLE IF NOT EXISTS player_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  region text NOT NULL DEFAULT 'europe',
  x float DEFAULT 400,
  y float DEFAULT 300,
  status text DEFAULT 'online',
  current_board_id uuid,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_presence_user UNIQUE (user_id)
);

ALTER TABLE player_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_presence" ON player_presence;
CREATE POLICY "select_presence" ON player_presence FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_presence" ON player_presence;
CREATE POLICY "insert_own_presence" ON player_presence FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_presence" ON player_presence;
CREATE POLICY "update_own_presence" ON player_presence FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_presence" ON player_presence;
CREATE POLICY "delete_own_presence" ON player_presence FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Boards table
CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  name text NOT NULL,
  x float NOT NULL,
  y float NOT NULL,
  status text DEFAULT 'free',
  waiting_user_id uuid REFERENCES auth.users(id),
  current_match_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_boards" ON boards;
CREATE POLICY "select_boards" ON boards FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_boards" ON boards;
CREATE POLICY "insert_boards" ON boards FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_boards" ON boards;
CREATE POLICY "update_boards" ON boards FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_boards" ON boards;
CREATE POLICY "delete_boards" ON boards FOR DELETE
  TO authenticated USING (true);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  board_id uuid REFERENCES boards(id),
  white_user_id uuid NOT NULL REFERENCES auth.users(id),
  black_user_id uuid NOT NULL REFERENCES auth.users(id),
  current_fen text DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  pgn text DEFAULT '',
  status text DEFAULT 'playing',
  winner_user_id uuid REFERENCES auth.users(id),
  result text,
  turn text DEFAULT 'w',
  created_at timestamptz DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_matches" ON matches;
CREATE POLICY "select_matches" ON matches FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_matches" ON matches;
CREATE POLICY "insert_matches" ON matches FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_matches" ON matches;
CREATE POLICY "update_matches" ON matches FOR UPDATE
  TO authenticated USING (auth.uid() = white_user_id OR auth.uid() = black_user_id)
  WITH CHECK (auth.uid() = white_user_id OR auth.uid() = black_user_id);

DROP POLICY IF EXISTS "delete_matches" ON matches;
CREATE POLICY "delete_matches" ON matches FOR DELETE
  TO authenticated USING (auth.uid() = white_user_id OR auth.uid() = black_user_id);

-- Match moves table
CREATE TABLE IF NOT EXISTS match_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  move_number integer NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  from_square text NOT NULL,
  to_square text NOT NULL,
  san text NOT NULL,
  fen_after text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE match_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_moves" ON match_moves;
CREATE POLICY "select_moves" ON match_moves FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_moves" ON match_moves;
CREATE POLICY "insert_own_moves" ON match_moves FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_moves" ON match_moves;
CREATE POLICY "update_moves" ON match_moves FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_moves" ON match_moves;
CREATE POLICY "delete_moves" ON match_moves FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Houses table
CREATE TABLE IF NOT EXISTS houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  name text NOT NULL,
  x float NOT NULL,
  y float NOT NULL,
  price_trophies integer NOT NULL DEFAULT 10,
  owner_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_houses" ON houses;
CREATE POLICY "select_houses" ON houses FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_houses" ON houses;
CREATE POLICY "insert_houses" ON houses FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_houses" ON houses;
CREATE POLICY "update_houses" ON houses FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_houses" ON houses;
CREATE POLICY "delete_houses" ON houses FOR DELETE
  TO authenticated USING (true);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  username text NOT NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_chat" ON chat_messages;
CREATE POLICY "select_chat" ON chat_messages FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_chat" ON chat_messages;
CREATE POLICY "insert_own_chat" ON chat_messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_chat" ON chat_messages;
CREATE POLICY "update_chat" ON chat_messages FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_chat" ON chat_messages;
CREATE POLICY "delete_chat" ON chat_messages FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Friend requests table
CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  receiver_id uuid NOT NULL REFERENCES auth.users(id),
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_friend_requests" ON friend_requests;
CREATE POLICY "select_friend_requests" ON friend_requests FOR SELECT
  TO authenticated USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "insert_friend_requests" ON friend_requests;
CREATE POLICY "insert_friend_requests" ON friend_requests FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "update_friend_requests" ON friend_requests;
CREATE POLICY "update_friend_requests" ON friend_requests FOR UPDATE
  TO authenticated USING (auth.uid() = receiver_id) WITH CHECK (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "delete_friend_requests" ON friend_requests;
CREATE POLICY "delete_friend_requests" ON friend_requests FOR DELETE
  TO authenticated USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_presence_region ON player_presence(region);
CREATE INDEX IF NOT EXISTS idx_boards_region ON boards(region);
CREATE INDEX IF NOT EXISTS idx_matches_board ON matches(board_id);
CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(white_user_id, black_user_id);
CREATE INDEX IF NOT EXISTS idx_moves_match ON match_moves(match_id);
CREATE INDEX IF NOT EXISTS idx_houses_region ON houses(region);
CREATE INDEX IF NOT EXISTS idx_chat_region ON chat_messages(region);
CREATE INDEX IF NOT EXISTS idx_friends_users ON friend_requests(requester_id, receiver_id);

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE player_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE boards;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE friend_requests;
