import { Room, Client } from '@colyseus/core';
import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { WorldState } from '../schemas/WorldState.js';
import { PlayerState } from '../schemas/PlayerState.js';
import { BoardState } from '../schemas/BoardState.js';
import { MatchState } from '../schemas/MatchState.js';
import { VoiceParticipantState } from '../schemas/VoiceParticipantState.js';
import * as coordinator from '../tournament/coordinator.js';
import type { TournamentMatchCreateParams, TournamentMatchFinishParams, PendingPairing } from '../tournament/coordinator.js';

interface JoinOptions {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}

const activeGames = new Map<string, Chess>();

export class WorldRoom extends Room<WorldState> {
  private readonly TICK_RATE = 20;

  onCreate(options: any) {
    this.setState(new WorldState());
    this.setSimulationInterval(() => this.tick(), 1000 / this.TICK_RATE);
    this.maxClients = 100;

    coordinator.setWorldRoomInstance(this);

    console.log(`[WorldRoom] Created for region: ${options.region || 'unknown'} | roomId: ${this.roomId}`);

    this.onMessage('move_to', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = data.x;
      player.y = data.y;
      player.targetX = data.targetX;
      player.targetY = data.targetY;
      player.direction = data.direction;
      player.isMoving = data.isMoving;
    });

    this.onMessage('register_boards', (client, data) => {
      const { boards } = data as { boards: { id: string; name: string; x: number; y: number; width?: number; height?: number }[] };
      let registered = 0;
      for (const b of boards) {
        if (!this.state.boards.has(b.id)) {
          const board = new BoardState();
          board.id = b.id;
          board.name = b.name;
          board.x = b.x;
          board.y = b.y;
          board.width = b.width || 80;
          board.height = b.height || 80;
          board.status = 'idle';
          this.state.boards.set(b.id, board);
          registered++;
        }
      }
      if (registered > 0) {
        console.log(`[WorldRoom] Boards registered: ${registered} (total: ${this.state.boards.size})`);
      }
    });

