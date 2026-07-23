export type Direction = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';

export interface PlayerState {
  id: string;
  socketId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: Direction;
  isMoving: boolean;
  currentBoardId?: string;
}

export interface BoardState {
  id: string;
  name: string;
  region: string;
  x: number;
  y: number;
  status: 'idle' | 'waiting' | 'playing';
  waitingPlayerId?: string;
  waitingPlayerName?: string;
  whitePlayerId?: string;
  blackPlayerId?: string;
  matchId?: string;
}

export interface MatchState {
  id: string;
  boardId: string;
  region: string;
  whitePlayerId: string;
  blackPlayerId: string;
  fen: string;
  pgn: string;
  status: 'playing' | 'finished';
  turn: 'w' | 'b';
}

export interface ChatMessagePayload {
  id: string;
  region: string;
  playerId: string;
  username: string;
  message: string;
  createdAt: string;
}

// Client -> Server events
export interface ClientToServerEvents {
  join_world: (payload: {
    playerId: string;
    username: string;
    rating: number;
    region: string;
    x: number;
    y: number;
  }) => void;
  leave_world: () => void;
  movement_target: (payload: {
    playerId: string;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    direction: Direction;
    isMoving: boolean;
  }) => void;
  register_boards: (payload: {
    region: string;
    boards: { id: string; name: string; x: number; y: number }[];
  }) => void;
  board_join_request: (payload: {
    playerId: string;
    boardId: string;
    playerName: string;
    region: string;
  }) => void;
  board_cancel_waiting: (payload: {
    playerId: string;
    boardId: string;
  }) => void;
  chess_move: (payload: {
    matchId: string;
    playerId: string;
    from: string;
    to: string;
    promotion?: string;
  }) => void;
  chess_resign: (payload: {
    matchId: string;
    playerId: string;
  }) => void;
  chess_draw_offer: (payload: {
    matchId: string;
    playerId: string;
  }) => void;
  chess_draw_accept: (payload: {
    matchId: string;
    playerId: string;
  }) => void;
  chess_draw_decline: (payload: {
    matchId: string;
    playerId: string;
  }) => void;
  chat_message: (payload: {
    region: string;
    playerId: string;
    username: string;
    message: string;
  }) => void;
  voice_join: (payload: { region: string; playerId: string }) => void;
  voice_leave: (payload: { region: string; playerId: string }) => void;
  voice_offer: (payload: { targetId: string; sdp: any }) => void;
  voice_answer: (payload: { targetId: string; sdp: any }) => void;
  voice_ice_candidate: (payload: { targetId: string; candidate: any }) => void;
}

// Server -> Client events
export interface ServerToClientEvents {
  world_state: (payload: {
    players: PlayerState[];
    boards: BoardState[];
  }) => void;
  player_joined: (player: PlayerState) => void;
  player_left: (payload: { playerId: string }) => void;
  player_snapshot: (players: PlayerState[]) => void;
  board_state_update: (board: BoardState) => void;
  board_waiting: (payload: { boardId: string; waitingPlayerId: string; waitingPlayerName: string }) => void;
  match_started: (match: MatchState) => void;
  chess_state_update: (payload: { matchId: string; fen: string; pgn: string; turn: 'w' | 'b' }) => void;
  chess_match_finished: (payload: { matchId: string; winnerId: string | null; reason: string }) => void;
  chess_draw_offered: (payload: { matchId: string; offeredBy: string }) => void;
  chat_message: (msg: ChatMessagePayload) => void;
  error: (payload: { message: string }) => void;
  voice_offer: (payload: { fromId: string; sdp: any }) => void;
  voice_answer: (payload: { fromId: string; sdp: any }) => void;
  voice_ice_candidate: (payload: { fromId: string; candidate: any }) => void;
}
