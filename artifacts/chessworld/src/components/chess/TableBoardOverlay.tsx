import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chess, type Square } from 'chess.js';

/**
 * Tabuleiro HTML desenhado POR CIMA de uma mesa do mapa (mesma técnica do
 * ChessBoardOverlay das partidas: segue `window.__tableScreenRects[boardId]`
 * publicado pela WorldScene a cada frame). Componente de apresentação: quem
 * usa decide a posição (FEN), a orientação, quando está interativo e o que
 * fazer com o lance. Usado pela Sala de Puzzles (diário e batalhas).
 */

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

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ = '#b58863';
const SELECTED_SQ = '#829769';
const VALID_MOVE_DOT = 'rgba(100, 111, 64, 0.7)';
const LAST_MOVE_LIGHT = '#f5f682';
const LAST_MOVE_DARK = '#baca44';
const ERROR_SQ = '#e2453c';

const MOVE_ANIMATION_MS = 280;

const preloaded: HTMLImageElement[] = [];
let piecesReady: Promise<void> | null = null;
function preloadPieces(): Promise<void> {
  if (piecesReady) return piecesReady;
  piecesReady = Promise.all(Object.values(PIECE_IMAGES).map((src) => new Promise<void>((resolve) => {
    const img = new Image();
    img.src = src;
    preloaded.push(img);
    if (img.complete) { resolve(); return; }
    img.onload = () => resolve();
    img.onerror = () => resolve();
  }))).then(() => undefined);
  return piecesReady;
}

export interface ScreenRect { x: number; y: number; width: number; height: number }

export interface TableBoardOverlayProps {
  /** Mesa do mapa cujo retângulo de tela o tabuleiro acompanha. */
  boardId: string;
  fen: string;
  /** Lado que fica embaixo na tela. */
  orientation: 'w' | 'b';
  /** Peças do lado a jogar podem ser movidas. */
  interactive: boolean;
  lastMove?: { from: string; to: string } | null;
  /** Casas destacadas em vermelho piscando (lance errado). */
  errorSquares?: { from: string; to: string } | null;
  /** Lance animado sobre a posição `fen` (a posição só muda depois de `onAnimationEnd`). */
  animateMove?: { from: string; to: string; key: number } | null;
  onAnimationEnd?: () => void;
  /** Retorne false para recusar o lance (o tabuleiro volta ao estado anterior). */
  onMove?: (from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') => boolean | void;
  /** Escurece o tabuleiro (contagem regressiva, resultado…). */
  dimmed?: boolean;
  /** Conteúdo centralizado sobre o tabuleiro (contagem, cartão de resultado…). */
  children?: ReactNode;
  /** Retângulo fixo (bancadas de teste, sem Phaser). */
  rectOverride?: ScreenRect | null;
}

function parseFenToBoard(fen: string): Map<string, string> {
  const map = new Map<string, string>();
  const fenRanks = fen.split(' ')[0]?.split('/') ?? [];
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of fenRanks[r] ?? '') {
      if (ch >= '1' && ch <= '8') { f += parseInt(ch, 10); continue; }
      map.set(FILES[f] + RANKS[r], (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase());
      f++;
    }
  }
  return map;
}

