import { useState, useEffect, useCallback } from 'react';
import { useChessStore } from '../../stores/chessStore';
import { Flag, Handshake, Clock } from 'lucide-react';

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function truncNick(name: string): string {
  if (name.length <= 7) return name;
  return name.slice(0, 7) + '…';
}

interface PlayerCardProps {
  name: string;
  elo: number;
  timeMs: number;
  isActive: boolean;
  isLow: boolean;
  isGameOver: boolean;
  pieceColor: 'white' | 'black';
  position: 'top' | 'bottom';
}

function PlayerCard({ name, elo, timeMs, isActive, isLow, isGameOver, pieceColor, position }: PlayerCardProps) {
  const posClass =
    position === 'top'
      ? 'fixed top-3 right-3 z-[200]'
      : 'fixed bottom-[5.5rem] right-3 z-[200]';

  return (
    <div className={`${posClass} pointer-events-none`}>
      <div
        className={`min-w-[120px] rounded-xl px-3 py-2.5 shadow-xl backdrop-blur-md border transition-all duration-300 ${
          isActive && !isGameOver
            ? 'bg-slate-800/95 border-emerald-500/70 shadow-emerald-500/10'
            : 'bg-slate-900/90 border-slate-700/50'
        }`}
      >
        {/* Name + elo row */}
        <div className="flex items-center gap-1.5 mb-2">
          <div
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm ${
              pieceColor === 'white'
                ? 'bg-white border border-slate-300'
                : 'bg-slate-700 border border-slate-500'
            }`}
          />
          <span className="text-white text-xs font-semibold leading-none tracking-tight">
            {truncNick(name)}
          </span>
          <span className="text-slate-400 text-[10px] leading-none">({elo})</span>
        </div>

        {/* Clock row */}
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors duration-300 ${
            isActive && !isGameOver ? 'bg-emerald-900/40' : 'bg-slate-800/60'
          }`}
        >
          <Clock
            className={`w-3 h-3 flex-shrink-0 ${
              isActive && !isGameOver ? 'text-emerald-400' : 'text-slate-500'
            }`}
          />
          <span
            className={`font-mono text-sm font-bold leading-none tabular-nums ${
              isActive && !isGameOver
                ? isLow
                  ? 'text-red-400'
                  : 'text-emerald-400'
                : 'text-slate-500'
            }`}
          >
            {formatTime(timeMs)}
          </span>
          {isActive && !isGameOver && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0 ml-auto" />
          )}
        </div>
      </div>
    </div>
  );
}

