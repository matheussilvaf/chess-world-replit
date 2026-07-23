import { useState, useRef, useCallback, useEffect } from 'react';
import { useChessStore } from '../../stores/chessStore';
import { useAuthStore } from '../../stores/authStore';
import { BOARD_THEMES } from '../../config/game';
import { X, Flag, Eye } from 'lucide-react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const PIECE_IMAGES: Record<string, string> = {
  wp: '/assets/chesspieces/whitepawn.png',
  wn: '/assets/chesspieces/whiteknight.png',
  wb: '/assets/chesspieces/whitebishop.png',
  wr: '/assets/chesspieces/whiterock.png',
  wq: '/assets/chesspieces/whitequeen.png',
  wk: '/assets/chesspieces/whiteking.png',
  bp: '/assets/chesspieces/blackpawn.png',
  bn: '/assets/chesspieces/blackknight.png',
  bb: '/assets/chesspieces/blackbiship.png',
  br: '/assets/chesspieces/blackrock.png',
  bq: '/assets/chesspieces/blackqueen.png',
  bk: '/assets/chesspieces/blackking.png',
};

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function useDisplayTimes() {
  const { whiteTimeMs, blackTimeMs, lastMoveAt, turn, gameOver } = useChessStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [gameOver]);

  const elapsed = gameOver ? 0 : Math.max(0, now - lastMoveAt);
  const displayWhite = turn === 'w' ? Math.max(0, whiteTimeMs - elapsed) : whiteTimeMs;
  const displayBlack = turn === 'b' ? Math.max(0, blackTimeMs - elapsed) : blackTimeMs;

  return { displayWhite, displayBlack };
}

