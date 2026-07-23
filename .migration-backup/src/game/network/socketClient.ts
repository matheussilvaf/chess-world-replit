import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from './types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  autoConnect: false,
});

socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('[Socket] Disconnected:', reason);
});

socket.on('connect_error', (err) => {
  console.error('[Socket] Connection error:', err.message);
});

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
    console.log('[Socket] Connecting via proxy...');
  }
  return socket;
}

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
}

export function joinWorld(payload: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}) {
  socket.emit('join_world', payload);
  console.log('[Socket] join_world sent', payload);
}

export function sendMovementTarget(payload: {
  playerId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: 'up' | 'down' | 'left' | 'right';
  isMoving: boolean;
}) {
  socket.emit('movement_target', payload);
}

export function registerBoards(payload: {
  region: string;
  boards: { id: string; name: string; x: number; y: number }[];
}) {
  socket.emit('register_boards', payload);
  console.log('[Socket] register_boards sent', payload.boards.length, 'boards');
}

export function requestJoinBoard(payload: {
  playerId: string;
  boardId: string;
  playerName: string;
  region: string;
}) {
  socket.emit('board_join_request', payload);
  console.log('[Socket] board_join_request sent', payload);
}

export function cancelBoardWaiting(payload: { playerId: string; boardId: string }) {
  socket.emit('board_cancel_waiting', payload);
  console.log('[Socket] board_cancel_waiting sent', payload);
}

export function sendChessMove(payload: {
  matchId: string;
  playerId: string;
  from: string;
  to: string;
  promotion?: string;
}) {
  socket.emit('chess_move', payload);
}

export function sendResign(payload: { matchId: string; playerId: string }) {
  socket.emit('chess_resign', payload);
}

export function sendDrawOffer(payload: { matchId: string; playerId: string }) {
  socket.emit('chess_draw_offer', payload);
}

export function sendDrawAccept(payload: { matchId: string; playerId: string }) {
  socket.emit('chess_draw_accept', payload);
}

export function sendDrawDecline(payload: { matchId: string; playerId: string }) {
  socket.emit('chess_draw_decline', payload);
}

export function sendChatMessage(payload: {
  region: string;
  playerId: string;
  username: string;
  message: string;
}) {
  socket.emit('chat_message', payload);
  console.log('[Socket] chat_message sent');
}