export function TableBoardOverlay({
  boardId, fen, orientation, interactive, lastMove, errorSquares, animateMove, onAnimationEnd, onMove, dimmed, children, rectOverride,
}: TableBoardOverlayProps) {
  const [screenRect, setScreenRect] = useState<ScreenRect | null>(rectOverride ?? null);
  const [piecesLoaded, setPiecesLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [validMoves, setValidMoves] = useState<string[]>([]);
  const [dragPiece, setDragPiece] = useState<{ square: string; key: string } | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [travelled, setTravelled] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const boardPinchActive = useRef(false);

  const files = useMemo(() => orientation === 'b' ? [...FILES].reverse() : FILES, [orientation]);
  const ranks = useMemo(() => orientation === 'b' ? [...RANKS].reverse() : RANKS, [orientation]);
  const filesRef = useRef(files);
  const ranksRef = useRef(ranks);
  filesRef.current = files;
  ranksRef.current = ranks;

  const chess = useMemo(() => { try { return new Chess(fen); } catch { return null; } }, [fen]);
  const boardMap = useMemo(() => parseFenToBoard(fen), [fen]);
  const animating = !!animateMove;
  const canMove = interactive && !animating && !!chess && !promotion;

  // Retângulo da mesa na tela (publicado pela WorldScene a cada frame).
  useEffect(() => {
    if (rectOverride) { setScreenRect(rectOverride); return; }
    let active = true;
    let raf = 0;
    const update = () => {
      if (!active) return;
      const r = (window as any).__tableScreenRects?.[boardId];
      if (r) setScreenRect((prev) => prev && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height
        ? prev : { x: r.x, y: r.y, width: r.width, height: r.height });
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => { active = false; cancelAnimationFrame(raf); };
  }, [boardId, rectOverride]);

  useEffect(() => { void preloadPieces().then(() => setPiecesLoaded(true)); }, []);

  // Animação de lance: a peça sai de `from` e desliza até `to`.
  useEffect(() => {
    if (!animateMove) { setTravelled(false); return; }
    setTravelled(false);
    const frame = window.setTimeout(() => setTravelled(true), 30);
    const end = window.setTimeout(() => onAnimationEnd?.(), MOVE_ANIMATION_MS + 60);
    return () => { window.clearTimeout(frame); window.clearTimeout(end); };
    // Uma chave identifica uma animação; trocar o callback não a reinicia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateMove?.key]);

  // Posição nova ou tabuleiro travado: limpa seleção/arraste.
  useEffect(() => {
    setSelected(null); setValidMoves([]); setPromotion(null);
    if (!interactive) { setIsDragging(false); setDragPiece(null); }
  }, [fen, interactive]);

  // Pinça no tabuleiro = zoom do mapa (mesmo comportamento do ChessBoardOverlay).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        boardPinchActive.current = true;
        e.preventDefault();
        (window as any).__worldScene?.handleBoardPinch?.(
          { x: e.touches[0].clientX, y: e.touches[0].clientY }, { x: e.touches[1].clientX, y: e.touches[1].clientY }, 'start');
      } else boardPinchActive.current = false;
    };
    const blockGesture = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
    el.addEventListener('gesturestart', blockGesture);
    el.addEventListener('gesturechange', blockGesture);
    el.addEventListener('gestureend', blockGesture);
    return () => {
      el.removeEventListener('touchstart', onTouchStart, true);
      el.removeEventListener('gesturestart', blockGesture);
      el.removeEventListener('gesturechange', blockGesture);
      el.removeEventListener('gestureend', blockGesture);
    };
  }, [screenRect === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMoveTouch = (e: TouchEvent) => {
      if (!boardPinchActive.current || e.touches.length < 2) return;
      e.preventDefault();
      (window as any).__worldScene?.handleBoardPinch?.(
        { x: e.touches[0].clientX, y: e.touches[0].clientY }, { x: e.touches[1].clientX, y: e.touches[1].clientY }, 'move');
    };
    const end = () => {
      if (!boardPinchActive.current) return;
      boardPinchActive.current = false;
      (window as any).__worldScene?.handleBoardPinch?.({ x: 0, y: 0 }, { x: 0, y: 0 }, 'end');
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) end(); };
    window.addEventListener('touchmove', onMoveTouch, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchmove', onMoveTouch);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  const movesFrom = useCallback((square: string): string[] => {
    if (!chess) return [];
    try { return chess.moves({ square: square as Square, verbose: true }).map((m) => m.to); } catch { return []; }
  }, [chess]);

  const isPromotion = useCallback((from: string, to: string) => {
    const piece = chess?.get(from as Square);
    return !!piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1');
  }, [chess]);

  const commit = useCallback((from: string, to: string, piece?: 'q' | 'r' | 'b' | 'n') => {
    setSelected(null);
    setValidMoves([]);
    setPromotion(null);
    if (!piece && isPromotion(from, to)) { setPromotion({ from, to }); return; }
    onMove?.(from, to, piece);
  }, [isPromotion, onMove]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    setDragPos('touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY });
  }, []);
  const handleDragEnd = useCallback((e: MouseEvent | TouchEvent) => {
    const pos = 'changedTouches' in e ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : { x: e.clientX, y: e.clientY };
    setIsDragging(false);
    if (!dragPiece || !interactive) { setDragPiece(null); return; }
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const fileIdx = Math.floor((pos.x - rect.left) / (rect.width / 8));
      const rankIdx = Math.floor((pos.y - rect.top) / (rect.height / 8));
      if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
        const target = filesRef.current[fileIdx] + ranksRef.current[rankIdx];
        if (validMoves.includes(target)) { commit(dragPiece.square, target); setDragPiece(null); return; }
      }
    }
    // Soltou fora: mantém a seleção para completar com um clique.
    setDragPiece(null);
  }, [dragPiece, validMoves, commit, interactive]);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove);
    window.addEventListener('touchend', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  if (!screenRect || !piecesLoaded) return null;

  const turn = chess?.turn() ?? 'w';
  const sqSize = screenRect.width / 8;
  const position = (square: string) => ({
    left: `${files.indexOf(square[0]) * 12.5}%`,
    top: `${ranks.indexOf(square[1]) * 12.5}%`,
  });
  const movingPiece = animateMove ? boardMap.get(animateMove.from) : undefined;

  const handleSquareClick = (square: string) => {
    if (isDragging) return;
    if (selected && validMoves.includes(square)) { commit(selected, square); return; }
    if (!canMove) { setSelected(null); setValidMoves([]); return; }
    const piece = chess?.get(square as Square);
    if (piece && piece.color === turn) { setSelected(square); setValidMoves(movesFrom(square)); }
    else { setSelected(null); setValidMoves([]); }
  };
  // Peça própria (que não é alvo de captura da seleção atual) começa a arrastar; o resto é clique.
  const press = (e: React.MouseEvent | React.TouchEvent, square: string, pieceKey: string | undefined) => {
    const piece = chess?.get(square as Square);
    if (!canMove || !pieceKey || !piece || piece.color !== turn || validMoves.includes(square)) { handleSquareClick(square); return; }
    setSelected(square);
    setValidMoves(movesFrom(square));
    setDragPiece({ square, key: pieceKey });
    setIsDragging(true);
    setDragPos('touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY });
  };

  return <>
    <style>{`@keyframes cw-board-error { 0%, 100% { background-color: ${ERROR_SQ}; } 50% { background-color: #ffb3ad; } }`}</style>
    <div ref={containerRef} data-testid="table-board" data-board-id={boardId} className="fixed z-[100] select-none"
      style={{ left: screenRect.x, top: screenRect.y, width: screenRect.width, height: screenRect.height,
        pointerEvents: interactive || promotion ? 'auto' : 'none', touchAction: interactive || promotion ? 'none' : 'auto' }}>
      <div className="relative h-full w-full overflow-hidden rounded-sm border border-amber-900/40 shadow-xl">
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {ranks.map((rank) => files.map((file) => {
            const square = file + rank;
            const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
            const pieceKey = boardMap.get(square);
            const isSelected = selected === square;
            const isValidMove = validMoves.includes(square);
            const isLast = lastMove?.from === square || lastMove?.to === square;
            const isError = errorSquares?.from === square || errorSquares?.to === square;
            const hidden = (dragPiece?.square === square && isDragging) || (animating && animateMove?.from === square);
            let bg = isLight ? LIGHT_SQ : DARK_SQ;
            if (isSelected) bg = SELECTED_SQ;
            else if (isLast) bg = isLight ? LAST_MOVE_LIGHT : LAST_MOVE_DARK;
            if (isError) bg = ERROR_SQ;
            return <div key={square} data-square={square} className={`relative flex items-center justify-center ${canMove ? 'cursor-pointer' : 'cursor-default'}`}
              style={{ backgroundColor: bg, animation: isError ? `cw-board-error 240ms ease-in-out 3` : undefined }}
              onMouseDown={(e) => { e.preventDefault(); press(e, square, pieceKey); }}
              onTouchStart={(e) => { if (!boardPinchActive.current && e.touches.length < 2) press(e, square, pieceKey); }}>
              {pieceKey && <img src={PIECE_IMAGES[pieceKey]} alt={pieceKey} draggable={false}
                className={`pointer-events-none h-[85%] w-[85%] object-contain ${hidden ? 'opacity-0' : ''}`} />}
              {isValidMove && !pieceKey && <div className="absolute rounded-full" style={{ width: '30%', height: '30%', backgroundColor: VALID_MOVE_DOT }} />}
              {isValidMove && pieceKey && <div className="absolute inset-0 rounded-full border-[3px]" style={{ borderColor: VALID_MOVE_DOT }} />}
            </div>;
          }))}
        </div>
        {animating && animateMove && movingPiece && <img draggable={false} alt="" aria-hidden="true" src={PIECE_IMAGES[movingPiece]}
          className="pointer-events-none absolute z-[5] object-contain drop-shadow-lg"
          style={{ width: '10.625%', height: '10.625%', margin: '0.9375%',
            transition: travelled ? `left ${MOVE_ANIMATION_MS}ms ease-in-out, top ${MOVE_ANIMATION_MS}ms ease-in-out` : 'none',
            ...position(travelled ? animateMove.to : animateMove.from) }} />}
        {dimmed && <div className="pointer-events-none absolute inset-0 z-[6] bg-slate-950/55" />}
        {promotion && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/65">
          <div className="rounded-xl bg-slate-800 p-3 text-white shadow-2xl">
            <p className="mb-2 text-center text-xs font-semibold">Promoção</p>
            <div className="flex gap-1.5">{(['q', 'r', 'b', 'n'] as const).map((type) =>
              <button key={type} type="button" aria-label={`Promover para ${type}`} onClick={() => commit(promotion.from, promotion.to, type)}
                className="rounded-lg bg-slate-700 p-1 hover:bg-slate-600" style={{ width: sqSize * 0.9, height: sqSize * 0.9 }}>
                <img src={PIECE_IMAGES[`${turn}${type}`]} alt="" className="h-full w-full object-contain" draggable={false} />
              </button>)}</div>
            <button type="button" onClick={() => setPromotion(null)} className="mt-2 w-full text-center text-[10px] text-slate-400 hover:text-white">Cancelar</button>
          </div>
        </div>}
        {children && <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center">{children}</div>}
      </div>
    </div>
    {isDragging && dragPiece && <div className="pointer-events-none fixed z-[300]"
      style={{ left: dragPos.x - sqSize * 0.5, top: dragPos.y - sqSize * 0.7, width: sqSize, height: sqSize }}>
      <img src={PIECE_IMAGES[dragPiece.key]} alt="" draggable={false} className="h-full w-full object-contain" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))' }} />
    </div>}
  </>;
}
