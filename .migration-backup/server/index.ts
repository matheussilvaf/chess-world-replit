import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Chess } from 'chess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3001;
//cute
// ─── Types ──────────────────────────────────────────────────────

type Direction = 'up' | 'down' | 'left' | 'right';

interface PlayerState {
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

interface BoardState {
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

interface MatchState {
  id: string;
  boardId: string;
  region: string;
  whitePlayerId: string;
  blackPlayerId: string;
  fen: string;
  pgn: string;
  status: 'playing' | 'finished';
  turn: 'w' | 'b';
  game: Chess;
}

// ─── State ──────────────────────────────────────────────────────

const players = new Map<string, PlayerState>();
const boards = new Map<string, BoardState>();
const matches = new Map<string, MatchState>();
const socketToPlayer = new Map<string, string>();

const SERVER_TICK_RATE = 20;

// ─── Server Setup ───────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

// ─── Tick loop ──────────────────────────────────────────────────

function serverTick() {
  const regions = new Set<string>();
  players.forEach(p => regions.add(p.region));

  regions.forEach(region => {
    const regionPlayers: PlayerState[] = [];
    players.forEach(p => { if (p.region === region) regionPlayers.push(p); });
    if (regionPlayers.length > 0) {
      io.to(region).emit('player_snapshot', regionPlayers);
    }
  });
}

setInterval(serverTick, 1000 / SERVER_TICK_RATE);

// ─── Socket Handlers ────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Server] Client connected: ${socket.id}`);

  socket.on('join_world', (payload) => {
    const { playerId, username, rating, region, x, y } = payload;

    const player: PlayerState = {
      id: playerId,
      socketId: socket.id,
      username,
      rating,
      region,
      x, y,
      targetX: x,
      targetY: y,
      direction: 'down',
      isMoving: false,
    };

    players.set(playerId, player);
    socketToPlayer.set(socket.id, playerId);
    socket.join(region);

    const regionPlayers: PlayerState[] = [];
    players.forEach(p => { if (p.region === region && p.id !== playerId) regionPlayers.push(p); });

    const regionBoards: BoardState[] = [];
    boards.forEach(b => { if (b.region === region) regionBoards.push(b); });

    socket.emit('world_state', { players: regionPlayers, boards: regionBoards });
    socket.to(region).emit('player_joined', player);

    console.log(`[Server] ${username} joined ${region} (${regionPlayers.length + 1} players online)`);
  });

  socket.on('leave_world', () => {
    handleDisconnect(socket.id);
  });

  socket.on('movement_target', (payload) => {
    const player = players.get(payload.playerId);
    if (!player) return;

    player.x = payload.x;
    player.y = payload.y;
    player.targetX = payload.targetX;
    player.targetY = payload.targetY;
    player.direction = payload.direction;
    player.isMoving = payload.isMoving;
  });

  socket.on('register_boards', (payload) => {
    const { region, boards: boardList } = payload;
    boardList.forEach(b => {
      if (!boards.has(b.id)) {
        boards.set(b.id, {
          id: b.id,
          name: b.name,
          region,
          x: b.x,
          y: b.y,
          status: 'idle',
        });
      }
    });
    console.log(`[Server] Registered ${boardList.length} boards in ${region}`);
  });