export function ChessBoard() {
  const {
    game, playerColor, selectedSquare, validMoves, isMyTurn,
    gameOver, result, winnerId, isSpectating,
    turn, whitePlayerName, blackPlayerName,
  } = useChessStore();
  const { selectSquare, makeMove, resign, closeBoard } = useChessStore();
  const { user, profile } = useAuthStore();
  const { displayWhite, displayBlack } = useDisplayTimes();

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const boardTheme = BOARD_THEMES.find(t => t.id === (profile?.board_theme || 'classic')) || BOARD_THEMES[0];

  if (!game) return null;

  const board = game.board();
  const displayBoard = playerColor === 'b' ? [...board].reverse().map(row => [...row].reverse()) : board;
  const displayFiles = playerColor === 'b' ? [...FILES].reverse() : FILES;
  const displayRanks = playerColor === 'b' ? [...RANKS].reverse() : RANKS;

  const topTimeMs = playerColor === 'w' ? displayBlack : displayWhite;
  const bottomTimeMs = playerColor === 'w' ? displayWhite : displayBlack;
  const topActive = playerColor === 'w' ? turn === 'b' : turn === 'w';
  const bottomActive = playerColor === 'w' ? turn === 'w' : turn === 'b';

  const opponentName = playerColor === 'w' ? blackPlayerName : whitePlayerName;
  const myName = playerColor === 'w' ? whitePlayerName : blackPlayerName;

  const getSquareFromIndices = (rankIdx: number, fileIdx: number) => {
    const actualRank = playerColor === 'b' ? 7 - rankIdx : rankIdx;
    const actualFile = playerColor === 'b' ? 7 - fileIdx : fileIdx;
    return FILES[actualFile] + RANKS[actualRank];
  };

  const handleSquareClick = (rankIdx: number, fileIdx: number) => {
    if (dragging || isSpectating || !isMyTurn || gameOver) return;
    const square = getSquareFromIndices(rankIdx, fileIdx);

    if (selectedSquare && validMoves.includes(square)) {
      makeMove(selectedSquare, square);
    } else {
      selectSquare(square);
    }
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent, rankIdx: number, fileIdx: number) => {
    if (gameOver || !isMyTurn || isSpectating) return;
    const square = getSquareFromIndices(rankIdx, fileIdx);
    const piece = game.get(square as any);
    if (!piece || piece.color !== playerColor) return;

    e.preventDefault();
    selectSquare(square);
    setDragging(square);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragPos({ x: clientX, y: clientY });
  };

  const handleDragMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragPos({ x: clientX, y: clientY });
  }, [dragging]);

  const handleDragEnd = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging || !boardRef.current) {
      setDragging(null);
      setDragPos(null);
      return;
    }

    const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
    const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;

    const rect = boardRef.current.getBoundingClientRect();
    const squareSize = rect.width / 8;
    const fileIdx = Math.floor((clientX - rect.left) / squareSize);
    const rankIdx = Math.floor((clientY - rect.top) / squareSize);

    if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
      const targetSquare = getSquareFromIndices(rankIdx, fileIdx);
      if (validMoves.includes(targetSquare)) {
        makeMove(dragging, targetSquare);
      }
    }

    setDragging(null);
    setDragPos(null);
  }, [dragging, validMoves, makeMove]);

  const handleResign = () => {
    if (!gameOver && !resignConfirm) {
      setResignConfirm(true);
      return;
    }
    if (!gameOver && resignConfirm) {
      resign();
      setResignConfirm(false);
    }
  };

  const [resignConfirm, setResignConfirm] = useState(false);

  const inCheck = game.inCheck();
  const kingSquare = inCheck ? findKingSquare(game, game.turn()) : null;

  const resultText = (() => {
    if (!gameOver) return null;
    if (isSpectating) {
      if (result === 'checkmate') return 'Checkmate!';
      if (result === 'timeout') return 'Time out!';
      if (result === 'resign') return 'Resigned!';
      if (result === 'abandon') return 'Player disconnected!';
      if (result === 'stalemate') return 'Stalemate';
      return 'Game over';
    }
    const iWon = winnerId === user?.id;
    if (result === 'checkmate') return iWon ? 'You won by checkmate!' : 'You lost by checkmate.';
    if (result === 'timeout') return iWon ? 'Opponent ran out of time!' : 'You ran out of time.';
    if (result === 'resign') return iWon ? 'Opponent resigned!' : 'You resigned.';
    if (result === 'abandon') return iWon ? 'Opponent disconnected!' : 'You disconnected.';
    if (result === 'stalemate') return 'Draw by stalemate.';
    return 'Game over';
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-4">
      <div
        className="bg-slate-900 rounded-2xl border border-slate-700/80 w-full max-w-[520px] flex flex-col max-h-[95vh] overflow-hidden shadow-2xl"
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        {/* Top player info + timer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <img src={PIECE_IMAGES[playerColor === 'w' ? 'bk' : 'wk']} alt="" className="w-5 h-5" />
            </div>
            <div>
              <div className="text-white font-semibold text-sm">{isSpectating ? whitePlayerName : opponentName}</div>
              {isSpectating && <div className="text-slate-400 text-xs">White</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`px-3 py-1.5 rounded-lg font-mono text-lg font-bold min-w-[80px] text-center ${
              topActive && !gameOver
                ? topTimeMs < 30000 ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
              {formatTime(topTimeMs)}
            </div>
            <button onClick={closeBoard} className="text-slate-400 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status bar */}
        {gameOver && (
          <div className="px-4 py-2 text-center border-b border-slate-800">
            <div className="text-amber-400 font-semibold text-sm">{resultText}</div>
          </div>
        )}
        {!gameOver && inCheck && !isSpectating && (
          <div className="px-4 py-2 text-center border-b border-slate-800">
            <div className="text-red-400 text-sm font-medium animate-pulse">CHECK!</div>
          </div>
        )}
        {isSpectating && !gameOver && (
          <div className="px-4 py-1.5 text-center border-b border-slate-800">
            <div className="text-blue-400 text-xs font-medium flex items-center justify-center gap-1.5">
              <Eye className="w-3 h-3" /> Watching live
            </div>
          </div>
        )}

        {/* Board */}
        <div className="flex-1 flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-[460px] relative">
            <div
              ref={boardRef}
              className="aspect-square w-full grid grid-cols-8 grid-rows-8 border-2 border-slate-600 rounded-sm overflow-hidden select-none"
              style={{ touchAction: 'none' }}
            >
              {displayBoard.map((row, rankIdx) =>
                row.map((piece, fileIdx) => {
                  const square = getSquareFromIndices(rankIdx, fileIdx);
                  const isLight = (rankIdx + fileIdx) % 2 === 0;
                  const isSelected = selectedSquare === square;
                  const isValidMove = validMoves.includes(square);
                  const isKingInCheck = kingSquare === square;
                  const isDragSource = dragging === square;

                  let bgColor: string = isLight ? boardTheme.light : boardTheme.dark;
                  if (isSelected) bgColor = '#FFFF00AA';
                  if (isKingInCheck) bgColor = '#EF4444';

                  const pieceKey = piece ? piece.color + piece.type : null;

                  return (
                    <div
                      key={square}
                      onClick={() => handleSquareClick(rankIdx, fileIdx)}
                      onMouseDown={(e) => handleDragStart(e, rankIdx, fileIdx)}
                      onTouchStart={(e) => handleDragStart(e, rankIdx, fileIdx)}
                      className="relative flex items-center justify-center cursor-pointer"
                      style={{ backgroundColor: bgColor }}
                    >
                      {isValidMove && (
                        <div className={`absolute z-10 ${piece ? 'inset-0 border-[3px] border-emerald-500/60 rounded-sm' : 'w-[28%] h-[28%] rounded-full bg-emerald-700/40'}`} />
                      )}

                      {pieceKey && !isDragSource && (
                        <img
                          src={PIECE_IMAGES[pieceKey]}
                          alt={pieceKey}
                          className="w-[82%] h-[82%] object-contain pointer-events-none z-20 drop-shadow-md"
                          draggable={false}
                        />
                      )}

                      {rankIdx === 7 && (
                        <span
                          className="absolute bottom-[1px] right-[3px] text-[10px] font-bold leading-none pointer-events-none z-30"
                          style={{ color: isLight ? boardTheme.dark : boardTheme.light, opacity: 0.7 }}
                        >
                          {displayFiles[fileIdx]}
                        </span>
                      )}
                      {fileIdx === 0 && (
                        <span
                          className="absolute top-[1px] left-[3px] text-[10px] font-bold leading-none pointer-events-none z-30"
                          style={{ color: isLight ? boardTheme.dark : boardTheme.light, opacity: 0.7 }}
                        >
                          {displayRanks[rankIdx]}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Drag ghost */}
            {dragging && dragPos && game.get(dragging as any) && (
              <img
                src={PIECE_IMAGES[game.get(dragging as any)!.color + game.get(dragging as any)!.type]}
                alt=""
                className="fixed w-16 h-16 pointer-events-none z-[100] drop-shadow-lg opacity-90"
                style={{ left: dragPos.x - 32, top: dragPos.y - 32 }}
                draggable={false}
              />
            )}
          </div>
        </div>

        {/* Bottom player info + controls */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-800">
          <div className="flex items-center gap-3">
            {isSpectating ? (
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-400" />
                <div>
                  <div className="text-white font-semibold text-sm">{blackPlayerName}</div>
                  <div className="text-slate-400 text-xs">Black</div>
                </div>
              </div>
            ) : (
              <>
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                  <img src={PIECE_IMAGES[playerColor === 'w' ? 'wk' : 'bk']} alt="" className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-white font-semibold text-sm">{myName || profile?.username || 'You'}</div>
                  <div className="text-slate-400 text-xs">{profile?.rating || 1200} ELO</div>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isSpectating && (
              <div className={`px-3 py-1.5 rounded-lg font-mono text-lg font-bold min-w-[80px] text-center ${
                bottomActive && !gameOver
                  ? bottomTimeMs < 30000 ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {formatTime(bottomTimeMs)}
              </div>
            )}
            {isSpectating ? (
              <div className={`px-3 py-1.5 rounded-lg font-mono text-lg font-bold min-w-[80px] text-center ${
                turn === 'b' && !gameOver
                  ? displayBlack < 30000 ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {formatTime(displayBlack)}
              </div>
            ) : !gameOver ? (
              <button
                onClick={handleResign}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/25 transition-colors border border-red-500/20"
              >
                <Flag className="w-3.5 h-3.5" />
                Resign
              </button>
            ) : (
              <button
                onClick={closeBoard}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-semibold hover:bg-emerald-500/30 transition-colors border border-emerald-500/30"
              >
                Back to Map
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function findKingSquare(game: any, color: string): string | null {
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.type === 'k' && piece.color === color) {
        return FILES[c] + RANKS[r];
      }
    }
  }
  return null;
}
