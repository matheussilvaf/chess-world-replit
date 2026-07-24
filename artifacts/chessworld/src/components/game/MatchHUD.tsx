import { useState, useEffect, useCallback, useRef } from 'react';
import { useChessStore } from '../../stores/chessStore';
import { Flag, Handshake } from 'lucide-react';

/*
 * Board-anchored HUD.
 *
 * WorldScene publishes `window.__activeCameraFocusRect` every frame:
 *   { x, y, width, height, worldWidth } — the screen-space AABB of the active
 * table's camera_focus_area (~147.7 world px wide) plus its world width.
 * Scale factor s = rect.width / worldWidth converts world px -> screen px, so
 * every box keeps a fixed size and position RELATIVE TO THE BOARD through
 * zoom, pan and camera rotation. Each anchored wrapper gets fontSize = s px
 * and all inner sizing uses em, meaning 1em == 1 world pixel.
 *
 * NAV CLEARANCE MATH: the bottom nav pill is `bottom-2` (8px) + 50px tall
 * (36px buttons + 12px padding + 2px border) => its top edge sits 58px from
 * the viewport bottom. Board-anchored elements clamp their bottom edge to
 * >= NAV_CLEARANCE_PX (68px) above the viewport bottom, guaranteeing a
 * >= 10px gap to the nav pill at any zoom or pan position.
 */
const NAV_CLEARANCE_PX = 68;
const FOCUS_FALLBACK_WORLD_W = 147.721;

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

interface PlayerBoxProps {
  name: string;
  elo: number;
  timeMs: number;
  isActive: boolean;
  isLow: boolean;
  isGameOver: boolean;
  pieceColor: 'white' | 'black';
}