  socket.on('board_join_request', (payload) => {
    const { playerId, boardId, playerName, region } = payload;
    const board = boards.get(boardId);

    if (!board) {
      socket.emit('error', { message: 'Board not found' });
      return;
    }

    if (board.status === 'idle') {
      board.status = 'waiting';
      board.waitingPlayerId = playerId;
      board.waitingPlayerName = playerName;
      io.to(region).emit('board_state_update', board);
      io.to(region).emit('board_waiting', { boardId, waitingPlayerId: playerId, waitingPlayerName: playerName });
      console.log(`[Server] ${playerName} waiting at board ${boardId}`);
    } else if (board.status === 'waiting') {
      if (board.waitingPlayerId === playerId) {
        socket.emit('error', { message: 'You are already waiting here' });
        return;
      }
      const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const chess = new Chess();
      const match: MatchState = {
        id: matchId,
        boardId,
        region,
        whitePlayerId: board.waitingPlayerId!,
        blackPlayerId: playerId,
        fen: chess.fen(),
        pgn: '',
        status: 'playing',
        turn: 'w',
        game: chess,
      };
      matches.set(matchId, match);

      board.status = 'playing';
      board.whitePlayerId = board.waitingPlayerId;
      board.blackPlayerId = playerId;
      board.matchId = matchId;
      board.waitingPlayerId = undefined;
      board.waitingPlayerName = undefined;

      const matchPayload = { id: matchId, boardId, region, whitePlayerId: match.whitePlayerId, blackPlayerId: match.blackPlayerId, fen: match.fen, pgn: '', status: 'playing' as const, turn: 'w' as const };
      const whitePlayer = players.get(match.whitePlayerId);
      const blackPlayer = players.get(match.blackPlayerId);
      if (whitePlayer) io.to(whitePlayer.socketId).emit('match_started', matchPayload);
      if (blackPlayer) io.to(blackPlayer.socketId).emit('match_started', matchPayload);

      io.to(region).emit('board_state_update', { ...board });
      console.log(`[Server] Match started: ${matchId} (white: ${match.whitePlayerId}, black: ${playerId})`);
    } else {
      socket.emit('error', { message: 'Board already in match' });
    }
  });

  socket.on('board_cancel_waiting', (payload) => {
    const { playerId, boardId } = payload;
    const board = boards.get(boardId);
    if (!board || board.waitingPlayerId !== playerId) return;

    board.status = 'idle';
    board.waitingPlayerId = undefined;
    board.waitingPlayerName = undefined;
    io.to(board.region).emit('board_state_update', board);
    console.log(`[Server] Player ${playerId} left board ${boardId}`);
  });

  socket.on('chess_move', (payload) => {
    const { matchId, playerId, from, to, promotion } = payload;
    const match = matches.get(matchId);
    if (!match || match.status !== 'playing') {
      socket.emit('error', { message: 'Match not found or already finished' });
      return;
    }

    const isWhite = match.whitePlayerId === playerId;
    const isBlack = match.blackPlayerId === playerId;
    if (!isWhite && !isBlack) return;
    if ((match.turn === 'w' && !isWhite) || (match.turn === 'b' && !isBlack)) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    const moveResult = match.game.move({ from, to, promotion: promotion || 'q' });
    if (!moveResult) {
      socket.emit('error', { message: 'Invalid move' });
      return;
    }

    match.fen = match.game.fen();
    match.pgn = match.game.pgn();
    match.turn = match.game.turn() as 'w' | 'b';

    if (match.game.isGameOver()) {
      match.status = 'finished';
      let winnerId: string | null = null;
      let reason = 'draw';

      if (match.game.isCheckmate()) {
        winnerId = match.turn === 'w' ? match.blackPlayerId : match.whitePlayerId;
        reason = 'checkmate';
      } else if (match.game.isStalemate()) {
        reason = 'stalemate';
      } else if (match.game.isThreefoldRepetition()) {
        reason = 'repetition';
      } else if (match.game.isInsufficientMaterial()) {
        reason = 'insufficient_material';
      }

      finishMatch(matchId, winnerId, reason);
      return;
    }

    const statePayload = { matchId, fen: match.fen, pgn: match.pgn, turn: match.turn };
    const wp = players.get(match.whitePlayerId);
    const bp = players.get(match.blackPlayerId);
    if (wp) io.to(wp.socketId).emit('chess_state_update', statePayload);
    if (bp) io.to(bp.socketId).emit('chess_state_update', statePayload);
  });

  socket.on('chess_resign', (payload) => {
    const { matchId, playerId } = payload;
    const match = matches.get(matchId);
    if (!match || match.status !== 'playing') return;

    const winnerId = playerId === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
    finishMatch(matchId, winnerId, 'resign');
  });

  socket.on('chess_draw_offer', (payload) => {
    const { matchId, playerId } = payload;
    const match = matches.get(matchId);
    if (!match || match.status !== 'playing') return;

    const opponentId = playerId === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
    const opponent = players.get(opponentId);
    if (opponent) {
      io.to(opponent.socketId).emit('chess_draw_offered', { matchId, offeredBy: playerId });
    }
  });

  socket.on('chess_draw_accept', (payload) => {
    const { matchId } = payload;
    finishMatch(matchId, null, 'draw_agreement');
  });