export function MatchHUD() {
  const matchId = useChessStore(s => s.matchId);
  const playerColor = useChessStore(s => s.playerColor);
  const turn = useChessStore(s => s.turn);
  const gameOver = useChessStore(s => s.gameOver);
  const isSpectating = useChessStore(s => s.isSpectating);
  const whiteTimeMs = useChessStore(s => s.whiteTimeMs);
  const blackTimeMs = useChessStore(s => s.blackTimeMs);
  const lastMoveAt = useChessStore(s => s.lastMoveAt);
  const whitePlayerName = useChessStore(s => s.whitePlayerName);
  const blackPlayerName = useChessStore(s => s.blackPlayerName);
  const whitePlayerElo = useChessStore(s => s.whitePlayerElo);
  const blackPlayerElo = useChessStore(s => s.blackPlayerElo);
  const drawOfferPending = useChessStore(s => s.drawOfferPending);
  const drawOfferedByUs = useChessStore(s => s.drawOfferedByUs);
  const result = useChessStore(s => s.result);
  const resign = useChessStore(s => s.resign);
  const sendDrawOffer = useChessStore(s => s.sendDrawOffer);
  const acceptDraw = useChessStore(s => s.acceptDraw);
  const declineDraw = useChessStore(s => s.declineDraw);

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!matchId || gameOver) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [matchId, gameOver]);

  const handleResign = useCallback(() => {
    if (gameOver || isSpectating) return;
    if (window.confirm('Are you sure you want to resign?')) {
      resign();
    }
  }, [gameOver, isSpectating, resign]);

  const handleDrawOffer = useCallback(() => {
    if (gameOver || isSpectating || drawOfferedByUs) return;
    sendDrawOffer();
  }, [gameOver, isSpectating, drawOfferedByUs, sendDrawOffer]);

  if (!matchId) return null;

  const elapsed = gameOver ? 0 : Math.max(0, now - lastMoveAt);
  const displayWhite = turn === 'w' ? Math.max(0, whiteTimeMs - elapsed) : whiteTimeMs;
  const displayBlack = turn === 'b' ? Math.max(0, blackTimeMs - elapsed) : blackTimeMs;
  const isLow = (ms: number) => ms < 30000;

  const isBlack = playerColor === 'b';

  const topName = isBlack ? whitePlayerName : blackPlayerName;
  const topElo = isBlack ? whitePlayerElo : blackPlayerElo;
  const topTime = isBlack ? displayWhite : displayBlack;
  const topActive = isBlack ? turn === 'w' : turn === 'b';
  const topColor: 'white' | 'black' = isBlack ? 'white' : 'black';

  const bottomName = isBlack ? blackPlayerName : whitePlayerName;
  const bottomElo = isBlack ? blackPlayerElo : whitePlayerElo;
  const bottomTime = isBlack ? displayBlack : displayWhite;
  const bottomActive = isBlack ? turn === 'b' : turn === 'w';
  const bottomColor: 'white' | 'black' = isBlack ? 'black' : 'white';

  return (
    <>
      {/* Opponent card — top right */}
      <PlayerCard
        name={topName}
        elo={topElo}
        timeMs={topTime}
        isActive={topActive}
        isLow={isLow(topTime)}
        isGameOver={gameOver}
        pieceColor={topColor}
        position="top"
      />

      {/* My card — bottom right */}
      <PlayerCard
        name={bottomName}
        elo={bottomElo}
        timeMs={bottomTime}
        isActive={bottomActive}
        isLow={isLow(bottomTime)}
        isGameOver={gameOver}
        pieceColor={bottomColor}
        position="bottom"
      />

      {/* Action buttons — bottom left */}
      {!isSpectating && !gameOver && (
        <div className="fixed bottom-[5.5rem] left-3 z-[200] pointer-events-auto flex flex-col gap-2">
          <button
            onClick={handleResign}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 font-semibold text-xs hover:bg-red-500/25 active:scale-95 transition-all shadow-lg backdrop-blur-md"
          >
            <Flag className="w-3.5 h-3.5" />
            Resign
          </button>
          <button
            onClick={handleDrawOffer}
            disabled={drawOfferedByUs}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border font-semibold text-xs transition-all shadow-lg backdrop-blur-md ${
              drawOfferedByUs
                ? 'bg-slate-800/50 border-slate-600/40 text-slate-500 cursor-not-allowed opacity-70'
                : 'bg-blue-500/15 border-blue-500/40 text-blue-400 hover:bg-blue-500/25 active:scale-95'
            }`}
          >
            <Handshake className="w-3.5 h-3.5" />
            {drawOfferedByUs ? 'Offered…' : 'Draw'}
          </button>
        </div>
      )}

      {/* Draw offer notification */}
      {drawOfferPending && !isSpectating && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center pointer-events-auto">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="relative bg-slate-900/98 backdrop-blur-md border border-blue-500/50 rounded-2xl px-6 py-5 shadow-2xl max-w-xs w-full mx-4 text-center">
            <div className="w-10 h-10 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto mb-3">
              <Handshake className="w-5 h-5 text-blue-400" />
            </div>
            <p className="text-white font-semibold text-sm mb-1">Draw Offered</p>
            <p className="text-slate-400 text-xs mb-4">
              Your opponent offered a draw. Do you accept?
            </p>
            <div className="flex gap-3">
              <button
                onClick={acceptDraw}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/30 active:scale-95 transition-all"
              >
                Accept
              </button>
              <button
                onClick={declineDraw}
                className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/25 active:scale-95 transition-all"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over message */}
      {gameOver && (
        <div className="fixed bottom-[5.5rem] left-1/2 -translate-x-1/2 z-[200] pointer-events-auto bg-slate-900/95 backdrop-blur-sm border border-amber-500/50 rounded-xl px-5 py-3 text-center shadow-xl">
          <p className="text-amber-400 font-bold text-sm">Game Over</p>
          <p className="text-slate-300 text-xs mt-1">{result || 'Match ended'}</p>
        </div>
      )}
    </>
  );
}
