import { useState, useEffect } from 'react';
import { useChessStore } from '../../stores/chessStore';
import { Flag, Clock } from 'lucide-react';

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function MatchHUD() {
  const {
    matchId, playerColor, turn, gameOver, isSpectating,
    whiteTimeMs, blackTimeMs, lastMoveAt,
    whitePlayerName, blackPlayerName,
  } = useChessStore();
  const { resign } = useChessStore();

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!matchId || gameOver) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [matchId, gameOver]);

  if (!matchId) return null;

  const elapsed = gameOver ? 0 : Math.max(0, now - lastMoveAt);
  const displayWhite = turn === 'w' ? Math.max(0, whiteTimeMs - elapsed) : whiteTimeMs;
  const displayBlack = turn === 'b' ? Math.max(0, blackTimeMs - elapsed) : blackTimeMs;

  const isLow = (ms: number) => ms < 30000;

  const handleResign = () => {
    if (gameOver || isSpectating) return;
    if (window.confirm('Are you sure you want to resign?')) {
      resign();
    }
  };

  // Top = opponent, Bottom = local player
  const isBlack = playerColor === 'b';
  const topName = isBlack ? whitePlayerName : blackPlayerName;
  const topTime = isBlack ? displayWhite : displayBlack;
  const topActive = isBlack ? turn === 'w' : turn === 'b';
  const bottomName = isBlack ? blackPlayerName : whitePlayerName;
  const bottomTime = isBlack ? displayBlack : displayWhite;
  const bottomActive = isBlack ? turn === 'b' : turn === 'w';

  return (
    <div className="fixed inset-x-0 bottom-0 z-[200] pointer-events-none flex flex-col items-center gap-2 pb-4">
      {/* Timer bar */}
      <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-sm border border-slate-700/80 rounded-xl px-4 py-2 flex items-center gap-4 shadow-xl">
        {/* Opponent timer */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
          topActive ? 'bg-slate-700/80' : 'bg-slate-800/50'
        }`}>
          <div className={`w-3 h-3 rounded-full ${isBlack ? 'bg-white' : 'bg-slate-900 border border-slate-500'}`} />
          <span className="text-slate-400 text-xs font-medium truncate max-w-[80px]">{topName}</span>
          <span className={`font-mono text-sm font-bold ${
            topActive ? (isLow(topTime) ? 'text-red-400' : 'text-white') : 'text-slate-500'
          }`}>
            {formatTime(topTime)}
          </span>
        </div>

        <Clock className="w-4 h-4 text-slate-500" />

        {/* Local player timer */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
          bottomActive ? 'bg-emerald-900/40 border border-emerald-700/50' : 'bg-slate-800/50'
        }`}>
          <div className={`w-3 h-3 rounded-full ${isBlack ? 'bg-slate-900 border border-slate-500' : 'bg-white'}`} />
          <span className="text-slate-300 text-xs font-medium truncate max-w-[80px]">{bottomName}</span>
          <span className={`font-mono text-sm font-bold ${
            bottomActive ? (isLow(bottomTime) ? 'text-red-400' : 'text-emerald-400') : 'text-slate-500'
          }`}>
            {formatTime(bottomTime)}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      {!isSpectating && !gameOver && (
        <div className="pointer-events-auto">
          <button
            onClick={handleResign}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/25 transition-colors shadow-lg"
          >
            <Flag className="w-4 h-4" />
            Resign
          </button>
        </div>
      )}

      {/* Game over message */}
      {gameOver && (
        <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-sm border border-amber-500/50 rounded-xl px-5 py-3 text-center shadow-xl">
          <p className="text-amber-400 font-bold text-sm">Game Over</p>
          <p className="text-slate-300 text-xs mt-1">
            {useChessStore.getState().result || 'Match ended'}
          </p>
        </div>
      )}
    </div>
  );
}