  socket.on('chess_draw_decline', (payload) => {
    const { matchId, playerId } = payload;
    const match = matches.get(matchId);
    if (!match) return;
    const offererId = playerId === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
    const offerer = players.get(offererId);
    if (offerer) {
      io.to(offerer.socketId).emit('error', { message: 'Draw offer declined' });
    }
  });

  socket.on('chat_message', (payload) => {
    const { region, playerId, username, message } = payload;
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      region,
      playerId,
      username,
      message,
      createdAt: new Date().toISOString(),
    };
    io.to(region).emit('chat_message', msg);
  });

  socket.on('voice_join', (payload) => { socket.to(payload.region).emit('player_joined', players.get(payload.playerId)!); });
  socket.on('voice_offer', (payload) => { const target = findSocketByPlayerId(payload.targetId); if (target) io.to(target).emit('voice_offer', { fromId: socketToPlayer.get(socket.id)!, sdp: payload.sdp }); });
  socket.on('voice_answer', (payload) => { const target = findSocketByPlayerId(payload.targetId); if (target) io.to(target).emit('voice_answer', { fromId: socketToPlayer.get(socket.id)!, sdp: payload.sdp }); });
  socket.on('voice_ice_candidate', (payload) => { const target = findSocketByPlayerId(payload.targetId); if (target) io.to(target).emit('voice_ice_candidate', { fromId: socketToPlayer.get(socket.id)!, candidate: payload.candidate }); });

  socket.on('disconnect', () => {
    handleDisconnect(socket.id);
  });
});

// ─── Helpers ────────────────────────────────────────────────────

function handleDisconnect(socketId: string) {
  const playerId = socketToPlayer.get(socketId);
  if (!playerId) return;

  const player = players.get(playerId);
  if (player) {
    io.to(player.region).emit('player_left', { playerId });

    boards.forEach(board => {
      if (board.waitingPlayerId === playerId) {
        board.status = 'idle';
        board.waitingPlayerId = undefined;
        board.waitingPlayerName = undefined;
        io.to(board.region).emit('board_state_update', board);
      }
    });

    console.log(`[Server] ${player.username} disconnected from ${player.region}`);
  }

  players.delete(playerId);
  socketToPlayer.delete(socketId);
}

function finishMatch(matchId: string, winnerId: string | null, reason: string) {
  const match = matches.get(matchId);
  if (!match) return;

  match.status = 'finished';

  const finishPayload = { matchId, winnerId, reason };
  const wp = players.get(match.whitePlayerId);
  const bp = players.get(match.blackPlayerId);
  if (wp) io.to(wp.socketId).emit('chess_match_finished', finishPayload);
  if (bp) io.to(bp.socketId).emit('chess_match_finished', finishPayload);

  const board = boards.get(match.boardId);
  if (board) {
    board.status = 'idle';
    board.whitePlayerId = undefined;
    board.blackPlayerId = undefined;
    board.matchId = undefined;
    io.to(board.region).emit('board_state_update', board);
  }

  matches.delete(matchId);
  console.log(`[Server] Match ${matchId} finished: ${reason} (winner: ${winnerId || 'none'})`);
}

function findSocketByPlayerId(playerId: string): string | undefined {
  const player = players.get(playerId);
  return player?.socketId;
}

// ─── Frontend Serving (Dev + Prod) ──────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, players: players.size, boards: boards.size, matches: matches.size });
});

async function setupFrontend() {
  const root = path.resolve(__dirname, '..');

  if (isProd) {
    const distPath = path.resolve(root, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`[Server] Production mode - serving static files from ${distPath}`);
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use(async (req, res) => {
      const url = req.originalUrl || '/';
      const htmlPath = path.resolve(root, 'index.html');
      let html = fs.readFileSync(htmlPath, 'utf-8');
      html = await vite.transformIndexHtml(url, html);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    });
    console.log(`[Server] Development mode - Vite HMR active`);
  }
}

// ─── Start ──────────────────────────────────────────────────────

setupFrontend().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT} (${isProd ? 'production' : 'development'})`);
    console.log(`[Server] Socket.IO ready on /socket.io`);
    console.log(`[Server] Tick rate: ${SERVER_TICK_RATE} Hz`);
  });
});
