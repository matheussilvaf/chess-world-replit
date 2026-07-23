import { create } from 'zustand';
import { Chess } from 'chess.js';
import { sendChessMove, sendResign, getActiveRoom } from '../game/network/colyseusClient';
import { chessAudio, getSoundForSan } from '../game/audio/chessAudio';
import { supabase } from '../lib/supabase';

interface MoveRecord {
  san: string;
  from: string;
  to: string;
  fen: string;
}

interface ChessState {
  matchId: string | null;
  boardId: string | null;
  game: Chess | null;
  playerColor: 'w' | 'b' | null;
  selectedSquare: string | null;
  validMoves: string[];
  isMyTurn: boolean;
  gameOver: boolean;
  result: string | null;
  winnerId: string | null;
  isSpectating: boolean;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
  incrementMs: number;
  turn: string;
  whitePlayerName: string;
  blackPlayerName: string;
  whitePlayerId: string;
  blackPlayerId: string;
  showBoard: boolean;
  lastMove: { from: string; to: string } | null;

  // Move history for navigation
  moveHistory: MoveRecord[];
  viewIndex: number; // -1 means viewing live/current position
  dbMatchId: string | null; // UUID for the database match record

  openMatch: (matchId: string, color: 'w' | 'b', userId: string, boardId?: string) => void;
  openSpectate: (matchId: string) => void;
  syncFromColyseus: (matchData: any) => void;
  selectSquare: (square: string) => void;
  makeMove: (from: string, to: string, promotion?: string) => void;
  finishMatchFromServer: (payload: { matchId: string; boardId?: string; result: string; winnerId?: string }) => void;
  resign: () => void;
  closeBoard: () => void;
  reopenBoard: () => void;
  tickTimer: () => void;
  reset: () => void;

  // Navigation
  goToStart: () => void;
  goBack: () => void;
  goForward: () => void;
  goToLive: () => void;
}

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function createDbMatch(matchId: string, whiteUserId: string, blackUserId: string, region: string, boardId: string | null, timeMinutes: number, incrementSeconds: number) {
  try {
    const { error } = await supabase.from('matches').insert({
      id: undefined,
      region,
      board_id: boardId || null,
      white_user_id: whiteUserId,
      black_user_id: blackUserId,
      current_fen: INITIAL_FEN,
      pgn: '',
      status: 'playing',
      turn: 'w',
      time_minutes: timeMinutes,
      increment_seconds: incrementSeconds,
    });
    if (error) console.error('[ChessStore] Failed to create DB match:', error.message);
  } catch (e) {
    console.error('[ChessStore] createDbMatch exception:', e);
  }
}

async function saveMoveToDB(dbMatchId: string, moveNumber: number, userId: string, from: string, to: string, san: string, fenAfter: string) {
  try {
    const { error } = await supabase.from('match_moves').insert({
      match_id: dbMatchId,
      move_number: moveNumber,
      user_id: userId,
      from_square: from,
      to_square: to,
      san,
      fen_after: fenAfter,
    });
    if (error) console.error('[ChessStore] Failed to save move:', error.message);
  } catch (e) {
    console.error('[ChessStore] saveMoveToDB exception:', e);
  }
}

async function updateDbMatchStatus(dbMatchId: string, status: string, result: string | null, winnerId: string | null, finalFen: string) {
  try {
    const { error } = await supabase.from('matches').update({
      status,
      result,
      winner_user_id: winnerId,
      current_fen: finalFen,
      finished_at: new Date().toISOString(),
    }).eq('id', dbMatchId);
    if (error) console.error('[ChessStore] Failed to update match status:', error.message);
  } catch (e) {
    console.error('[ChessStore] updateDbMatchStatus exception:', e);
  }
}

