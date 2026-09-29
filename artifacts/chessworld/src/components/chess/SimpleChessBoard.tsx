import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';

const files = 'abcdefgh';
const images: Record<string, string> = {
  wp: 'whitepawn', wn: 'whiteknight', wb: 'whitebishop', wr: 'whiterock', wq: 'whitequeen', wk: 'whiteking',
  bp: 'blackpawn', bn: 'blackknight', bb: 'blackbiship', br: 'blackrock', bq: 'blackqueen', bk: 'blackking',
};

export interface SimpleChessBoardProps {
  fen: string;
  orientation: 'w' | 'b';
  onMove?: (from: string, to: string, promotion?: string) => boolean | void;
  legalMovesFor?: (square: string) => string[];
  chess?: Chess;
  lastMove?: { from: string; to: string };
  checkSquare?: string | null;
  interactive: boolean;
  size?: number | 'auto';
  animateMove?: { from: string; to: string; key: string | number };
  onAnimationEnd?: () => void;
}

export function SimpleChessBoard({
  fen, orientation, onMove, legalMovesFor, chess: supplied, lastMove, checkSquare, interactive, size = 'auto', animateMove, onAnimationEnd,
}: SimpleChessBoardProps) {
  const board = useMemo(() => new Chess(fen), [fen]);
  const chess = supplied ?? board;
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const start = useRef<string | null>(null);
  const shownSelected = selected && chess.get(selected as Square)?.color === chess.turn() ? selected : null;
  const legal = shownSelected
    ? (legalMovesFor?.(shownSelected) ?? chess.moves({ square: shownSelected as Square, verbose: true }).map((move) => move.to))
    : [];
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const cols = orientation === 'w' ? [...files] : [...files].reverse();
  const [animating, setAnimating] = useState(false);
  const [travelled, setTravelled] = useState(false);
  useEffect(() => {
    if (!animateMove) { setAnimating(false); return; }
    setAnimating(true);
    setTravelled(false);
    const frame = window.setTimeout(() => setTravelled(true), 35);
    const end = window.setTimeout(() => { setAnimating(false); onAnimationEnd?.(); }, 340);
    return () => { window.clearTimeout(frame); window.clearTimeout(end); };
    // A key identifies one animation; callback changes must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateMove?.key]);
  const movingPiece = animateMove && chess.get(animateMove.from as Square);
  const position = (square: string) => ({
    left: `${cols.indexOf(square[0]) * 12.5}%`,
    top: `${ranks.indexOf(Number(square[1])) * 12.5}%`,
  });

  function move(from: string, to: string, piece?: 'q' | 'r' | 'b' | 'n') {
    const accepted = onMove?.(from, to, piece);
    if (accepted !== false) setSelected(null);
    setPromotion(null);
  }

  function choose(from: string | null, to: string) {
    if (!interactive || !onMove) return;
    const piece = chess.get(to as Square);
    if (from && from !== to) {
      const targets = legalMovesFor?.(from) ?? chess.moves({ square: from as Square, verbose: true }).map((entry) => entry.to);
      if (targets.includes(to)) {
        const moving = chess.get(from as Square);
        if (moving?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
          setPromotion({ from, to });
        } else move(from, to);
        return;
      }
    }
    setSelected(piece?.color === chess.turn() ? to : null);
  }

  return (
    <div className="relative w-full select-none" style={{ maxWidth: size === 'auto' ? 560 : size, touchAction: 'none' }}>
      <div className="grid grid-cols-8 aspect-square overflow-hidden rounded-lg shadow-xl border-2 border-amber-900/60"
        onPointerUp={(event) => {
          if (!interactive) return;
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-square]');
          if (target?.dataset.square) choose(start.current && start.current !== target.dataset.square ? start.current : shownSelected, target.dataset.square);
          start.current = null;
        }}>
        {ranks.flatMap((rank, row) => cols.map((file, col) => {
          const square = `${file}${rank}`;
          const piece = chess.get(square as Square);
          const dark = (files.indexOf(file) + rank) % 2 === 0;
          const highlighted = square === shownSelected;
          const last = square === lastMove?.from || square === lastMove?.to;
          const checked = square === checkSquare;
          const background = checked ? '#ec7272' : highlighted ? '#829769' : last
            ? dark ? '#baca44' : '#f5f682' : dark ? '#b58863' : '#f0d9b5';
          return <div key={square} data-square={square} data-testid={`square-${square}`} aria-label={`Casa ${square}${piece ? ` ${piece.color === 'w' ? 'branca' : 'preta'} ${piece.type}` : ''}`}
            onPointerDown={() => { if (interactive) start.current = square; }}
            className="relative flex items-center justify-center aspect-square"
            style={{ backgroundColor: background, cursor: interactive ? 'pointer' : 'default' }}>
            {piece && !(animating && square === animateMove?.from) && <img draggable={false} src={`/assets/chesspieces/${images[`${piece.color}${piece.type}`]}.png`}
              alt="" className="w-[85%] h-[85%] object-contain pointer-events-none drop-shadow-md" />}
            {legal.includes(square) && <span className={`absolute pointer-events-none rounded-full ${piece ? 'inset-1 border-[5px] border-black/25' : 'w-1/4 h-1/4 bg-black/25'}`} />}
            {col === 0 && <span className={`absolute top-0.5 left-1 text-[10px] sm:text-xs font-bold pointer-events-none ${dark ? 'text-amber-100' : 'text-amber-900'}`}>{rank}</span>}
            {row === 7 && <span className={`absolute bottom-0 right-1 text-[10px] sm:text-xs font-bold pointer-events-none ${dark ? 'text-amber-100' : 'text-amber-900'}`}>{file}</span>}
          </div>;
        }))}
      </div>
      {animating && animateMove && movingPiece && <img draggable={false} alt="" aria-hidden="true"
        src={`/assets/chesspieces/${images[`${movingPiece.color}${movingPiece.type}`]}.png`}
        className="pointer-events-none absolute z-[5] object-contain drop-shadow-lg"
        style={{ width: '10.625%', height: '10.625%', margin: '0.9375%', transition: travelled ? 'left 280ms ease-in-out, top 280ms ease-in-out' : 'none',
          ...position(travelled ? animateMove.to : animateMove.from) }} />}
      {promotion && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/65 rounded-lg">
        <div className="rounded-xl bg-slate-800 p-4 text-white shadow-2xl">
          <p className="mb-3 text-center font-semibold">Escolha a promoção</p>
          <div className="flex gap-2">{(['q', 'r', 'b', 'n'] as const).map((type) =>
            <button key={type} type="button" aria-label={`Promover para ${({ q: 'dama', r: 'torre', b: 'bispo', n: 'cavalo' })[type]}`}
              onClick={() => move(promotion.from, promotion.to, type)}
              className="w-14 h-14 bg-amber-100 rounded hover:bg-amber-300">
              <img alt="" className="w-full h-full object-contain" src={`/assets/chesspieces/${images[`${chess.turn()}${type}`]}.png`} />
            </button>)}</div>
        </div>
      </div>}
    </div>
  );
}

export default SimpleChessBoard;