import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useChessStore } from '../../stores/chessStore';
import { Flag, Handshake, X, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const CAPTURE_PIECE_IMAGES: Record<string, string> = {
  wp: '/assets/chesspieces/whitepawn.png',
  wn: '/assets/chesspieces/whiteknight.png',
  wb: '/assets/chesspieces/whitebishop.png',
  wr: '/assets/chesspieces/whiterock.png',
  wq: '/assets/chesspieces/whitequeen.png',
  bp: '/assets/chesspieces/blackpawn.png',
  bn: '/assets/chesspieces/blackknight.png',
  bb: '/assets/chesspieces/blackbiship.png',
  br: '/assets/chesspieces/blackrock.png',
  bq: '/assets/chesspieces/blackqueen.png',
};

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const INITIAL_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PIECE_ORDER = ['p', 'n', 'b', 'r', 'q'] as const;

interface CaptureInfo {
  byWhite: string[]; // black piece types captured by White
  byBlack: string[]; // white piece types captured by Black
  whiteAdvantage: number; // White's material lead in points (0 if not ahead)
  blackAdvantage: number; // Black's material lead in points (0 if not ahead)
}

/**
 * Losses of one color = initial piece counts minus what remains on the board,
 * with promotion compensation: each surplus non-pawn piece (e.g. a 2nd queen)
 * is a promoted pawn still on the board — NOT a pawn captured by the opponent.
 * If a promoted piece is later captured, it counts as the pawn it came from,
 * which keeps the point totals material-accurate.
 */
function lossesFor(counts: Record<string, number>, color: 'w' | 'b') {
  let promotionSurplus = 0;
  for (const t of PIECE_ORDER) {
    if (t === 'p') continue;
    promotionSurplus += Math.max(0, (counts[color + t] || 0) - INITIAL_COUNTS[t]);
  }
  const pieces: string[] = [];
  for (const t of PIECE_ORDER) {
    let missing = Math.max(0, INITIAL_COUNTS[t] - (counts[color + t] || 0));
    if (t === 'p') missing = Math.max(0, missing - promotionSurplus);
    for (let i = 0; i < missing; i++) pieces.push(t);
  }
  return pieces;
}

/** Derive captured pieces by diffing FEN piece counts against the initial setup. */
function computeCaptures(fen: string): CaptureInfo {
  const placement = fen.split(' ')[0];
  const counts: Record<string, number> = {};
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    if (PIECE_VALUES[lower] !== undefined) {
      const key = (ch === lower ? 'b' : 'w') + lower;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  // Advantage comes from TRUE board material (not capture totals): a promoted
  // queen still on the board counts at queen value, matching real imbalance.
  let whiteMaterial = 0;
  let blackMaterial = 0;
  for (const t of PIECE_ORDER) {
    whiteMaterial += (counts['w' + t] || 0) * PIECE_VALUES[t];
    blackMaterial += (counts['b' + t] || 0) * PIECE_VALUES[t];
  }
  return {
    byWhite: lossesFor(counts, 'b'), // pieces White captured
    byBlack: lossesFor(counts, 'w'), // pieces Black captured
    whiteAdvantage: Math.max(0, whiteMaterial - blackMaterial),
    blackAdvantage: Math.max(0, blackMaterial - whiteMaterial),
  };
}

function CapturedRow({
  pieces,
  colorPrefix,
  advantage,
}: {
  pieces: readonly string[];
  colorPrefix: 'w' | 'b';
  /** Material advantage (points ahead of the opponent); shown only when > 0. */
  advantage: number;
}) {
  // Still render with no captures if ahead on material (e.g. via promotion).
  if (pieces.length === 0 && advantage <= 0) return null;
  // Black minis vanish against the dark HUD chip — use a light background for them.
  const darkPieces = colorPrefix === 'b';
  return (
    <div
      className={`flex items-center rounded-lg border backdrop-blur-sm shadow-lg px-2 py-1 pointer-events-none ${
        darkPieces
          ? 'bg-slate-200/95 border-slate-400/60'
          : 'bg-slate-900/85 border-slate-700/50'
      }`}
    >
      {pieces.map((t, i) => (
        <img
          key={`${t}-${i}`}
          src={CAPTURE_PIECE_IMAGES[colorPrefix + t]}
          alt={t}
          draggable={false}
          className={`w-[18px] h-[18px] object-contain drop-shadow ${i > 0 ? '-ml-2' : ''}`}
        />
      ))}
      {advantage > 0 && (
        <span
          className={`ml-1.5 text-[11px] font-bold leading-none tabular-nums ${
            darkPieces ? 'text-slate-800' : 'text-slate-300'
          }`}
        >
          +{advantage}
        </span>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Truncate to 4 chars + '...' if longer */
function truncNick(name: string): string {
  return name.length > 4 ? name.slice(0, 4) + '...' : name;
}

interface CompactTimerProps {
  name: string;
  elo: number;
  timeMs: number;
  isActive: boolean;
  isLow: boolean;
  isGameOver: boolean;
  pieceColor: 'white' | 'black';
  clickable?: boolean;
  onClick?: () => void;
}

function CompactTimer({
  name,
  elo,
  timeMs,
  isActive,
  isLow,
  isGameOver,
  pieceColor,
  clickable,
  onClick,
}: CompactTimerProps) {
  const active = isActive && !isGameOver;
  const nick = truncNick(name);

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`flex flex-col items-start rounded-xl backdrop-blur-sm shadow-xl border transition-all duration-300 px-3 py-2 select-none min-w-0 w-[7.5rem] ${
        active
          ? 'bg-slate-800/95 border-emerald-500/60'
          : 'bg-slate-900/90 border-slate-700/50'
      } ${clickable ? 'cursor-pointer hover:border-slate-500/70 active:scale-[0.98]' : 'cursor-default'}`}
    >
      {/* Row 1: piece dot + name (elo) */}
      <div className="flex items-center gap-1.5 w-full">
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            pieceColor === 'white'
              ? 'bg-white border border-slate-300'
              : 'bg-slate-950 border border-slate-400'
          }`}
        />
        <span className="text-white font-semibold text-[11px] leading-none truncate">
          {nick}
        </span>
        <span className="text-slate-400 text-[10px] leading-none whitespace-nowrap flex-shrink-0">
          ({elo})
        </span>
      </div>

      {/* Row 2: clock + active pulse */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <span
          className={`font-mono font-bold tabular-nums leading-none ${
            active
              ? isLow
                ? 'text-red-400 animate-pulse'
                : 'text-emerald-400'
              : 'text-slate-500'
          }`}
          style={{ fontSize: 20 }}
        >
          {formatTime(timeMs)}
        </span>
        {active && (
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${
              isLow ? 'bg-red-400' : 'bg-emerald-400'
            }`}
          />
        )}
      </div>
    </button>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 ${
        disabled
          ? 'text-slate-600 cursor-not-allowed'
          : 'bg-slate-700/50 text-slate-200 hover:bg-slate-600/70 hover:text-white active:scale-90 border border-slate-600/40 shadow-md'
      }`}
    >
      {children}
    </button>
  );
}

export function MatchHUD() {
  const matchId = useChessStore(s => s.matchId);
  const playerColor = useChessStore(s => s.playerColor);
  const game = useChessStore(s => s.game);
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
  const moveHistory = useChessStore(s => s.moveHistory);
  const viewIndex = useChessStore(s => s.viewIndex);
  const goToStart = useChessStore(s => s.goToStart);
  const goBack = useChessStore(s => s.goBack);
  const goForward = useChessStore(s => s.goForward);
  const goToLive = useChessStore(s => s.goToLive);

  const [now, setNow] = useState(Date.now());
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Tick the clock
  useEffect(() => {
    if (!matchId || gameOver) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [matchId, gameOver]);

  // Close actions card when clicking outside
  useEffect(() => {
    if (!showActions) return;
    const handler = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActions]);

  // Auto-dismiss draw notices
  useEffect(() => {
    if (!drawNotice) return;
    const t = setTimeout(() => setDrawNotice(null), 4000);
    return () => clearTimeout(t);
  }, [drawNotice, setDrawNotice]);

  const handleResign = useCallback(() => {
    setShowActions(false);
    if (gameOver || isSpectating) return;
    if (window.confirm('Are you sure you want to resign?')) {
      resign();
    }
  }, [gameOver, isSpectating, resign]);

  const handleDrawOffer = useCallback(() => {
    setShowActions(false);
    if (gameOver || isSpectating || drawOfferedByUs) return;
    sendDrawOffer();
  }, [gameOver, isSpectating, drawOfferedByUs, sendDrawOffer]);

  // Captured pieces for the position being displayed (live or history view).
  // `game` is mutated in place, so turn/moveHistory/gameOver act as the
  // recompute triggers after each move sync.
  const captures = useMemo(() => {
    if (!game) return null;
    let fen: string;
    if (viewIndex === -1) fen = game.fen();
    else if (viewIndex === 0) fen = INITIAL_FEN;
    else fen = moveHistory[viewIndex - 1]?.fen ?? game.fen();
    return computeCaptures(fen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, viewIndex, moveHistory, turn, gameOver]);

  if (!matchId) return null;

  const elapsed = gameOver ? 0 : Math.max(0, now - lastMoveAt);
  const displayWhite = turn === 'w' ? Math.max(0, whiteTimeMs - elapsed) : whiteTimeMs;
  const displayBlack = turn === 'b' ? Math.max(0, blackTimeMs - elapsed) : blackTimeMs;
  const isLow = (ms: number) => ms < 30000;

  const isBlack = playerColor === 'b';

  // From my perspective: opponent is on top, I am on the bottom
  const oppName = isBlack ? whitePlayerName : blackPlayerName;
  const oppElo = isBlack ? whitePlayerElo : blackPlayerElo;
  const oppTime = isBlack ? displayWhite : displayBlack;
  const oppActive = isBlack ? turn === 'w' : turn === 'b';
  const oppColor: 'white' | 'black' = isBlack ? 'white' : 'black';

  const myName = isBlack ? blackPlayerName : whitePlayerName;
  const myElo = isBlack ? blackPlayerElo : whitePlayerElo;
  const myTime = isBlack ? displayBlack : displayWhite;
  const myActive = isBlack ? turn === 'b' : turn === 'w';
  const myColor: 'white' | 'black' = isBlack ? 'black' : 'white';

  const isViewingHistory = viewIndex !== -1;
  const showNav = moveHistory.length > 0;
  const canGoBack = isViewingHistory ? viewIndex > 0 : moveHistory.length > 0;
  const canGoForward = isViewingHistory;
  const canShowActions = !isSpectating && !gameOver;

  // Captured pieces from my perspective: I capture opponent-colored pieces.
  // Advantage: only the materially-ahead player shows +N (equal = nothing).
  const myCapturedPieces = captures ? (isBlack ? captures.byBlack : captures.byWhite) : [];
  const myCapturedPrefix: 'w' | 'b' = isBlack ? 'w' : 'b';
  const myAdvantage = captures ? (isBlack ? captures.blackAdvantage : captures.whiteAdvantage) : 0;
  const oppCapturedPieces = captures ? (isBlack ? captures.byWhite : captures.byBlack) : [];
  const oppCapturedPrefix: 'w' | 'b' = isBlack ? 'b' : 'w';
  const oppAdvantage = captures ? (isBlack ? captures.whiteAdvantage : captures.blackAdvantage) : 0;

  return (
    <>
      {/* ── Opponent timer — snug in the top-left corner, captures below ── */}
      <div className="fixed top-3 left-3 z-[200] flex flex-col items-start gap-1.5 pointer-events-none">
        <CompactTimer
          name={oppName}
          elo={oppElo}
          timeMs={oppTime}
          isActive={oppActive}
          isLow={isLow(oppTime)}
          isGameOver={gameOver}
          pieceColor={oppColor}
        />
        <CapturedRow
          pieces={oppCapturedPieces}
          colorPrefix={oppCapturedPrefix}
          advantage={oppAdvantage}
        />
      </div>

      {/* ── My captures + timer + nav buttons — bottom-left ── */}
      <div className="fixed bottom-4 left-4 z-[200] flex flex-col items-start gap-1.5 pointer-events-auto">
        <CapturedRow
          pieces={myCapturedPieces}
          colorPrefix={myCapturedPrefix}
          advantage={myAdvantage}
        />
        <div className="flex items-center gap-2">
        {/* Timer wrapper (contains popup + clickable timer) */}
        <div ref={actionsRef} className="relative">
          {/* Actions card — slides up above the timer */}
          {showActions && canShowActions && (
            <div className="absolute bottom-full mb-2 left-0 animate-[hud-toast-in_0.2s_cubic-bezier(0.16,1,0.3,1)] z-10">
              <div className="bg-slate-900 rounded-2xl border border-slate-700/70 shadow-2xl overflow-hidden min-w-[170px]">
                {/* Card header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">
                    Options
                  </span>
                  <button
                    onClick={() => setShowActions(false)}
                    className="text-slate-500 hover:text-white transition-colors rounded p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-2 flex flex-col gap-1.5">
                  {/* Resign — solid red */}
                  <button
                    onClick={handleResign}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white transition-colors text-sm font-semibold shadow-md"
                  >
                    <Flag className="w-4 h-4 flex-shrink-0" />
                    Resign
                  </button>
                  {/* Draw — solid blue */}
                  <button
                    onClick={handleDrawOffer}
                    disabled={drawOfferedByUs}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-md ${
                      drawOfferedByUs
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'
                    }`}
                  >
                    <Handshake className="w-4 h-4 flex-shrink-0" />
                    {drawOfferedByUs ? 'Offered…' : 'Offer Draw'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* My timer (tap to open actions) */}
          <CompactTimer
            name={myName}
            elo={myElo}
            timeMs={myTime}
            isActive={myActive}
            isLow={isLow(myTime)}
            isGameOver={gameOver}
            pieceColor={myColor}
            clickable={canShowActions}
            onClick={() => setShowActions(s => !s)}
          />
        </div>

        {/* Navigation buttons */}
        {showNav && (
          <div className="flex items-center gap-1 rounded-xl bg-slate-900/90 border border-slate-700/50 backdrop-blur-sm shadow-xl px-1.5 py-1.5">
            <NavButton
              onClick={goToStart}
              disabled={isViewingHistory && viewIndex === 0}
              title="Start"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </NavButton>
            <NavButton onClick={goBack} disabled={!canGoBack} title="Previous">
              <ChevronLeft className="w-3.5 h-3.5" />
            </NavButton>
            <div
              className={`h-8 min-w-[2.75rem] px-1.5 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold select-none border transition-colors ${
                isViewingHistory
                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  : 'text-slate-400 border-slate-700/60 bg-slate-900/60'
              }`}
            >
              {isViewingHistory
                ? `${viewIndex}/${moveHistory.length}`
                : moveHistory.length}
            </div>
            <NavButton onClick={goForward} disabled={!canGoForward} title="Next">
              <ChevronRight className="w-3.5 h-3.5" />
            </NavButton>
            <NavButton onClick={goToLive} disabled={!isViewingHistory} title="Live">
              <ChevronsRight className="w-3.5 h-3.5" />
            </NavButton>
          </div>
        )}
        </div>
      </div>

      {/* ── Incoming draw offer toast ── */}
      {drawOfferPending && !isSpectating && !gameOver && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[220] pointer-events-auto"
          style={{ bottom: 76 }}
        >
          <div className="animate-[hud-toast-in_0.3s_cubic-bezier(0.16,1,0.3,1)] flex items-center gap-3 rounded-2xl bg-slate-900/95 border border-blue-500/50 shadow-2xl backdrop-blur-md px-4 py-3">
            <span className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <Handshake className="w-4 h-4 text-blue-400" />
            </span>
            <div className="mr-1">
              <p className="text-white text-xs font-semibold leading-tight whitespace-nowrap">
                Draw offered
              </p>
              <p className="text-slate-400 text-[10px] leading-tight whitespace-nowrap">
                Your opponent offers a draw
              </p>
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

      {/* ── Draw notice (declined / limit) ── */}
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

      {/* ── Game over banner ── */}
      {gameOver && (
        <div className="fixed bottom-[5.5rem] left-1/2 -translate-x-1/2 z-[220] pointer-events-auto bg-slate-900/95 backdrop-blur-sm border border-amber-500/50 rounded-xl px-5 py-3 text-center shadow-xl">
          <p className="text-amber-400 font-bold text-sm">Game Over</p>
          <p className="text-slate-300 text-xs mt-1">{result || 'Match ended'}</p>
        </div>
      )}
    </>
  );
}