export const useChessStore = create<ChessState>((set, get) => ({
  matchId: null,
  boardId: null,
  game: null,
  playerColor: null,
  selectedSquare: null,
  validMoves: [],
  isMyTurn: false,
  gameOver: false,
  result: null,
  winnerId: null,
  isSpectating: false,
  whiteTimeMs: 600000,
  blackTimeMs: 600000,
  lastMoveAt: Date.now(),
  incrementMs: 0,
  turn: 'w',
  whitePlayerName: '',
  blackPlayerName: '',
  whitePlayerId: '',
  blackPlayerId: '',
  showBoard: false,
  lastMove: null,
  moveHistory: [],
  viewIndex: -1,
  dbMatchId: null,

  openMatch: (matchId, color, _userId, boardIdArg) => {
    const room = getActiveRoom();
    let matchData: any = null;
    if (room?.state?.matches) {
      room.state.matches.forEach((m: any, id: string) => {
        if (id === matchId) matchData = m;
      });
    }

    const fen = matchData?.fen || undefined;
    const game = new Chess(fen);
    const boardId = boardIdArg || matchData?.boardId || null;

    chessAudio.play('startGame');

    set({
      matchId,
      boardId,
      game,
      playerColor: color,
      isMyTurn: (matchData?.turn || 'w') === color,
      gameOver: matchData ? matchData.status !== 'playing' : false,
      result: matchData?.result || null,
      winnerId: matchData?.winnerId || null,
      isSpectating: false,
      whiteTimeMs: matchData?.whiteTimeMs || 600000,
      blackTimeMs: matchData?.blackTimeMs || 600000,
      lastMoveAt: matchData?.lastMoveAt || Date.now(),
      incrementMs: matchData?.incrementMs || 0,
      turn: matchData?.turn || 'w',
      whitePlayerName: matchData?.whitePlayerName || 'White',
      blackPlayerName: matchData?.blackPlayerName || 'Black',
      whitePlayerId: matchData?.whitePlayerId || '',
      blackPlayerId: matchData?.blackPlayerId || '',
      selectedSquare: null,
      validMoves: [],
      lastMove: null,
      showBoard: true,
      moveHistory: [],
      viewIndex: -1,
      dbMatchId: null,
    });

    // Create the DB match record (fire and forget) — skip for tournament tables (server persists those)
    const isTournamentTable = boardId && typeof boardId === 'string' && boardId.includes('_table_');
    if (!isTournamentTable && color === 'w' && matchData?.whitePlayerId && matchData?.blackPlayerId) {
      const timeMinutes = matchData?.whiteTimeMs ? Math.round(matchData.whiteTimeMs / 60000) : 10;
      const incrementSec = matchData?.incrementMs ? Math.round(matchData.incrementMs / 1000) : 0;
      createDbMatch(
        matchId,
        matchData.whitePlayerId,
        matchData.blackPlayerId,
        matchData.region || 'default',
        boardId,
        timeMinutes,
        incrementSec,
      ).then(async () => {
        // Retrieve the created record to get the DB-generated UUID
        const { data } = await supabase
          .from('matches')
          .select('id')
          .eq('white_user_id', matchData.whitePlayerId)
          .eq('black_user_id', matchData.blackPlayerId)
          .eq('status', 'playing')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          set({ dbMatchId: data.id });
        }
      });
    }
  },

  openSpectate: (matchId) => {
    const room = getActiveRoom();
    if (!room?.state?.matches) return;

    let matchData: any = null;
    room.state.matches.forEach((m: any, id: string) => {
      if (id === matchId) matchData = m;
    });

    if (!matchData) return;

    const game = new Chess(matchData.fen || undefined);

    chessAudio.play('startGame');

    set({
      matchId,
      boardId: matchData.boardId,
      game,
      playerColor: 'w',
      isMyTurn: false,
      gameOver: matchData.status !== 'playing',
      result: matchData.result || null,
      winnerId: matchData.winnerId || null,
      isSpectating: true,
      whiteTimeMs: matchData.whiteTimeMs,
      blackTimeMs: matchData.blackTimeMs,
      lastMoveAt: matchData.lastMoveAt,
      incrementMs: matchData.incrementMs || 0,
      turn: matchData.turn,
      whitePlayerName: matchData.whitePlayerName || 'White',
      blackPlayerName: matchData.blackPlayerName || 'Black',
      whitePlayerId: matchData.whitePlayerId,
      blackPlayerId: matchData.blackPlayerId,
      selectedSquare: null,
      validMoves: [],
      moveHistory: [],
      viewIndex: -1,
    });
  },

  syncFromColyseus: (matchData) => {
    const { matchId, game, playerColor, isSpectating, gameOver: wasGameOver, turn: prevTurn, moveHistory, dbMatchId } = get();
    if (!matchId || !game) return;
    if (matchData.id !== matchId) return;

    const newGameOver = matchData.status !== 'playing';
    const turnChanged = matchData.turn !== prevTurn;
    const isMyTurn = !isSpectating && !newGameOver && matchData.turn === playerColor;

    const opponentJustMoved = turnChanged && matchData.turn === playerColor;
    const spectatorSync = isSpectating && turnChanged;

    if ((opponentJustMoved || spectatorSync) && matchData.lastMoveSan) {
      const sound = getSoundForSan(matchData.lastMoveSan, newGameOver, matchData.result || null);
      chessAudio.play(sound);
    }

    if (!wasGameOver && newGameOver) {
      if (matchData.result === 'checkmate') {
        if (!opponentJustMoved && !spectatorSync) {
          chessAudio.play('checkmate');
        }
      } else if (matchData.result === 'resign' || matchData.result === 'timeout' || matchData.result === 'abandon') {
        chessAudio.play('gameOver');
      } else {
        chessAudio.play('gameOver');
      }
      // Update DB match when game ends (only white player saves to avoid duplicates)
      if (dbMatchId && playerColor === 'w') {
        updateDbMatchStatus(dbMatchId, 'finished', matchData.result || 'draw', matchData.winnerId || null, matchData.fen);
      }
    }

    // Determine last move BEFORE loading the new FEN
    let newLastMove = get().lastMove;
    let newMoveRecord: MoveRecord | null = null;

    if (matchData.lastMoveFrom && matchData.lastMoveTo) {
      newLastMove = { from: matchData.lastMoveFrom, to: matchData.lastMoveTo };
      if (turnChanged && matchData.lastMoveSan) {
        newMoveRecord = {
          san: matchData.lastMoveSan,
          from: matchData.lastMoveFrom,
          to: matchData.lastMoveTo,
          fen: matchData.fen,
        };
      }
    } else if (turnChanged && matchData.lastMoveSan) {
      try {
        const tempMove = game.move(matchData.lastMoveSan);
        if (tempMove) {
          newLastMove = { from: tempMove.from, to: tempMove.to };
          newMoveRecord = {
            san: matchData.lastMoveSan,
            from: tempMove.from,
            to: tempMove.to,
            fen: matchData.fen,
          };
          game.undo();
        }
      } catch { /* ignore parse errors */ }
    }

    game.load(matchData.fen);

    // Add opponent/spectator moves to history
    const updatedHistory = newMoveRecord && (opponentJustMoved || spectatorSync)
      ? [...moveHistory, newMoveRecord]
      : moveHistory;

    // Save opponent move to DB (only the opponent's client saves their own moves)
    if (newMoveRecord && opponentJustMoved && dbMatchId && playerColor) {
      const movingPlayerId = playerColor === 'w' ? get().blackPlayerId : get().whitePlayerId;
      saveMoveToDB(dbMatchId, updatedHistory.length, movingPlayerId, newMoveRecord.from, newMoveRecord.to, newMoveRecord.san, newMoveRecord.fen);
    }

    set({
      isMyTurn,
      gameOver: newGameOver,
      result: matchData.result || null,
      winnerId: matchData.winnerId || null,
      whiteTimeMs: matchData.whiteTimeMs,
      blackTimeMs: matchData.blackTimeMs,
      lastMoveAt: matchData.lastMoveAt,
      turn: matchData.turn,
      selectedSquare: null,
      validMoves: [],
      lastMove: newLastMove,
      moveHistory: updatedHistory,
      viewIndex: -1, // Snap to live when new move arrives
    });
  },

  selectSquare: (square) => {
    const { game, playerColor, isMyTurn, selectedSquare, gameOver, isSpectating, viewIndex } = get();
    if (!game || !playerColor || !isMyTurn || gameOver || isSpectating) return;
    if (viewIndex !== -1) return; // Can't select while viewing history

    if (selectedSquare) {
      set({ selectedSquare: null, validMoves: [] });
      return;
    }

    const piece = game.get(square as any);
    if (piece && piece.color === playerColor) {
      const moves = game.moves({ square: square as any, verbose: true });
      set({ selectedSquare: square, validMoves: moves.map(m => m.to) });
    }
  },

  makeMove: (from, to, promotion) => {
    const { matchId, game, playerColor, moveHistory, dbMatchId } = get();
    if (!matchId || !game || !playerColor) return;

    const piece = game.get(from as any);
    const actualPromotion = promotion || (piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined);

    const moveResult = game.move({ from, to, promotion: actualPromotion || undefined });
    if (!moveResult) return;

    const isGameOver = game.isGameOver();
    const sound = getSoundForSan(moveResult.san, isGameOver, isGameOver && game.isCheckmate() ? 'checkmate' : null);
    chessAudio.play(sound);

    const newRecord: MoveRecord = {
      san: moveResult.san,
      from,
      to,
      fen: game.fen(),
    };

    const updatedHistory = [...moveHistory, newRecord];

    set({
      selectedSquare: null,
      validMoves: [],
      isMyTurn: false,
      turn: game.turn(),
      lastMove: { from, to },
      moveHistory: updatedHistory,
      viewIndex: -1,
    });

    sendChessMove(matchId, from, to, actualPromotion);

    // Save own move to DB
    if (dbMatchId) {
      const userId = playerColor === 'w' ? get().whitePlayerId : get().blackPlayerId;
      saveMoveToDB(dbMatchId, updatedHistory.length, userId, from, to, moveResult.san, game.fen());
    }
  },

  finishMatchFromServer: (payload) => {
    const { matchId, gameOver } = get();
    if (!payload.matchId || payload.matchId !== matchId) return;
    if (gameOver) return;

    const result = payload.result || 'unknown';
    if (result === 'checkmate') {
      chessAudio.play('checkmate');
    } else {
      chessAudio.play('gameOver');
    }

    set({
      gameOver: true,
      result,
      winnerId: payload.winnerId || null,
      isMyTurn: false,
      selectedSquare: null,
      validMoves: [],
    });
  },

  resign: () => {
    const { matchId } = get();
    if (!matchId) return;
    sendResign(matchId);
  },

  closeBoard: () => {
    set({ showBoard: false });
  },

  reopenBoard: () => {
    const { matchId } = get();
    if (matchId) {
      set({ showBoard: true });
    }
  },

  tickTimer: () => {
    // No-op: display time is computed in the component from server values
  },

  // Navigation: go to the very first position (before any moves)
  goToStart: () => {
    const { moveHistory } = get();
    if (moveHistory.length === 0) return;
    set({ viewIndex: 0 });
  },

  // Navigation: go back one move
  goBack: () => {
    const { moveHistory, viewIndex } = get();
    if (moveHistory.length === 0) return;
    const currentIdx = viewIndex === -1 ? moveHistory.length : viewIndex;
    if (currentIdx <= 0) return;
    set({ viewIndex: currentIdx - 1 });
  },

  // Navigation: go forward one move
  goForward: () => {
    const { moveHistory, viewIndex } = get();
    if (viewIndex === -1) return; // Already at live
    const nextIdx = viewIndex + 1;
    if (nextIdx >= moveHistory.length) {
      set({ viewIndex: -1 }); // Back to live
    } else {
      set({ viewIndex: nextIdx });
    }
  },

  // Navigation: go to current/live position
  goToLive: () => {
    set({ viewIndex: -1 });
  },

  reset: () => {
    set({
      matchId: null, boardId: null, game: null, playerColor: null,
      selectedSquare: null, validMoves: [], isMyTurn: false, gameOver: false,
      result: null, winnerId: null, isSpectating: false, showBoard: false,
      whiteTimeMs: 600000, blackTimeMs: 600000, lastMoveAt: Date.now(),
      incrementMs: 0, turn: 'w', whitePlayerName: '', blackPlayerName: '',
      whitePlayerId: '', blackPlayerId: '', lastMove: null,
      moveHistory: [], viewIndex: -1, dbMatchId: null,
    });
  },
}));