/** Content of a time box. Sized entirely in em (1em == 1 world px). */
function PlayerBox({ name, elo, timeMs, isActive, isLow, isGameOver, pieceColor }: PlayerBoxProps) {
  const active = isActive && !isGameOver;
  return (
    <div
      className={`rounded-[2em] border shadow-xl backdrop-blur-sm transition-colors duration-300 ${
        active
          ? 'bg-slate-800/95 border-emerald-500/70'
          : 'bg-slate-900/85 border-slate-700/60'
      }`}
      style={{ width: '50em', padding: '2em 2.5em' }}
    >
      {/* Name + elo row */}
      <div className="flex items-center" style={{ gap: '1.5em', marginBottom: '1.4em' }}>
        <span
          className={`rounded-full flex-shrink-0 ${
            pieceColor === 'white'
              ? 'bg-white border border-slate-300'
              : 'bg-slate-950 border border-slate-500'
          }`}
          style={{ width: '3em', height: '3em' }}
        />
        <span
          className="text-white font-semibold leading-none tracking-tight whitespace-nowrap overflow-hidden"
          style={{ fontSize: '4.8em' }}
        >
          {truncNick(name)}
        </span>
        <span className="text-slate-400 leading-none whitespace-nowrap" style={{ fontSize: '3.6em' }}>
          {elo}
        </span>
      </div>

      {/* Clock row */}
      <div
        className={`flex items-center justify-center rounded-[1.5em] transition-colors duration-300 ${
          active ? (isLow ? 'bg-red-900/50' : 'bg-emerald-900/40') : 'bg-slate-800/60'
        }`}
        style={{ padding: '1.2em 0', gap: '1.5em' }}
      >
        <span
          className={`font-mono font-bold leading-none tabular-nums ${
            active ? (isLow ? 'text-red-400 animate-pulse' : 'text-emerald-400') : 'text-slate-500'
          }`}
          style={{ fontSize: '7em' }}
        >
          {formatTime(timeMs)}
        </span>
        {active && (
          <span
            className={`rounded-full animate-pulse flex-shrink-0 ${isLow ? 'bg-red-400' : 'bg-emerald-400'}`}
            style={{ width: '1.6em', height: '1.6em' }}
          />
        )}
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
  const drawNotice = useChessStore(s => s.drawNotice);
  const setDrawNotice = useChessStore(s => s.setDrawNotice);
  const result = useChessStore(s => s.result);
  const resign = useChessStore(s => s.resign);
  const sendDrawOffer = useChessStore(s => s.sendDrawOffer);
  const acceptDraw = useChessStore(s => s.acceptDraw);
  const declineDraw = useChessStore(s => s.declineDraw);

  const [now, setNow] = useState(Date.now());

  const oppRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<HTMLDivElement>(null);
  const actRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchId || gameOver) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [matchId, gameOver]);

  // Track the board's camera-focus rect each frame and pin the boxes to it.
  useEffect(() => {
    if (!matchId) return;
    let raf = 0;
    const tick = () => {
      const rect = (window as any).__activeCameraFocusRect as
        | { x: number; y: number; width: number; height: number; worldWidth?: number }
        | null;
      const opp = oppRef.current;
      const me = meRef.current;
      const act = actRef.current;
      if (!rect || rect.width <= 0) {
        if (opp) opp.style.visibility = 'hidden';
        if (me) me.style.visibility = 'hidden';
        if (act) act.style.visibility = 'hidden';
      } else {
        const s = rect.width / (rect.worldWidth || FOCUS_FALLBACK_WORLD_W);
        const pad = 2.5 * s;
        const rightX = rect.x + rect.width - pad;
        const leftX = rect.x + pad;
        const topY = Math.max(rect.y + pad, 4);
        // Clamp so anchored elements can never touch the bottom nav pill.
        const bottomY = Math.min(rect.y + rect.height - pad, window.innerHeight - NAV_CLEARANCE_PX);
        if (opp) {
          opp.style.visibility = 'visible';
          opp.style.fontSize = `${s}px`;
          opp.style.left = `${rightX}px`;
          opp.style.top = `${topY}px`;
          opp.style.transform = 'translateX(-100%)';
        }
        if (me) {
          me.style.visibility = 'visible';
          me.style.fontSize = `${s}px`;
          me.style.left = `${rightX}px`;
          me.style.top = `${bottomY}px`;
          me.style.transform = 'translate(-100%, -100%)';
        }
        if (act) {
          act.style.visibility = 'visible';
          act.style.fontSize = `${s}px`;
          act.style.left = `${leftX}px`;
          act.style.top = `${bottomY}px`;
          act.style.transform = 'translateY(-100%)';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [matchId, isSpectating, gameOver]);

  // Auto-dismiss informational draw notices.
  useEffect(() => {
    if (!drawNotice) return;
    const t = setTimeout(() => setDrawNotice(null), 4000);
    return () => clearTimeout(t);
  }, [drawNotice, setDrawNotice]);

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
      {/* Opponent time box — glued to the board's top-right corner */}
      <div ref={oppRef} className="fixed z-[200] pointer-events-none" style={{ visibility: 'hidden' }}>
        <PlayerBox
          name={topName}
          elo={topElo}
          timeMs={topTime}
          isActive={topActive}
          isLow={isLow(topTime)}
          isGameOver={gameOver}
          pieceColor={topColor}
        />
      </div>

      {/* My time box — glued to the board's bottom-right corner */}
      <div ref={meRef} className="fixed z-[200] pointer-events-none" style={{ visibility: 'hidden' }}>
        <PlayerBox
          name={bottomName}
          elo={bottomElo}
          timeMs={bottomTime}
          isActive={bottomActive}
          isLow={isLow(bottomTime)}
          isGameOver={gameOver}
          pieceColor={bottomColor}
        />
      </div>

      {/* Resign / Draw — glued to the board's bottom-left corner */}
      {!isSpectating && !gameOver && (
        <div
          ref={actRef}
          className="fixed z-[200] pointer-events-auto flex flex-col"
          style={{ visibility: 'hidden', gap: '2em' }}
        >
          <button
            onClick={handleResign}
            className="flex items-center justify-center rounded-[1.8em] bg-red-500/20 border border-red-500/50 text-red-300 font-semibold hover:bg-red-500/30 active:scale-95 transition-all shadow-lg backdrop-blur-sm"
            style={{ width: '40em', padding: '1.6em 0', gap: '1.5em' }}
          >
            <Flag style={{ width: '4.2em', height: '4.2em' }} />
            <span className="leading-none" style={{ fontSize: '4.2em' }}>Resign</span>
          </button>
          <button
            onClick={handleDrawOffer}
            disabled={drawOfferedByUs}
            className={`flex items-center justify-center rounded-[1.8em] border font-semibold transition-all shadow-lg backdrop-blur-sm ${
              drawOfferedByUs
                ? 'bg-slate-800/60 border-slate-600/40 text-slate-500 cursor-not-allowed'
                : 'bg-blue-500/20 border-blue-500/50 text-blue-300 hover:bg-blue-500/30 active:scale-95'
            }`}
            style={{ width: '40em', padding: '1.6em 0', gap: '1.5em' }}
          >
            <Handshake style={{ width: '4.2em', height: '4.2em' }} />
            <span className="leading-none" style={{ fontSize: '4.2em' }}>
              {drawOfferedByUs ? 'Offered…' : 'Draw'}
            </span>
          </button>
        </div>
      )}

      {/* Incoming draw offer — non-invasive toast above the nav pill */}
      {drawOfferPending && !isSpectating && !gameOver && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[220] pointer-events-auto" style={{ bottom: 76 }}>
          <div className="animate-[hud-toast-in_0.3s_cubic-bezier(0.16,1,0.3,1)] flex items-center gap-3 rounded-2xl bg-slate-900/95 border border-blue-500/50 shadow-2xl backdrop-blur-md px-4 py-3">
            <span className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <Handshake className="w-4 h-4 text-blue-400" />
            </span>
            <div className="mr-1">
              <p className="text-white text-xs font-semibold leading-tight whitespace-nowrap">Draw offered</p>
              <p className="text-slate-400 text-[10px] leading-tight whitespace-nowrap">Your opponent offers a draw</p>
            </div>
            <button
              onClick={acceptDraw}
              className="px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 active:scale-95 transition-all"
            >
              Accept
            </button>
            <button
              onClick={declineDraw}
              className="px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/25 active:scale-95 transition-all"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Informational draw notice (declined / limit reached) */}
      {drawNotice && !gameOver && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[215] pointer-events-none"
          style={{ bottom: drawOfferPending && !isSpectating ? 148 : 76 }}
        >
          <div className="animate-[hud-toast-in_0.3s_ease-out] rounded-xl bg-slate-900/95 border border-slate-600/60 shadow-xl backdrop-blur-md px-4 py-2.5">
            <p className="text-slate-200 text-xs font-medium whitespace-nowrap">
              {drawNotice.kind === 'declined'
                ? 'Your opponent declined the draw offer'
                : `Draw offer limit reached${drawNotice.max ? ` (${drawNotice.max} per game)` : ''}`}
            </p>
          </div>
        </div>
      )}

      {/* Game over message */}
      {gameOver && (
        <div className="fixed bottom-[5.5rem] left-1/2 -translate-x-1/2 z-[220] pointer-events-auto bg-slate-900/95 backdrop-blur-sm border border-amber-500/50 rounded-xl px-5 py-3 text-center shadow-xl">
          <p className="text-amber-400 font-bold text-sm">Game Over</p>
          <p className="text-slate-300 text-xs mt-1">{result || 'Match ended'}</p>
        </div>
      )}
    </>
  );
}
