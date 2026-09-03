import { Room, Client } from '@colyseus/core';
import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { WorldState } from '../schemas/WorldState.js';
import { WorldDropState } from '../schemas/WorldDropState.js';
import { PlayerState } from '../schemas/PlayerState.js';
import { BoardState } from '../schemas/BoardState.js';
import { MatchState } from '../schemas/MatchState.js';
import { VoiceParticipantState } from '../schemas/VoiceParticipantState.js';
import * as coordinator from '../tournament/coordinator.js';
import type { TournamentMatchCreateParams, TournamentMatchFinishParams, PendingPairing } from '../tournament/coordinator.js';
import { CombatResolver } from '../combat/combatResolver.js';
import { getPlayerCharacter, savePlayerEquippedWeapon } from '../characters/playerCharacterRepository.js';
import { getAssetCategoriesCached } from '../assets/assetCategoryRepository.js';
import {
  WEAPON_REF_RE,
  canonicalAppearanceString,
  findClassWeaponRef,
  type PlayerCharacterConfigV1,
} from '../shared/characters/PlayerCharacterShapes.js';
import { verifySupabaseToken } from '../auth/supabaseAuth.js';
import { classifyCraftEntityId } from '../shared/craft/CraftShapes.js';
import { INVENTORY_DROP_MAX_DISTANCE, INVENTORY_PICKUP_MAX_DISTANCE } from '../shared/collection/CollectionShapes.js';
import { applyInventoryDeltas, getInventory } from '../collection/inventoryRepository.js';
import { executePlayerCraft } from '../craft/craftService.js';

interface JoinOptions {
  /** Legado — IGNORADO para identidade (era spoofável). Mantido só por compat. */
  playerId?: string;
  /** JWT do Supabase: única fonte da identidade persistente do jogador. */
  token?: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}

const activeGames = new Map<string, Chess>();
type RoomReply = { event: 'inventory_changed' | 'inventory_error' | 'craft_result' | 'craft_error'; payload: Record<string, unknown> };
interface RoomRequestEntry { kind: string; fingerprint: string; task: Promise<RoomReply>; settled: boolean; }

export class WorldRoom extends Room<WorldState> {
  private readonly TICK_RATE = 20;
  /** Região da sala (ex.: 'Europe' ou 'craft:Europe' no Mundo de Coleta). Lida pelo coordinator. */
  public region = 'default';
  /** Per-player reconnect grace timers: matchId → (playerId → timer). A
   *  single timer per match let a second disconnect overwrite the first and
   *  let a refresh by EITHER participant cancel the other one's countdown. */
  private disconnectTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
  /** Tracks how many draw offers each player has made per match: matchId → {white: n, black: n} */
  private drawOfferCounts = new Map<string, { white: number; black: number }>();
  // matchId -> color of the player whose draw offer is currently awaiting an answer
  private pendingDrawOffers = new Map<string, 'w' | 'b'>();
  /** Server-authoritative combat (client only sends attack intents). */
  private combatResolver = new CombatResolver(this);
  /** Personagem jogável carregado por sessão (classe/aparência/arma). */
  private playerCharacters = new Map<string, PlayerCharacterConfigV1>();
  /** Last-request-wins para loads assíncronos do personagem. */
  private characterLoadSeq = new Map<string, number>();
  /** Last-request-wins para equipar/desequipar (tem awaits no meio). */
  private equipSeq = new Map<string, number>();
  /** Fila de persistência da arma POR JOGADOR: garante a ordem dos writes no DB. */
  private persistQueue = new Map<string, Promise<void>>();
  /** Per-session idempotent operation cache. */
  private inventoryRequests = new Map<string, Map<string, RoomRequestEntry>>();
  private dropLocks = new Map<string, Promise<void>>();
  /** Last accepted client movement; performance.now is monotonic per process. */
  private movementGuards = new Map<string, number>();
  // Client MAP_CONFIG.playerSpeed is 120 px/s. 180 allows normal rounding,
  // input/network cadence variance and a modest sprint margin without allowing
  // an instant jump between distant crafting stations.
  private readonly MAX_PLAYER_SPEED = 180;
  private readonly MOVEMENT_INITIAL_MARGIN = 64;
  private readonly WORLD_BOUNDARY = 10_000;