    this.onMessage('create_challenge', (client, data) => {
      const { boardId, timeCategory, baseMinutes, incrementSeconds, timeLabel, side } = data as {
        boardId: string; timeCategory: string; baseMinutes: number; incrementSeconds: number; timeLabel: string; side?: 'w' | 'b' | 'random';
      };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.status !== 'idle') {
        client.send('error', { message: 'Board not available' });
        return;
      }

      // Determine which color the challenger wants
      let challengerColor: 'w' | 'b';
      if (side === 'b') {
        challengerColor = 'b';
      } else if (side === 'w') {
        challengerColor = 'w';
      } else {
        challengerColor = Math.random() < 0.5 ? 'w' : 'b';
      }

      board.status = 'waiting';
      board.waitingPlayerId = player.id;
      board.waitingPlayerName = player.username;
      board.timeCategory = timeCategory;
      board.baseMinutes = baseMinutes;
      board.incrementSeconds = incrementSeconds;
      board.timeLabel = timeLabel;
      board.whitePlayerId = challengerColor === 'w' ? player.id : '';
      board.blackPlayerId = challengerColor === 'b' ? player.id : '';
      player.currentBoardId = boardId;

      client.send('challenge_created', {
        boardId,
        color: challengerColor,
        seat: challengerColor === 'w' ? 'bottom' : 'top',
      });
    });

    this.onMessage('accept_challenge', (client, data) => {
      const { boardId } = data as { boardId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.status !== 'waiting') {
        client.send('error', { message: 'No challenge to accept' });
        return;
      }

      if (board.waitingPlayerId === player.id) {
        client.send('error', { message: 'Cannot accept your own challenge' });
        return;
      }

      this.startMatch(board, player, client);
    });

    this.onMessage('cancel_waiting', (client, data) => {
      const { boardId } = data as { boardId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.waitingPlayerId !== player.id) return;

      this.resetBoard(board);
      player.currentBoardId = '';

      client.send('challenge_cancelled', { boardId });
    });

    this.onMessage('sit_spectator', (client, data) => {
      const { boardId, seatKey } = data as { boardId: string; seatKey: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board) return;

      // Check if seat is already taken
      const spectators = this.getSpectators(boardId);
      if (spectators.has(seatKey)) {
        client.send('error', { message: 'Spectator seat is taken' });
        return;
      }

      // Max 4 physical spectator seats
      if (spectators.size >= 4) {
        client.send('error', { message: 'All spectator seats are full' });
        return;
      }

      player.currentBoardId = boardId;
      client.send('spectator_seated', { boardId, seatKey });
    });

    this.onMessage('leave_seat', (client, data) => {
      const { boardId } = data as { boardId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // If player is a match participant, they can't just leave
      const board = this.state.boards.get(boardId);
      if (board && board.status === 'playing') {
        const match = this.state.matches.get(board.matchId);
        if (match && (match.whitePlayerId === player.id || match.blackPlayerId === player.id)) {
          client.send('error', { message: 'Cannot leave during an active match. Resign first.' });
          return;
        }
      }

      player.currentBoardId = '';
      client.send('seat_left', { boardId });
    });

    this.onMessage('chess_move', (client, data) => {
      const { matchId, from, to, promotion } = data as { matchId: string; from: string; to: string; promotion?: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const game = activeGames.get(matchId);
      if (!game) return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;
      if ((match.turn === 'w' && !isWhite) || (match.turn === 'b' && !isBlack)) {
        client.send('error', { message: 'Not your turn' });
        return;
      }

      const moveResult = game.move({ from, to, promotion: promotion || 'q' });
      if (!moveResult) {
        client.send('error', { message: 'Invalid move' });
        return;
      }

      const now = Date.now();
      const elapsed = now - match.lastMoveAt;

      if (match.turn === 'w') {
        match.whiteTimeMs = Math.max(0, match.whiteTimeMs - elapsed + match.incrementMs);
      } else {
        match.blackTimeMs = Math.max(0, match.blackTimeMs - elapsed + match.incrementMs);
      }

      match.fen = game.fen();
      match.pgn = game.pgn();
      match.turn = game.turn();
      match.lastMoveAt = now;
      match.lastMoveSan = moveResult.san;
      match.lastMoveFrom = moveResult.from;
      match.lastMoveTo = moveResult.to;

      if (game.isGameOver()) {
        this.endMatch(matchId, game);
      }
    });

    this.onMessage('chess_resign', async (client, data) => {
      const { matchId } = data as { matchId: string };
      console.log(`[WorldRoom] chess_resign received from ${client.sessionId} for match ${matchId}`);
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        console.log(`[WorldRoom] chess_resign: player not found for session ${client.sessionId}`);
        return;
      }

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') {
        console.log(`[WorldRoom] chess_resign: match not found or not playing. match=${!!match}, status=${match?.status}`);
        return;
      }

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) {
        console.log(`[WorldRoom] chess_resign: player ${player.id} is not a participant in match ${matchId}`);
        return;
      }

      match.status = 'finished';
      match.result = 'resign';
      match.winnerId = isWhite ? match.blackPlayerId : match.whitePlayerId;
      activeGames.delete(matchId);

      await this.broadcastMatchEnd(match);
      this.cleanupMatchBoard(match);

      this.state.matches.delete(matchId);
      console.log(`[WorldRoom] chess_resign: match ${matchId} finished and removed from state`);
    });

    this.onMessage('chess_draw_offer', (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;

      const opponentId = isWhite ? match.blackPlayerId : match.whitePlayerId;
      const opponentSession = this.findSessionByPlayerId(opponentId);
      if (opponentSession) {
        const opponentClient = this.clients.find(c => c.sessionId === opponentSession);
        opponentClient?.send('draw_offered', { matchId, offeredBy: player.username });
      }
    });

    this.onMessage('chess_draw_accept', async (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;

      match.status = 'finished';
      match.result = 'draw';
      match.winnerId = '';
      activeGames.delete(matchId);

      await this.broadcastMatchEnd(match);
      this.cleanupMatchBoard(match);
    });

    this.onMessage('chat', (client, data) => {
      const { message } = data as { message: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      this.broadcast('chat', {
        id: nanoid(),
        playerId: player.id,
        username: player.username,
        message,
        createdAt: new Date().toISOString(),
      });
    });

    this.onMessage('voice_joined', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (this.state.voiceParticipants.has(client.sessionId)) return;

      const vp = new VoiceParticipantState();
      vp.sessionId = client.sessionId;
      vp.playerId = player.id;
      vp.username = player.username;
      vp.region = player.region;
      vp.joinedAt = Date.now();
      vp.muted = false;
      this.state.voiceParticipants.set(client.sessionId, vp);
      console.log(`[WorldRoom] Voice joined: ${player.username} | total voice: ${this.state.voiceParticipants.size}`);
    });

    this.onMessage('voice_left', (client) => {
      this.state.voiceParticipants.delete(client.sessionId);
    });

    this.onMessage('voice_muted_changed', (client, data) => {
      const { muted } = data as { muted: boolean };
      const vp = this.state.voiceParticipants.get(client.sessionId);
      if (vp) vp.muted = muted;
    });

    // Tournament match: when a player receives a pairing, they send this to join their assigned board
    this.onMessage('tournament_seat', (client, data) => {
      const { boardId, baseTimeSeconds, incrementSeconds, timeCategory, timeLabel, opponentId, color } = data as {
        boardId: string;
        baseTimeSeconds: number;
        incrementSeconds: number;
        timeCategory: string;
        timeLabel: string;
        opponentId: string;
        color: 'w' | 'b';
      };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Register board if not exists
      if (!this.state.boards.has(boardId)) {
        const board = new BoardState();
        board.id = boardId;
        board.name = `Tournament Board ${boardId}`;
        board.x = 0;
        board.y = 0;
        board.width = 80;
        board.height = 80;
        board.status = 'idle';
        this.state.boards.set(boardId, board);
      }

      const board = this.state.boards.get(boardId)!;

      // If board is already playing a match, just confirm to player
      if (board.status === 'playing' && board.matchId) {
        const match = this.state.matches.get(board.matchId);
        if (match && (match.whitePlayerId === player.id || match.blackPlayerId === player.id)) {
          const myColor = match.whitePlayerId === player.id ? 'w' : 'b';
          const seat = myColor === 'w' ? 'bottom' : 'top';
          client.send('tournament_seated', { boardId, color: myColor, seat });
          client.send('match_started', { matchId: board.matchId, boardId, color: myColor });
          return;
        }
      }

      // First player: set up as waiting
      if (board.status === 'idle') {
        board.status = 'waiting';
        board.waitingPlayerId = player.id;
        board.waitingPlayerName = player.username;
        board.timeCategory = timeCategory;
        board.baseMinutes = baseTimeSeconds / 60;
        board.incrementSeconds = incrementSeconds;
        board.timeLabel = timeLabel;
        if (color === 'w') {
          board.whitePlayerId = player.id;
          board.blackPlayerId = '';
        } else {
          board.blackPlayerId = player.id;
          board.whitePlayerId = '';
        }
        player.currentBoardId = boardId;

        const seat = color === 'w' ? 'bottom' : 'top';
        client.send('tournament_seated', { boardId, color, seat });
        return;
      }

      // Second player: start the match
      if (board.status === 'waiting' && board.waitingPlayerId !== player.id) {
        player.currentBoardId = boardId;

        // Send tournament_seated to the second player (joiner)
        const joinerColor = board.whitePlayerId ? 'b' : 'w';
        const joinerSeat = joinerColor === 'w' ? 'bottom' : 'top';
        client.send('tournament_seated', { boardId, color: joinerColor, seat: joinerSeat });

        // Also confirm the first player (challenger) with tournament_seated
        const challengerSession = this.findSessionByPlayerId(board.waitingPlayerId);
        if (challengerSession) {
          const challengerClient = this.clients.find(c => c.sessionId === challengerSession);
          const challengerColor = board.whitePlayerId === board.waitingPlayerId ? 'w' : 'b';
          const challengerSeat = challengerColor === 'w' ? 'bottom' : 'top';
          challengerClient?.send('tournament_seated', { boardId, color: challengerColor, seat: challengerSeat });
        }

        this.startMatch(board, player, client);
        return;
      }

      // Already waiting as the same player
      if (board.status === 'waiting' && board.waitingPlayerId === player.id) {
        const seat = color === 'w' ? 'bottom' : 'top';
        client.send('tournament_seated', { boardId, color, seat });
      }
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    const playerId = options.playerId || client.sessionId;

    // Kick existing session for same player (stale connection / reconnect)
    this.state.players.forEach((existing, existingSessionId) => {
      if (existing.id === playerId && existingSessionId !== client.sessionId) {
        console.log(`[WorldRoom] Duplicate player ${playerId}, removing stale session: ${existingSessionId}`);
        this.state.voiceParticipants.delete(existingSessionId);
        this.state.players.delete(existingSessionId);
        const staleClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (staleClient) {
          staleClient.leave();
        }
      }
    });

    const player = new PlayerState();
    player.id = playerId;
    player.sessionId = client.sessionId;
    player.username = options.username || 'Anonymous';
    player.rating = options.rating || 1200;
    player.region = options.region || 'default';
    player.x = options.x || 1273;
    player.y = options.y || 926;
    player.targetX = player.x;
    player.targetY = player.y;
    player.direction = 'down';
    player.isMoving = false;

    this.state.players.set(client.sessionId, player);
    console.log(`[WorldRoom] Player joined: ${player.username} (${client.sessionId}) | total: ${this.state.players.size}`);

    // If this player had an active match (reconnection), send match info
    this.state.matches.forEach((match, matchId) => {
      if (match.status !== 'playing') return;
      if (match.whitePlayerId === playerId) {
        client.send('match_started', { matchId, boardId: match.boardId, color: 'w' });
      } else if (match.blackPlayerId === playerId) {
        client.send('match_started', { matchId, boardId: match.boardId, color: 'b' });
      }
    });
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`[WorldRoom] Player leaving: ${player.username} (${client.sessionId}) | consented: ${consented}`);

      this.state.boards.forEach((board) => {
        if (board.waitingPlayerId === player.id) {
          this.resetBoard(board);
        }
      });

      const abandonedMatches: MatchState[] = [];
      const matchEntries: [string, MatchState][] = [];
      this.state.matches.forEach((match, matchId) => matchEntries.push([matchId, match]));
      for (const [matchId, match] of matchEntries) {
        if (match.status === 'playing') {
          const isWhite = match.whitePlayerId === player.id;
          const isBlack = match.blackPlayerId === player.id;
          if (isWhite || isBlack) {
            match.status = 'finished';
            match.result = 'abandon';
            match.winnerId = isWhite ? match.blackPlayerId : match.whitePlayerId;
            activeGames.delete(matchId);
            await this.broadcastMatchEnd(match);
            this.cleanupMatchBoard(match);
            abandonedMatches.push(match);
          }
        }
      }

      for (const match of abandonedMatches) {
        this.state.matches.delete(match.id);
      }

      this.state.voiceParticipants.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      console.log(`[WorldRoom] Player removed: ${player.username} | remaining: ${this.state.players.size}`);
    }
  }

  onDispose() {
    activeGames.clear();
    coordinator.setWorldRoomInstance(null);
  }

  isBoardPlaying(boardId: string): boolean {
    let playing = false;
    this.state.matches.forEach((match) => {
      if (match.boardId === boardId && match.status === 'playing') {
        playing = true;
      }
    });
    return playing;
  }

  private async tick() {
    const now = Date.now();
    const timedOutMatches: MatchState[] = [];
    const entries: [string, MatchState][] = [];
    this.state.matches.forEach((match, matchId) => entries.push([matchId, match]));
    for (const [matchId, match] of entries) {
      if (match.status !== 'playing') continue;

      const elapsed = now - match.lastMoveAt;
      if (match.turn === 'w') {
        if (match.whiteTimeMs - elapsed <= 0) {
          match.whiteTimeMs = 0;
          match.status = 'finished';
          match.result = 'timeout';
          match.winnerId = match.blackPlayerId;
          activeGames.delete(matchId);
          await this.broadcastMatchEnd(match);
          this.cleanupMatchBoard(match);
          timedOutMatches.push(match);
        }
      } else {
        if (match.blackTimeMs - elapsed <= 0) {
          match.blackTimeMs = 0;
          match.status = 'finished';
          match.result = 'timeout';
          match.winnerId = match.whitePlayerId;
          activeGames.delete(matchId);
          await this.broadcastMatchEnd(match);
          this.cleanupMatchBoard(match);
          timedOutMatches.push(match);
        }
      }
    }
    for (const match of timedOutMatches) {
      this.state.matches.delete(match.id);
    }
  }

  private resetBoard(board: BoardState) {
    board.status = 'idle';
    board.waitingPlayerId = '';
    board.waitingPlayerName = '';
    board.timeCategory = '';
    board.baseMinutes = 0;
    board.incrementSeconds = 0;
    board.timeLabel = '';
    board.whitePlayerId = '';
    board.blackPlayerId = '';
    board.matchId = '';
  }

  private cleanupMatchBoard(match: MatchState) {
    const board = this.state.boards.get(match.boardId);
    if (board) {
      this.resetBoard(board);
    }

    // Clear currentBoardId for participants
    this.state.players.forEach((p) => {
      if (p.currentBoardId === match.boardId) {
        p.currentBoardId = '';
      }
    });
  }

  private async broadcastMatchEnd(match: MatchState): Promise<void> {
    this.broadcast('match_finished', {
      matchId: match.id,
      boardId: match.boardId,
      result: match.result,
      winnerId: match.winnerId,
    });
    await this.reportTournamentResult(match);
  }

  private async reportTournamentResult(match: MatchState) {
    const boardId = match.boardId;
    if (!boardId || !boardId.includes('_table_')) {
      console.log(`[WorldRoom] Not a tournament board: ${boardId}`);
      return;
    }

    try {
      let result: string;
      if (match.result === 'checkmate' || match.result === 'resign' || match.result === 'timeout' || match.result === 'abandon') {
        if (match.winnerId === match.whitePlayerId) {
          result = '1-0';
        } else if (match.winnerId === match.blackPlayerId) {
          result = '0-1';
        } else {
          result = '1/2-1/2';
        }
      } else {
        result = '1/2-1/2';
      }

      const pairing: PendingPairing | null = await coordinator.reportMatchResultByRuntimeTableId(
        boardId,
        result,
        match.result || 'normal',
      );

      if (!pairing) {
        console.error(`[WorldRoom] No pending pairing found for match: id=${match.id} boardId=${boardId} white=${match.whitePlayerId} black=${match.blackPlayerId}`);
        return;
      }

      console.log(`[WorldRoom] Tournament result reported: board ${pairing.boardNumber} = ${result} (${match.result}), updated=${pairing.updated}`);

      // Persist finished match state to database
      const finishParams: TournamentMatchFinishParams = {
        colyseusMatchId: match.id,
        status: 'finished',
        result: match.result || 'draw',
        tournamentScore: result,
        winnerId: match.winnerId || null,
        fen: match.fen,
        pgn: match.pgn || '',
        turn: match.turn,
        whiteTimeMs: match.whiteTimeMs,
        blackTimeMs: match.blackTimeMs,
      };
      await coordinator.finishTournamentMatch(finishParams);

      // Update player profile stats only when pairing was successfully updated
      if (pairing.updated && pairing.whitePlayerId && pairing.blackPlayerId) {
        await coordinator.updateProfileStats(pairing.whitePlayerId, pairing.blackPlayerId, result);
      }
    } catch (err: any) {
      console.error(`[WorldRoom] Failed to report tournament result:`, err.message);
    }
  }

  private startMatch(board: BoardState, joiningPlayer: PlayerState, joiningClient: Client) {
    const matchId = nanoid();
    const chess = new Chess();
    const now = Date.now();
    const baseTimeMs = board.baseMinutes * 60 * 1000;
    const incrementMs = board.incrementSeconds * 1000;

    // Determine colors based on what the challenger chose
    let whiteId: string;
    let blackId: string;
    let whitePlayerName: string;
    let blackPlayerName: string;

    if (board.whitePlayerId === board.waitingPlayerId) {
      // Challenger chose white
      whiteId = board.waitingPlayerId;
      blackId = joiningPlayer.id;
      const whiteSession = this.findSessionByPlayerId(whiteId);
      const whitePlayer = whiteSession ? this.state.players.get(whiteSession) : null;
      whitePlayerName = whitePlayer?.username || 'Player';
      blackPlayerName = joiningPlayer.username;
    } else {
      // Challenger chose black
      blackId = board.waitingPlayerId;
      whiteId = joiningPlayer.id;
      const blackSession = this.findSessionByPlayerId(blackId);
      const blackPlayer = blackSession ? this.state.players.get(blackSession) : null;
      blackPlayerName = blackPlayer?.username || 'Player';
      whitePlayerName = joiningPlayer.username;
    }

    const match = new MatchState();
    match.id = matchId;
    match.boardId = board.id;
    match.region = joiningPlayer.region;
    match.whitePlayerId = whiteId;
    match.blackPlayerId = blackId;
    match.whitePlayerName = whitePlayerName;
    match.blackPlayerName = blackPlayerName;
    match.fen = chess.fen();
    match.pgn = '';
    match.status = 'playing';
    match.turn = 'w';
    match.whiteTimeMs = baseTimeMs;
    match.blackTimeMs = baseTimeMs;
    match.incrementMs = incrementMs;
    match.lastMoveAt = now;
    match.winnerId = '';
    match.result = '';

    activeGames.set(matchId, chess);
    this.state.matches.set(matchId, match);

    // Save challenger info before clearing
    const challengerId = board.waitingPlayerId;

    board.status = 'playing';
    board.whitePlayerId = whiteId;
    board.blackPlayerId = blackId;
    board.matchId = matchId;
    board.waitingPlayerId = '';
    board.waitingPlayerName = '';

    joiningPlayer.currentBoardId = board.id;

    // Send match_started to both players with correct color
    const challengerSessionId = this.findSessionByPlayerId(challengerId);
    const challengerColor2 = challengerId === whiteId ? 'w' : 'b';
    const joinerColor = challengerId === whiteId ? 'b' : 'w';

    if (challengerSessionId) {
      const challengerClient = this.clients.find(c => c.sessionId === challengerSessionId);
      if (challengerClient) {
        challengerClient.send('match_started', { matchId, boardId: board.id, color: challengerColor2 });
      }
    }
    joiningClient.send('match_started', { matchId, boardId: board.id, color: joinerColor });

    // Clear presence deadline for this board's tournament pairing
    coordinator.getCurrentInstance().then(instance => {
      if (instance && instance.id) {
        coordinator.markPairingStarted(instance.id, board.id);
      }
    }).catch(() => {});

    // Persist tournament match to database
    if (board.id.includes('_table_')) {
      coordinator.getCurrentInstance().then(async (instance) => {
        if (!instance || instance.status !== 'round_active') return;
        const pairings = await coordinator.getPairings(instance.id, instance.currentRound);
        const pairing = pairings.find(p => p.runtimeTableId === board.id);
        if (!pairing) return;

        const params: TournamentMatchCreateParams = {
          colyseusMatchId: matchId,
          tournamentId: instance.id,
          roundNumber: instance.currentRound,
          boardNumber: pairing.boardNumber,
          runtimeTableId: board.id,
          whiteUserId: whiteId,
          blackUserId: blackId,
          region: joiningPlayer.region,
          fen: chess.fen(),
          timeMinutes: board.baseMinutes,
          incrementSeconds: board.incrementSeconds,
          whiteTimeMs: baseTimeMs,
          blackTimeMs: baseTimeMs,
        };
        coordinator.createTournamentMatch(params);
      }).catch(err => console.error('[WorldRoom] createTournamentMatch error:', err.message));
    }

    console.log(`[WorldRoom] Match started: ${matchId} (${whitePlayerName} vs ${blackPlayerName}) on ${board.name}`);
  }

  private async endMatch(matchId: string, game: Chess) {
    const match = this.state.matches.get(matchId);
    if (!match) return;

    match.status = 'finished';
    activeGames.delete(matchId);

    if (game.isCheckmate()) {
      match.result = 'checkmate';
      match.winnerId = match.turn === 'w' ? match.blackPlayerId : match.whitePlayerId;
    } else if (game.isStalemate()) {
      match.result = 'stalemate';
    } else if (game.isThreefoldRepetition()) {
      match.result = 'repetition';
    } else if (game.isInsufficientMaterial()) {
      match.result = 'insufficient';
    } else {
      match.result = 'draw';
    }

    await this.broadcastMatchEnd(match);
    this.cleanupMatchBoard(match);
    this.state.matches.delete(matchId);
  }

  private getSpectators(boardId: string): Set<string> {
    const spectatorSeats = new Set<string>();
    this.state.players.forEach((p) => {
      if (p.currentBoardId === boardId) {
        // Players sitting at the board who are NOT the match participants
        const board = this.state.boards.get(boardId);
        if (board && board.matchId) {
          const match = this.state.matches.get(board.matchId);
          if (match && match.whitePlayerId !== p.id && match.blackPlayerId !== p.id) {
            spectatorSeats.add(p.id);
          }
        }
      }
    });
    return spectatorSeats;
  }

  private findSessionByPlayerId(playerId: string): string | undefined {
    let found: string | undefined;
    this.state.players.forEach((p, sessionId) => {
      if (p.id === playerId) found = sessionId;
    });
    return found;
  }
}
