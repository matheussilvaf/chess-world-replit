import { Client, Room } from 'colyseus.js';
import { getColyseusWsUrl, isColyseusConfigured as checkConfigured } from '../../config/colyseus';

export function isColyseusConfigured(): boolean {
  return checkConfigured();
}

export function getColyseusEndpoint(): string {
  return getColyseusWsUrl();
}

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client(getColyseusWsUrl());
  }
  return client;
}

let worldRoom: Room<any> | null = null;
let arenaRoom: Room<any> | null = null;
let activeRoomType: 'world' | 'arena' = 'world';
let joinInProgress: Promise<Room<any>> | null = null;

export function getActiveRoom(): Room<any> | null {
  return activeRoomType === 'arena' ? arenaRoom : worldRoom;
}

export function getActiveRoomType(): 'world' | 'arena' {
  return activeRoomType;
}

export function getWorldRoom(): Room<any> | null {
  return worldRoom;
}

export function getArenaRoom(): Room<any> | null {
  return arenaRoom;
}

export async function joinWorldRoom(options: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}): Promise<Room<any>> {
  if (!isColyseusConfigured()) {
    throw new Error('VITE_COLYSEUS_URL is not configured');
  }

  if (worldRoom) {
    console.log('[Colyseus] Already connected to world, reusing');
    activeRoomType = 'world';
    return worldRoom;
  }

  if (joinInProgress) {
    console.log('[Colyseus] Join already in progress, waiting...');
    return joinInProgress;
  }

  console.log(`[Colyseus] joining world region: ${options.region}`);
  joinInProgress = getClient().joinOrCreate('world', options);

  try {
    const room = await joinInProgress;
    worldRoom = room;
    activeRoomType = 'world';
    console.log(`[Colyseus] world roomId: ${room.roomId}, sessionId: ${room.sessionId}`);
    return room;
  } finally {
    joinInProgress = null;
  }
}

export async function leaveWorldRoom(): Promise<void> {
  joinInProgress = null;
  if (worldRoom) {
    const room = worldRoom;
    worldRoom = null;
    console.log(`[Colyseus] Leaving world room: ${room.roomId}`);
    try {
      await room.leave(true);
    } catch (e) {
      console.warn('[Colyseus] Error leaving world room:', e);
    }
  }
}

export async function joinArenaRoom(options: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}): Promise<Room<any>> {
  if (!isColyseusConfigured()) {
    throw new Error('VITE_COLYSEUS_URL is not configured');
  }

  if (arenaRoom) {
    console.log('[Colyseus] Already connected to arena, reusing');
    activeRoomType = 'arena';
    return arenaRoom;
  }

  console.log(`[Colyseus] joining arena region: ${options.region}`);
  const room = await getClient().joinOrCreate('arena', options);
  arenaRoom = room;
  activeRoomType = 'arena';
  console.log(`[Colyseus] arena roomId: ${room.roomId}, sessionId: ${room.sessionId}`);
  return room;
}

export async function leaveArenaRoom(): Promise<void> {
  if (arenaRoom) {
    const room = arenaRoom;
    arenaRoom = null;
    console.log(`[Colyseus] Leaving arena room: ${room.roomId}`);
    try {
      await room.leave(true);
    } catch (e) {
      console.warn('[Colyseus] Error leaving arena room:', e);
    }
  }
}

export function sendMovement(data: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  isMoving: boolean;
}) {
  getActiveRoom()?.send('move_to', data);
}

export function sendCreateChallenge(data: {
  boardId: string;
  timeCategory: string;
  baseMinutes: number;
  incrementSeconds: number;
  timeLabel: string;
  side?: 'w' | 'b' | 'random';
}) {
  getActiveRoom()?.send('create_challenge', data);
}

export function sendAcceptChallenge(boardId: string) {
  getActiveRoom()?.send('accept_challenge', { boardId });
}

export function sendBoardCancel(boardId: string) {
  getActiveRoom()?.send('cancel_waiting', { boardId });
}

export function sendChessMove(matchId: string, from: string, to: string, promotion?: string) {
  getActiveRoom()?.send('chess_move', { matchId, from, to, promotion });
}

export function sendResign(matchId: string) {
  const room = getActiveRoom();
  console.log(`[Colyseus] sendResign: matchId=${matchId}, activeRoomType=${activeRoomType}, room=${room?.roomId || 'null'}`);
  if (!room) {
    console.error('[Colyseus] sendResign: no active room available!');
    return;
  }
  room.send('chess_resign', { matchId });
}

export function sendDrawOffer(matchId: string) {
  getActiveRoom()?.send('chess_draw_offer', { matchId });
}

export function sendDrawAccept(matchId: string) {
  getActiveRoom()?.send('chess_draw_accept', { matchId });
}

export function sendChat(message: string) {
  getActiveRoom()?.send('chat', { message });
}

export function sendSitSpectator(boardId: string, seatKey: string) {
  getActiveRoom()?.send('sit_spectator', { boardId, seatKey });
}

export function sendLeaveSeat(boardId: string) {
  getActiveRoom()?.send('leave_seat', { boardId });
}

export function registerBoards(boards: { id: string; name: string; x: number; y: number; width?: number; height?: number }[]) {
  getActiveRoom()?.send('register_boards', { boards });
}