  onCreate(options: any) {
    this.setState(new WorldState());
    this.setSimulationInterval(() => this.tick(), 1000 / this.TICK_RATE);
    // Ship state patches at 30Hz (default 20Hz): remote movement reaches
    // other clients ~17ms sooner on average; patches are tiny position deltas.
    this.setPatchRate(1000 / 30);
    this.maxClients = 100;

    this.region = String(options.region || 'default');

    coordinator.registerWorldRoom(this);

    console.log(`[WorldRoom] Created for region: ${options.region || 'unknown'} | roomId: ${this.roomId}`);

    this.onMessage('move_to', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (this.combatResolver.isDead(client.sessionId)) return; // corpses don't walk
      // Combat resolves hitboxes from these values — never let NaN/Infinity
      // or non-numeric junk poison authoritative state.
       if (!Number.isFinite(data?.x) || !Number.isFinite(data?.y) ||
         Math.abs(data.x) > this.WORLD_BOUNDARY || Math.abs(data.y) > this.WORLD_BOUNDARY) return;
       const now = performance.now();
       const lastAt = this.movementGuards.get(client.sessionId) ?? now;
       // Cap elapsed credit: a suspended client cannot bank unlimited distance.
       const allowance = this.MOVEMENT_INITIAL_MARGIN + this.MAX_PLAYER_SPEED * Math.min(2, (now - lastAt) / 1000);
       if (Math.hypot(data.x - player.x, data.y - player.y) > allowance) return;
      player.x = data.x;
      player.y = data.y;
       this.movementGuards.set(client.sessionId, now);
       if (Number.isFinite(data.targetX) && Math.abs(data.targetX) <= this.WORLD_BOUNDARY) player.targetX = data.targetX;
       if (Number.isFinite(data.targetY) && Math.abs(data.targetY) <= this.WORLD_BOUNDARY) player.targetY = data.targetY;
      if (typeof data.direction === 'string' && data.direction.length <= 16) player.direction = data.direction;
      player.isMoving = !!data.isMoving;
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
      if (this.combatResolver.isDead(client.sessionId)) return; // dead players can't challenge

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
      if (this.combatResolver.isDead(client.sessionId)) return; // dead players can't accept

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
      if (this.combatResolver.isDead(client.sessionId)) return; // dead players can't sit

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

      if (match.clockPausedAt > 0) {
        client.send('error', { message: 'Partida pausada — aguardando reconexão do adversário' });
        return;
      }

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

      // A move on the board voids any outstanding draw offer
      this.pendingDrawOffers.delete(matchId);

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

    this.onMessage('chess_draw_offer', async (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;

      // An offer is already awaiting an answer — tell the sender explicitly so
      // their client can clear its optimistic "offered" flag (they likely have
      // an incoming offer to answer instead).
      if (this.pendingDrawOffers.has(matchId)) {
        client.send('draw_offer_rejected', { reason: 'pending_exists' });
        return;
      }

      // Check max draw offers per match
      const config = await coordinator.loadConfig().catch(() => null);
      const maxOffers = config?.maxDrawOffers ?? 2;

      // Re-validate after the async config load: the match may have ended or a
      // concurrent offer may have landed while we awaited.
      const freshMatch = this.state.matches.get(matchId);
      if (!freshMatch || freshMatch.status !== 'playing') return;
      if (this.pendingDrawOffers.has(matchId)) {
        client.send('draw_offer_rejected', { reason: 'pending_exists' });
        return;
      }

      const counts = this.drawOfferCounts.get(matchId) ?? { white: 0, black: 0 };
      const myCount = isWhite ? counts.white : counts.black;
      if (myCount >= maxOffers) {
        client.send('draw_offer_rejected', { reason: 'limit_reached', max: maxOffers });
        return;
      }

      // Increment counter
      if (isWhite) counts.white++;
      else counts.black++;
      this.drawOfferCounts.set(matchId, counts);

      this.pendingDrawOffers.set(matchId, isWhite ? 'w' : 'b');

      const opponentId = isWhite ? match.blackPlayerId : match.whitePlayerId;
      const opponentSession = this.findSessionByPlayerId(opponentId);
      if (opponentSession) {
        const opponentClient = this.clients.find(c => c.sessionId === opponentSession);
        opponentClient?.send('draw_offered', { matchId, offeredBy: player.username });
      }
    });

    this.onMessage('chess_draw_decline', (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;

      // Only valid while an offer from the OPPONENT is pending
      const pendingFrom = this.pendingDrawOffers.get(matchId);
      const myColor: 'w' | 'b' = isWhite ? 'w' : 'b';
      if (!pendingFrom || pendingFrom === myColor) return;
      this.pendingDrawOffers.delete(matchId);

      // Notify the opponent (the one who offered) that draw was declined
      const offererId = isWhite ? match.blackPlayerId : match.whitePlayerId;
      const offererSession = this.findSessionByPlayerId(offererId);
      if (offererSession) {
        const offererClient = this.clients.find(c => c.sessionId === offererSession);
        offererClient?.send('draw_declined', { matchId });
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

      // Only valid while an offer from the OPPONENT is pending — prevents
      // forcing a draw without an offer and stale accepts after a decline/move.
      const pendingFrom = this.pendingDrawOffers.get(matchId);
      const myColor: 'w' | 'b' = isWhite ? 'w' : 'b';
      if (!pendingFrom || pendingFrom === myColor) return;
      this.pendingDrawOffers.delete(matchId);

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
      if (this.combatResolver.isDead(client.sessionId)) return; // dead players can't take a seat
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
        // Board is in 'playing' but this player is not in that match — stale state.
        // Don't fall through to the idle/waiting branches (none handle 'playing').
        console.warn(`[WorldRoom] tournament_seat: board ${boardId} playing but ${player.id} not in match ${board.matchId}`);
        return;
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

    this.onMessage('attack', (client, data) => {
      void this.combatResolver.handleAttack(client, data);
    });

    this.onMessage('inventory_drop', (client, data) => {
      const body = data as { requestId?: unknown; itemKey?: unknown; qty?: unknown; x?: unknown; y?: unknown };
      void this.runRoomRequest(client, 'inventory_drop', body?.requestId, JSON.stringify([body?.itemKey, body?.qty, body?.x, body?.y]), () => this.handleInventoryDrop(client, data));
    });
    this.onMessage('inventory_pickup', (client, data) => {
      const body = data as { requestId?: unknown; dropId?: unknown };
      void this.runRoomRequest(client, 'inventory_pickup', body?.requestId, JSON.stringify([body?.dropId]), () => this.handleInventoryPickup(client, data));
    });
    this.onMessage('craft_item', (client, data) => {
      const body = data as { requestId?: unknown; stationId?: unknown; targetId?: unknown; quantity?: unknown };
      void this.runRoomRequest(client, 'craft_item', body?.requestId, JSON.stringify([body?.stationId, body?.targetId, body?.quantity]), () => this.handleCraftItem(client, data));
    });

    // ---- Personagem jogável (aparência composta + arma da classe) ----
    // (o antigo set_character morreu: personagens legados ficam no repo mas
    // fora do jogo — sem troca dinâmica de personagem.)

    // O cliente avisa depois de salvar via PUT /api/me/character: a sala
    // recarrega do banco e espelha no estado (todos veem em tempo real).
    this.onMessage('character_ready', (client) => {
      void this.refreshPlayerCharacter(client.sessionId);
    });

    // Equipa/desequipa o item de mão. Sem `ref` (ou com ref de arma) o
    // servidor decide QUAL arma — a padrão da classe em default-weapons; uma
    // ref de ferramenta só equipa se estiver no inventário do jogador.
    // Rejeições respondem `equip_error` para a UI avisar em vez de falhar mudo.
    this.onMessage('equip_weapon', async (client, data) => {
      const equip = data?.equip === true;
      const fail = (message: string) => client.send('equip_error', { message });
      // Pedidos rápidos em sequência: só o mais novo aplica depois dos
      // awaits (senão um equipar antigo em voo desfaz um desequipar novo).
      const seq = (this.equipSeq.get(client.sessionId) ?? 0) + 1;
      this.equipSeq.set(client.sessionId, seq);
      let config = this.playerCharacters.get(client.sessionId);
      if (!config) {
        // Join-load pode ainda estar em voo (ou ter falhado): tenta de novo.
        await this.refreshPlayerCharacter(client.sessionId);
        if (this.equipSeq.get(client.sessionId) !== seq) return; // pedido mais novo venceu
        config = this.playerCharacters.get(client.sessionId);
      }
      if (!config) { fail('Crie seu personagem antes de equipar'); return; }
      if (!equip) {
        this.unequipWeapon(client.sessionId);
        return;
      }
      const rawRef = typeof data?.ref === 'string' ? (data.ref as string) : null;
      if (rawRef !== null && !WEAPON_REF_RE.test(rawRef)) { fail('Item não equipável'); return; }
      const requested = rawRef;
      const categories = await getAssetCategoriesCached();
      if (this.equipSeq.get(client.sessionId) !== seq) return;
      const defaultWeapon = findClassWeaponRef(categories, config.classId);
      let ref = defaultWeapon;
      if (requested) {
        if (requested.startsWith('gen:weapon/')) {
          if (requested !== defaultWeapon) { fail('Sua classe só equipa a própria arma'); return; }
          ref = requested;
        } else if (requested.startsWith('gen:crafttools/')) {
          const inventory = await getInventory(this.state.players.get(client.sessionId)?.id ?? '');
          if (this.equipSeq.get(client.sessionId) !== seq) return;
          if (inventory.error || inventory.tableMissing) { fail('Inventário indisponível'); return; }
          if (!inventory.items.some((item) => item.itemKey === requested && item.qty > 0)) {
            fail('Essa ferramenta não está no seu inventário');
            return;
          }
          ref = requested;
        } else { fail('Item não equipável'); return; }
      }
      if (!ref) { fail('Sua classe ainda não tem arma liberada'); return; }
      const player = this.state.players.get(client.sessionId);
      if (!player) return; // saiu durante o await
      player.equippedWeapon = ref;
      config.equippedWeapon = ref;
      void this.persistEquippedWeapon(player.id, ref);
    });
  }

  /** Guarda a arma/ferramenta em uso (estado da sala + config em memória + banco). */
  private unequipWeapon(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.equippedWeapon = '';
    const config = this.playerCharacters.get(sessionId);
    if (config) config.equippedWeapon = null;
    void this.persistEquippedWeapon(player.id, null);
  }

  private async inventorySnapshot(userId: string): Promise<RoomReply> {
    const snapshot = await getInventory(userId);
    return snapshot.error || snapshot.tableMissing
      ? { event: 'inventory_error', payload: { message: snapshot.error ?? 'Inventário indisponível' } }
      : { event: 'inventory_changed', payload: { items: snapshot.items } };
  }

  private async runRoomRequest(client: Client, kind: string, requestId: unknown, fingerprint: string, operation: () => Promise<RoomReply>): Promise<void> {
    const errorEvent = kind === 'craft_item' ? 'craft_error' : 'inventory_error';
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) {
      client.send(errorEvent, { message: 'requestId inválido' });
      return;
    }
    let cache = this.inventoryRequests.get(client.sessionId);
    if (!cache) this.inventoryRequests.set(client.sessionId, (cache = new Map()));
    let entry = cache.get(requestId);
    if (entry && (entry.kind !== kind || entry.fingerprint !== fingerprint)) {
      client.send(errorEvent, { requestId, message: 'requestId reutilizado com operação diferente' });
      return;
    }
    if (!entry) {
      if (cache.size >= 200) {
        const settledId = [...cache.entries()].find(([, candidate]) => candidate.settled)?.[0];
        if (!settledId) {
          client.send(errorEvent, { requestId, message: 'Muitas operações pendentes' });
          return;
        }
        cache.delete(settledId);
      }
      const created: RoomRequestEntry = { kind, fingerprint, settled: false, task: Promise.resolve({ event: errorEvent, payload: {} }) };
      created.task = operation().catch((error): RoomReply => ({
        event: errorEvent, payload: { message: error instanceof Error ? error.message : 'Falha interna' },
      })).finally(() => { created.settled = true; });
      entry = created;
      cache.set(requestId, created);
    }
    const reply = await entry.task;
    client.send(reply.event, { requestId, ...reply.payload });
  }

  private async handleCraftItem(client: Client, data: unknown): Promise<RoomReply> {
    const player = this.state.players.get(client.sessionId);
    const body = data as { stationId?: unknown; targetId?: unknown; quantity?: unknown };
    if (!player || player.id.startsWith('anon:')) return { event: 'craft_error', payload: { message: 'Autenticação obrigatória' } };
    if (!this.region.startsWith('craft:')) return { event: 'craft_error', payload: { message: 'Craft disponível apenas no Mundo de Coleta' } };
    if (typeof body?.stationId !== 'string' || !this.isNearCraftStation(player.x, player.y, body.stationId)) {
      return { event: 'craft_error', payload: { message: 'Você precisa estar perto da estação selecionada' } };
    }
    const result = await executePlayerCraft(player.id, body.stationId, body.targetId, body.quantity);
    return result.ok
      ? { event: 'craft_result', payload: { items: result.items } }
      : { event: 'craft_error', payload: { message: result.message } };
  }

  private isNearCraftStation(x: number, y: number, stationId: string): boolean {
    const rects: Record<string, [number, number, number, number]> = {
      fornalha: [2298, 2752, 298, 211],
      'estacao-de-pocoes': [2328.67, 1983.33, 423, 386],
      'mesa-de-crafting': [3804, 1985, 654, 319],
      forja: [2392.5, 3075, 332, 123],
    };
    const rect = rects[stationId];
    if (!rect) return false;
    const [left, top, width, height] = rect;
    const nearestX = Math.max(left, Math.min(x, left + width));
    const nearestY = Math.max(top, Math.min(y, top + height));
    return Math.hypot(x - nearestX, y - nearestY) <= 64;
  }

  private async handleInventoryDrop(client: Client, data: unknown): Promise<RoomReply> {
    const player = this.state.players.get(client.sessionId);
    const body = data as { requestId?: unknown; itemKey?: unknown; qty?: unknown; x?: unknown; y?: unknown };
    if (!player || player.id.startsWith('anon:')) return { event: 'inventory_error', payload: { message: 'Autenticação obrigatória' } };
    if (typeof body.itemKey !== 'string' || classifyCraftEntityId(body.itemKey) === null ||
      typeof body.qty !== 'number' || !Number.isInteger(body.qty) || body.qty < 1 || body.qty > 999 ||
      typeof body.x !== 'number' || typeof body.y !== 'number' || !Number.isFinite(body.x) || !Number.isFinite(body.y) ||
      Math.hypot(body.x - player.x, body.y - player.y) > INVENTORY_DROP_MAX_DISTANCE) {
      return { event: 'inventory_error', payload: { message: 'Drop inválido ou distante' } };
    }
    const debit = await applyInventoryDeltas(player.id, [{ itemKey: body.itemKey, qty: -body.qty }]);
    if (!debit.ok) {
      return { event: 'inventory_error', payload: { message: debit.error ?? 'Saldo insuficiente' } };
    }
    const drop = new WorldDropState();
    drop.id = nanoid();
    drop.itemKey = body.itemKey;
    drop.qty = body.qty;
    drop.x = body.x;
    drop.y = body.y;
    this.state.worldDrops.set(drop.id, drop);
    const reply = await this.inventorySnapshot(player.id);
    // Soltou a última unidade da ferramenta que estava na mão: ela sai do personagem também.
    if (player.equippedWeapon === body.itemKey && reply.event === 'inventory_changed') {
      const items = (reply.payload as { items: Array<{ itemKey: string; qty: number }> }).items;
      if (!items.some((item) => item.itemKey === body.itemKey && item.qty > 0)) this.unequipWeapon(client.sessionId);
    }
    return reply;
  }

  private async handleInventoryPickup(client: Client, data: unknown): Promise<RoomReply> {
    const player = this.state.players.get(client.sessionId);
    const body = data as { requestId?: unknown; dropId?: unknown };
    if (!player || player.id.startsWith('anon:')) return { event: 'inventory_error', payload: { message: 'Autenticação obrigatória' } };
    if (typeof body?.dropId !== 'string' || body.dropId.length > 64) return { event: 'inventory_error', payload: { message: 'dropId inválido' } };
    const dropId = body.dropId;
    const previous = this.dropLocks.get(dropId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async (): Promise<RoomReply> => {
      const drop = this.state.worldDrops.get(dropId);
      if (!drop) return { event: 'inventory_error', payload: { message: 'Drop não encontrado' } };
      if (Math.hypot(drop.x - player.x, drop.y - player.y) > INVENTORY_PICKUP_MAX_DISTANCE) {
        return { event: 'inventory_error', payload: { message: 'Drop distante demais' } };
      }
      // Remove first so all clients observe one claimant; restore exactly if credit fails.
      this.state.worldDrops.delete(dropId);
      const credit = await applyInventoryDeltas(player.id, [{ itemKey: drop.itemKey, qty: drop.qty }]);
      if (!credit.ok) {
        this.state.worldDrops.set(drop.id, drop);
        return { event: 'inventory_error', payload: { message: credit.error ?? 'Não foi possível recolher drop' } };
      }
      return this.inventorySnapshot(player.id);
    });
    const marker = task.then(() => undefined, () => undefined);
    this.dropLocks.set(dropId, marker);
    try { return await task; } finally { if (this.dropLocks.get(dropId) === marker) this.dropLocks.delete(dropId); }
  }

  /** Carrega o personagem persistido e espelha no estado (last-write-wins). */
  private async refreshPlayerCharacter(sessionId: string): Promise<void> {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const seq = (this.characterLoadSeq.get(sessionId) ?? 0) + 1;
    this.characterLoadSeq.set(sessionId, seq);
    try {
      const result = await getPlayerCharacter(player.id);
      if (this.characterLoadSeq.get(sessionId) !== seq) return; // superseded
      const still = this.state.players.get(sessionId);
      if (!still) return; // saiu durante o await
      if (!result.config) {
        if (result.error) console.warn(`[WorldRoom] load do personagem falhou: ${result.error}`);
        return; // sem personagem criado (id anônimo, tabela ausente, etc.)
      }
      const config = result.config;
      const persistedWeapon = config.equippedWeapon || null;
      let equippedWeapon = persistedWeapon;
      if (persistedWeapon?.startsWith('gen:weapon/')) {
        try {
          const categories = await getAssetCategoriesCached();
          if (this.characterLoadSeq.get(sessionId) !== seq) return;
          // A ref persistida só é válida se for precisamente a arma padrão da
          // classe atual; refs de teste/outra classe nunca ressuscitam.
          if (persistedWeapon !== findClassWeaponRef(categories, config.classId)) equippedWeapon = null;
        } catch (error) {
          console.warn(`[WorldRoom] categorias para arma equipada indisponíveis: ${error instanceof Error ? error.message : String(error)}`);
          equippedWeapon = null;
        }
      } else if (persistedWeapon?.startsWith('gen:crafttools/')) {
        try {
          const inventory = await getInventory(player.id);
          if (this.characterLoadSeq.get(sessionId) !== seq) return;
          if (inventory.error || inventory.tableMissing) {
            console.warn(`[WorldRoom] inventário para ferramenta equipada indisponível: ${inventory.error ?? 'tabela ausente'}`);
            equippedWeapon = null;
          } else if (!inventory.items.some((item) => item.itemKey === persistedWeapon && item.qty > 0)) {
            equippedWeapon = null;
          }
        } catch (error) {
          console.warn(`[WorldRoom] inventário para ferramenta equipada indisponível: ${error instanceof Error ? error.message : String(error)}`);
          equippedWeapon = null;
        }
      } else if (persistedWeapon !== null) {
        equippedWeapon = null;
      }
      // Both validations can await. Do not publish a load superseded while they
      // were in flight, nor resurrect state after the player left.
      if (this.characterLoadSeq.get(sessionId) !== seq) return;
      const currentPlayer = this.state.players.get(sessionId);
      if (!currentPlayer) return;
      if (config.equippedWeapon !== equippedWeapon) {
        config.equippedWeapon = null;
        void this.persistEquippedWeapon(currentPlayer.id, null);
      }
      this.playerCharacters.set(sessionId, config);
      currentPlayer.appearance = canonicalAppearanceString(config.appearance);
      currentPlayer.equippedWeapon = equippedWeapon ?? '';
    } catch (e) {
      console.warn(`[WorldRoom] load do personagem falhou: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Persistência da arma equipada (o estado em memória já foi atualizado).
   * Serializada POR JOGADOR: dois toggles rápidos geravam writes concorrentes
   * que podiam terminar fora de ordem e ressuscitar um estado velho no reload.
   */
  private persistEquippedWeapon(playerId: string, ref: string | null): Promise<void> {
    const prev = this.persistQueue.get(playerId) ?? Promise.resolve();
    const next = prev.then(() =>
      savePlayerEquippedWeapon(playerId, ref).then(
        (r) => {
          if (!r.ok && r.error) console.warn(`[WorldRoom] persistir arma falhou: ${r.error}`);
        },
        (e) =>
          console.warn(`[WorldRoom] persistir arma falhou: ${e instanceof Error ? e.message : String(e)}`),
      ),
    );
    this.persistQueue.set(playerId, next);
    void next.finally(() => {
      if (this.persistQueue.get(playerId) === next) this.persistQueue.delete(playerId);
    });
    return next;
  }

  async onJoin(client: Client, options: JoinOptions) {
    // Identidade NUNCA vem do cliente: o playerId das options é ignorado.
    // Com token Supabase válido, o id é o `sub` verificado; sem token a
    // sessão é anônima (`anon:<sessionId>`) — não casa com UUID de conta
    // nenhuma, então nunca lê/escreve personagem nem derruba sessão alheia.
    let playerId = `anon:${client.sessionId}`;
    if (options.token) {
      const verified = await verifySupabaseToken(options.token);
      if (!verified) throw new Error('token de autenticação inválido');
      playerId = verified;
    }

    // Kick existing session for same player (stale connection / reconnect).
    // Preserve its authoritative position before deleting it; join options are
    // client input and must never choose a spawn or bypass movement limits.
    let reconnectPosition: { x: number; y: number } | null = null;
    this.state.players.forEach((existing, existingSessionId) => {
      if (existing.id === playerId && existingSessionId !== client.sessionId) {
        if (Number.isFinite(existing.x) && Number.isFinite(existing.y) &&
          Math.abs(existing.x) <= this.WORLD_BOUNDARY && Math.abs(existing.y) <= this.WORLD_BOUNDARY) {
          reconnectPosition = { x: existing.x, y: existing.y };
        }
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
    player.region = this.region;
    const spawn = reconnectPosition ?? (this.region.startsWith('craft:')
      ? { x: 3256, y: 2246.67 }
      : { x: 1273, y: 926 });
    player.x = spawn.x;
    player.y = spawn.y;
    player.targetX = player.x;
    player.targetY = player.y;
    player.direction = 'down';
    player.isMoving = false;

    this.state.players.set(client.sessionId, player);
    this.movementGuards.set(client.sessionId, performance.now());
    console.log(`[WorldRoom] Player joined: ${player.username} (${client.sessionId}) | total: ${this.state.players.size}`);
    if (!playerId.startsWith('anon:')) void this.inventorySnapshot(playerId).then((reply) => client.send(reply.event, reply.payload));

    // Personagem persistido (aparência/arma) chega de forma assíncrona — o
    // sprite só nasce visível nos outros clientes quando appearance preenche.
    void this.refreshPlayerCharacter(client.sessionId);

    // If this player had an active match (reconnection), send match info
    this.state.matches.forEach((match, matchId) => {
      if (match.status !== 'playing') return;
      if (match.whitePlayerId === playerId) {
        client.send('match_started', { matchId, boardId: match.boardId, color: 'w' });
      } else if (match.blackPlayerId === playerId) {
        client.send('match_started', { matchId, boardId: match.boardId, color: 'b' });
      }
    });

    // Cancel this player's OWN disconnect grace timer (they came back in
    // time). Timers are per-player: a refresh by the still-connected player
    // must never cancel the countdown of the one who is actually gone.
    this.state.matches.forEach((match, matchId) => {
      if (match.status !== 'playing') return;
      if (match.whitePlayerId !== playerId && match.blackPlayerId !== playerId) return;
      const timers = this.disconnectTimers.get(matchId);
      const own = timers?.get(playerId);
      const wasPaused = match.clockPausedAt > 0;
      // No grace timer AND clocks running → no disconnect in progress here.
      // (own may be missing even mid-disconnect: the reconnect can land while
      // onLeave is still awaiting the config, before the timer is installed.)
      if (!own && !wasPaused) return;
      if (own && timers) {
        clearTimeout(own);
        timers.delete(playerId);
        console.log(`[WorldRoom] ${playerId} reconnected to match ${matchId}, grace timer cancelled`);
      }
      if (!timers || timers.size === 0) {
        // Everyone is back — unfreeze the clocks.
        this.disconnectTimers.delete(matchId);
        this.resumeMatchClock(match);
      }
      // Notify opponent of reconnection
      const opponentId = match.whitePlayerId === playerId ? match.blackPlayerId : match.whitePlayerId;
      const opponentSession = this.findSessionByPlayerId(opponentId);
      const opponentClient = this.clients.find(c => c.sessionId === opponentSession);
      opponentClient?.send('opponent_reconnected', { matchId, boardId: match.boardId });
    });
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const playerId = player.id;
    const username = player.username;
    console.log(`[WorldRoom] Player leaving: ${username} (${client.sessionId}) | consented: ${consented}`);

    // --- Synchronous state cleanup FIRST, before ANY await. A hung config or
    // DB call here once left ghost players in state for many minutes, and the
    // W.O. sweep kept counting them as "present" the whole time.
    this.state.boards.forEach((board) => {
      if (board.waitingPlayerId === playerId && board.status === 'waiting') {
        this.resetBoard(board);
      }
    });
    this.state.voiceParticipants.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.combatResolver.clearSession(client.sessionId);
    this.characterLoadSeq.delete(client.sessionId);
    this.playerCharacters.delete(client.sessionId);
    this.equipSeq.delete(client.sessionId);
    this.inventoryRequests.delete(client.sessionId);
    this.movementGuards.delete(client.sessionId);
    console.log(`[WorldRoom] Player removed: ${username} | remaining: ${this.state.players.size}`);

    const affected: [string, MatchState][] = [];
    this.state.matches.forEach((match, matchId) => {
      if (match.status !== 'playing') return;
      if (match.whitePlayerId === playerId || match.blackPlayerId === playerId) {
        affected.push([matchId, match]);
      }
    });
    if (affected.length === 0) return;

    // Freeze both clocks immediately (synchronously) for every affected match
    // so nobody's time burns while their opponent is offline.
    for (const [, match] of affected) this.pauseMatchClock(match);

    // Reconnect window length (W.O. timeout from config; default 30s)
    let woGraceMs = 30_000;
    try {
      const cfg = await coordinator.loadConfig();
      woGraceMs = ((cfg.woTimeoutSeconds ?? 30)) * 1_000;
    } catch { /* use default */ }

    for (const [matchId, match] of affected) {
      const isWhite = match.whitePlayerId === playerId;
      const opponentId = isWhite ? match.blackPlayerId : match.whitePlayerId;
      const isTournamentMatch = match.boardId.includes('_table_');

      // The player may have reconnected (fresh session) while we awaited the
      // config above — never arm a forfeit timer against a present player,
      // and unfreeze the clocks we paused if nobody else is in a grace window.
      if (this.hasActivePlayerById(playerId)) {
        const pending = this.disconnectTimers.get(matchId);
        if (!pending || pending.size === 0) {
          this.disconnectTimers.delete(matchId);
          this.resumeMatchClock(match);
        }
        console.log(`[WorldRoom] ${playerId} already back before grace timer armed for ${matchId} — no W.O. timer`);
        continue;
      }

      // A deliberate exit (tab closed / logout) from a FRIENDLY match is an
      // immediate abandon — the player chose to leave. Tournament matches
      // always get the reconnect window; so do accidental drops in friendlies
      // (mobile screen lock, network blip).
      if (!isTournamentMatch && consented) {
        const m = this.state.matches.get(matchId);
        if (!m || m.status !== 'playing') continue;
        m.status = 'finished';
        m.result = 'abandon';
        m.winnerId = opponentId;
        activeGames.delete(matchId);
        await this.broadcastMatchEnd(m);
        this.cleanupMatchBoard(m);
        this.state.matches.delete(matchId);
        continue;
      }

      let timers = this.disconnectTimers.get(matchId);
      if (!timers) {
        timers = new Map();
        this.disconnectTimers.set(matchId, timers);
      }
      const existing = timers.get(playerId);
      if (existing) clearTimeout(existing);

      const opponentSession = this.findSessionByPlayerId(opponentId);
      const opponentClient = opponentSession ? this.clients.find(c => c.sessionId === opponentSession) : null;
      const reconnectDeadline = new Date(Date.now() + woGraceMs).toISOString();

      opponentClient?.send('opponent_disconnected', {
        matchId,
        boardId: match.boardId,
        reconnectDeadline,
        disconnectedPlayerId: playerId,
      });

      const timer = setTimeout(async () => {
        const byPlayer = this.disconnectTimers.get(matchId);
        byPlayer?.delete(playerId);
        const m = this.state.matches.get(matchId);
        if (!m || m.status !== 'playing') {
          if (byPlayer && byPlayer.size === 0) this.disconnectTimers.delete(matchId);
          return;
        }
        // Belt & suspenders: if a reconnect slipped past timer cancellation,
        // never forfeit a player who is actually connected right now.
        if (this.hasActivePlayerById(playerId)) {
          if (byPlayer && byPlayer.size === 0) {
            this.disconnectTimers.delete(matchId);
            this.resumeMatchClock(m);
          }
          console.log(`[WorldRoom] Grace timer expired for ${playerId} but they are present — no W.O.`);
          return;
        }
        // If the opponent is ALSO inside their own grace window, nobody wins.
        const bothGone = !!byPlayer && byPlayer.size > 0;
        m.status = 'finished';
        m.result = 'abandon';
        m.winnerId = bothGone ? '' : opponentId;
        activeGames.delete(matchId);
        await this.broadcastMatchEnd(m);
        this.cleanupMatchBoard(m);
        this.state.matches.delete(matchId);
        const oppSession = this.findSessionByPlayerId(opponentId);
        const oppClient = oppSession ? this.clients.find(c => c.sessionId === oppSession) : null;
        oppClient?.send('opponent_forfeited', { matchId, reason: 'disconnect_timeout' });
        console.log(`[WorldRoom] W.O. awarded: ${playerId} did not reconnect to match ${matchId}${bothGone ? ' (both absent — double forfeit)' : ''}`);
      }, woGraceMs);

      timers.set(playerId, timer);
      console.log(`[WorldRoom] Disconnect grace timer started for ${playerId} in match ${matchId} (${woGraceMs / 1000}s)`);
    }
  }

  onDispose() {
    // Clear all disconnect grace timers so they don't fire after room disposal.
    this.disconnectTimers.forEach((timers) => timers.forEach((t) => clearTimeout(t)));
    this.disconnectTimers.clear();
    // Only drop games belonging to THIS room — activeGames is module-level
    // and shared between the 'world' and 'arena' rooms; clearing everything
    // here used to kill the other room's live matches.
    this.state.matches.forEach((_match, matchId) => activeGames.delete(matchId));
    coordinator.unregisterWorldRoom(this);
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

  // Tournament end: players still inside the arena modules are teleported to
  // random spots near the reception center. Modules are glued NORTH of the
  // reception's north connector (y=0), so "inside a module" means y < 0.
  // Reception map is 1440x896 px; the center strip between the two practice
  // areas is safe ground.
  teleportTournamentPlayersToReception(tournamentId: string): void {
    if (this.roomName !== 'arena') return;

    const MODULE_BOUNDARY_Y = 8;
    const CENTER_X = 720;
    const CENTER_Y = 660;
    let moved = 0;

    this.state.players.forEach((player, sessionId) => {
      if (player.y >= MODULE_BOUNDARY_Y) return; // already in the reception
      const x = Math.round(CENTER_X + (Math.random() * 2 - 1) * 140);
      const y = Math.round(CENTER_Y + (Math.random() * 2 - 1) * 60);
      player.x = x;
      player.y = y;
      this.movementGuards.set(sessionId, performance.now());
      player.targetX = x;
      player.targetY = y;
      player.isMoving = false;
      player.currentBoardId = '';
      moved++;
      const cl = this.clients.find(c => c.sessionId === sessionId);
      cl?.send('tournament_teleport', { x, y });
    });

    // Drop this tournament's boards from room state
    const staleIds: string[] = [];
    this.state.boards.forEach((b) => {
      if (b.id.startsWith(`${tournamentId}_table_`)) staleIds.push(b.id);
    });
    for (const id of staleIds) this.state.boards.delete(id);

    console.log(`[WorldRoom] Tournament ${tournamentId} ended: teleported ${moved} player(s) to reception, removed ${staleIds.length} board(s)`);
  }

  // Coordinator-driven safety net: start a paired tournament match even if
  // the clients never sent tournament_seat. Colors come from the pairing
  // (authoritative), the visual seating follows via match_started/
  // tournament_seated on the clients.
  tryForceStartTournamentMatch(opts: {
    boardId: string;
    whitePlayerId: string;
    blackPlayerId: string;
    baseTimeSeconds: number;
    incrementSeconds: number;
    timeCategory: string;
    timeLabel: string;
  }): 'started' | 'already' | 'missing' | 'busy' {
    if (this.roomName !== 'arena') return 'missing';

    const whiteSession = this.findSessionByPlayerId(opts.whitePlayerId);
    const blackSession = this.findSessionByPlayerId(opts.blackPlayerId);
    const whitePlayer = whiteSession ? this.state.players.get(whiteSession) : undefined;
    const blackPlayer = blackSession ? this.state.players.get(blackSession) : undefined;
    const whiteClient = whiteSession ? this.clients.find(c => c.sessionId === whiteSession) : undefined;
    const blackClient = blackSession ? this.clients.find(c => c.sessionId === blackSession) : undefined;
    if (!whitePlayer || !blackPlayer || !whiteClient || !blackClient) return 'missing';

    let board = this.state.boards.get(opts.boardId);
    if (!board) {
      board = new BoardState();
      board.id = opts.boardId;
      board.name = `Tournament Board ${opts.boardId}`;
      board.x = 0;
      board.y = 0;
      board.width = 80;
      board.height = 80;
      board.status = 'idle';
      this.state.boards.set(opts.boardId, board);
    }

    if (board.status === 'playing' && board.matchId) {
      const match = this.state.matches.get(board.matchId);
      if (match && match.status === 'playing') {
        const samePlayers =
          (match.whitePlayerId === opts.whitePlayerId && match.blackPlayerId === opts.blackPlayerId)
          || (match.whitePlayerId === opts.blackPlayerId && match.blackPlayerId === opts.whitePlayerId);
        return samePlayers ? 'already' : 'busy';
      }
      // Stale board: it says 'playing' but the match is gone or finished
      // (e.g. a client crashed without unseating). Self-heal so the next
      // round is never blocked by a ghost game.
      this.resetBoard(board);
    }

    if (board.status === 'waiting' && board.waitingPlayerId
      && board.waitingPlayerId !== opts.whitePlayerId
      && board.waitingPlayerId !== opts.blackPlayerId) {
      // Stray waiter on a tournament board — clear it, the pairing wins.
      this.resetBoard(board);
    }

    // Configure the board as if white had seated first, then join black.
    board.status = 'waiting';
    board.waitingPlayerId = opts.whitePlayerId;
    board.waitingPlayerName = whitePlayer.username;
    board.timeCategory = opts.timeCategory;
    board.baseMinutes = opts.baseTimeSeconds / 60;
    board.incrementSeconds = opts.incrementSeconds;
    board.timeLabel = opts.timeLabel;
    board.whitePlayerId = opts.whitePlayerId;
    board.blackPlayerId = '';
    whitePlayer.currentBoardId = opts.boardId;

    whiteClient.send('tournament_seated', { boardId: opts.boardId, color: 'w', seat: 'bottom' });
    blackClient.send('tournament_seated', { boardId: opts.boardId, color: 'b', seat: 'top' });

    this.startMatch(board, blackPlayer, blackClient);
    console.log(`[WorldRoom] Force-started tournament match on ${opts.boardId}: ${whitePlayer.username} vs ${blackPlayer.username}`);
    return 'started';
  }

  private async tick() {
    const now = Date.now();
    const timedOutMatches: MatchState[] = [];
    const entries: [string, MatchState][] = [];
    this.state.matches.forEach((match, matchId) => entries.push([matchId, match]));
    for (const [matchId, match] of entries) {
      if (match.status !== 'playing') continue;
      // Clocks are frozen during a reconnect window — no flag falls.
      if (match.clockPausedAt > 0) continue;

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

  hasPlayerById(playerId: string): boolean {
    for (const p of this.state.players.values()) {
      if (p.id === playerId) return true;
    }
    return false;
  }

  /** Like hasPlayerById, but the player must ALSO have a live client attached.
   *  Guards the W.O. sweep against ghost state entries (half-open sockets or
   *  a stalled onLeave) that otherwise count as "present" for minutes. */
  hasActivePlayerById(playerId: string): boolean {
    let sessionId: string | null = null;
    this.state.players.forEach((p, sid) => {
      if (p.id === playerId) sessionId = sid;
    });
    if (!sessionId) return false;
    return this.clients.some((c) => c.sessionId === sessionId);
  }

  /** Freeze both clocks: bank the elapsed time into the side to move, then stop. */
  private pauseMatchClock(match: MatchState) {
    if (match.status !== 'playing' || match.clockPausedAt > 0) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - match.lastMoveAt);
    if (match.turn === 'w') {
      match.whiteTimeMs = Math.max(0, match.whiteTimeMs - elapsed);
    } else {
      match.blackTimeMs = Math.max(0, match.blackTimeMs - elapsed);
    }
    match.lastMoveAt = now;
    match.clockPausedAt = now;
    console.log(`[WorldRoom] Clocks paused for match ${match.id}`);
  }

  private resumeMatchClock(match: MatchState) {
    if (match.clockPausedAt === 0) return;
    match.clockPausedAt = 0;
    match.lastMoveAt = Date.now();
    console.log(`[WorldRoom] Clocks resumed for match ${match.id}`);
  }

  /** Coordinator callback after a W.O. forfeit is written: free the board,
   *  stand the participants up and tell them the outcome in real time. */
  resolveTournamentWalkover(boardId: string, result: string, whitePlayerId: string, blackPlayerId: string) {
    const board = this.state.boards.get(boardId);
    if (board && board.status !== 'playing') {
      this.resetBoard(board);
    }
    const winnerId = result === '+/-' ? whitePlayerId : result === '-/+' ? blackPlayerId : '';
    for (const pid of [whitePlayerId, blackPlayerId]) {
      if (!pid) continue;
      const sessionId = this.findSessionByPlayerId(pid);
      if (!sessionId) continue;
      const p = this.state.players.get(sessionId);
      if (p && p.currentBoardId === boardId) p.currentBoardId = '';
      const c = this.clients.find((cl) => cl.sessionId === sessionId);
      c?.send('tournament_wo', { boardId, result, winnerId, youWin: !!winnerId && pid === winnerId });
    }
    console.log(`[WorldRoom] W.O. resolved on ${boardId}: ${result}`);
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

    // Clear draw offer counters for this match
    this.drawOfferCounts.delete(match.id);
    this.pendingDrawOffers.delete(match.id);

    // Central place every match-end path passes through: make sure no
    // reconnect grace timer survives the match it belonged to.
    const timers = this.disconnectTimers.get(match.id);
    if (timers) {
      timers.forEach((t) => clearTimeout(t));
      this.disconnectTimers.delete(match.id);
    }
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
          // An abandon with no winner means BOTH players vanished during
          // their grace windows — that is a double forfeit, not a draw.
          result = match.result === 'abandon' ? '-/-' : '1/2-1/2';
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
      // (skip double forfeits — there is no winner and no draw to credit)
      if (pairing.updated && pairing.whitePlayerId && pairing.blackPlayerId && result !== '-/-') {
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
    let whitePlayerElo: number;
    let blackPlayerElo: number;

    if (board.whitePlayerId === board.waitingPlayerId) {
      // Challenger chose white
      whiteId = board.waitingPlayerId;
      blackId = joiningPlayer.id;
      const whiteSession = this.findSessionByPlayerId(whiteId);
      const whitePlayer = whiteSession ? this.state.players.get(whiteSession) : null;
      whitePlayerName = whitePlayer?.username || 'Player';
      whitePlayerElo = whitePlayer?.rating || 1200;
      blackPlayerName = joiningPlayer.username;
      blackPlayerElo = joiningPlayer.rating || 1200;
    } else {
      // Challenger chose black
      blackId = board.waitingPlayerId;
      whiteId = joiningPlayer.id;
      const blackSession = this.findSessionByPlayerId(blackId);
      const blackPlayer = blackSession ? this.state.players.get(blackSession) : null;
      blackPlayerName = blackPlayer?.username || 'Player';
      blackPlayerElo = blackPlayer?.rating || 1200;
      whitePlayerName = joiningPlayer.username;
      whitePlayerElo = joiningPlayer.rating || 1200;
    }

    const match = new MatchState();
    match.id = matchId;
    match.boardId = board.id;
    match.region = joiningPlayer.region;
    match.whitePlayerId = whiteId;
    match.blackPlayerId = blackId;
    match.whitePlayerName = whitePlayerName;
    match.blackPlayerName = blackPlayerName;
    match.whitePlayerElo = whitePlayerElo;
    match.blackPlayerElo = blackPlayerElo;
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
