import { useEffect, useRef, useState } from 'react';
import { Swords, Move } from 'lucide-react';
import type { WorldScene } from '../../game/scenes/WorldScene';

const STORAGE_KEY = 'chessworld:attack-button:v1';
const HOLD_TO_EDIT_MS = 4000;
const HOLD_CANCEL_DRIFT_PX = 12;
const MIN_SIZE = 48;
const MAX_SIZE = 160;
const DEFAULT_CFG = { size: 72, right: 16, bottom: 88 };

type ButtonCfg = { size: number; right: number; bottom: number };

/** True on devices whose PRIMARY pointer is a finger (phones/tablets). */
function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/** Keeps the button fully on-screen and within sane sizes. */
function clampCfg(cfg: ButtonCfg): ButtonCfg {
  const size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, cfg.size)));
  const maxRight = Math.max(0, window.innerWidth - size);
  const maxBottom = Math.max(0, window.innerHeight - size);
  return {
    size,
    right: Math.round(Math.min(maxRight, Math.max(0, cfg.right))),
    bottom: Math.round(Math.min(maxBottom, Math.max(0, cfg.bottom))),
  };
}

function loadCfg(): ButtonCfg {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CFG;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.size !== 'number' ||
      typeof parsed?.right !== 'number' ||
      typeof parsed?.bottom !== 'number'
    ) {
      return DEFAULT_CFG;
    }
    return clampCfg(parsed);
  } catch {
    return DEFAULT_CFG;
  }
}

/**
 * Mobile-only circular Attack button. Tap = same attack intent as the attack
 * key (F by default, configurable in Configurações → Controles)
 * (the scene enforces cooldown/death/seat locks — no ghost swings). Press and
 * HOLD for 4s to enter edit mode: drag to reposition, use the corner handle to
 * resize; the layout is saved to localStorage. All pointer events are consumed
 * here so taps never leak through to the Phaser canvas (map/boards).
 */
export function AttackButton({ getScene }: { getScene: () => WorldScene | null }) {
  const [isTouch] = useState(detectTouchDevice);
  const [cfg, setCfg] = useState<ButtonCfg>(loadCfg);
  const [editMode, setEditMode] = useState(false);
  const [pressed, setPressed] = useState(false);

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdOriginRef = useRef<{ x: number; y: number } | null>(null);
  const gestureRef = useRef<{ kind: 'move' | 'resize'; x: number; y: number; start: ButtonCfg } | null>(null);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  if (!isTouch) return null;

  const persist = (c: ButtonCfg) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    } catch {
      /* storage unavailable — layout just won't survive a reload */
    }
  };

  const clearHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdOriginRef.current = null;
  };

  // ---- normal mode: tap = attack, hold 4s = edit mode -------------------
  const onAttackDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setPressed(true);
    getScene()?.tryAttack();
    holdOriginRef.current = { x: e.clientX, y: e.clientY };
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      clearHold();
      setPressed(false);
      setEditMode(true);
      navigator.vibrate?.(80);
    }, HOLD_TO_EDIT_MS);
  };
  const onAttackMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const origin = holdOriginRef.current;
    if (!origin) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > HOLD_CANCEL_DRIFT_PX) {
      clearHold(); // finger drifted — it's not a deliberate long-press
    }
  };
  const onAttackRelease = () => {
    setPressed(false);
    clearHold();
  };

  // ---- edit mode: drag button = move, drag handle = resize --------------
  const onGestureDown = (kind: 'move' | 'resize') => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = { kind, x: e.clientX, y: e.clientY, start: cfgRef.current };
  };
  const onGestureMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === 'move') {
      setCfg(clampCfg({ ...g.start, right: g.start.right - dx, bottom: g.start.bottom - dy }));
    } else {
      // Handle sits at the top-left corner: dragging away from the button's
      // bottom-right anchor (left/up) grows it, toward it shrinks.
      setCfg(clampCfg({ ...g.start, size: g.start.size + (-dx - dy) / 2 }));
    }
  };
  const onGestureUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!gestureRef.current) return;
    e.stopPropagation();
    gestureRef.current = null;
    persist(cfgRef.current);
  };

  const exitEditMode = () => {
    gestureRef.current = null;
    persist(cfgRef.current);
    setEditMode(false);
  };

  const iconSize = Math.max(18, Math.round(cfg.size * 0.42));

  return (
    <>
      {editMode && (
        <div
          className="absolute inset-0 z-50 bg-black/50 pointer-events-auto touch-none"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            exitEditMode();
          }}
        >
          <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 w-[85%] max-w-sm rounded-lg border border-cyan-500/40 bg-slate-900/90 px-4 py-3 text-center text-sm text-slate-200 shadow-lg">
            <p className="font-semibold text-cyan-300">Ajustando o botão de ataque</p>
            <p className="mt-1 text-xs text-slate-300">
              Arraste o botão para movê-lo • arraste a alça{' '}
              <Move size={12} className="inline -mt-0.5" /> para mudar o tamanho • toque fora para
              salvar
            </p>
          </div>
        </div>
      )}
      <div
        className="absolute z-50 pointer-events-none"
        style={{ right: cfg.right, bottom: cfg.bottom, width: cfg.size, height: cfg.size }}
      >
        <button
          type="button"
          aria-label={editMode ? 'Mover botão de ataque' : 'Atacar'}
          onPointerDown={editMode ? onGestureDown('move') : onAttackDown}
          onPointerMove={editMode ? onGestureMove : onAttackMove}
          onPointerUp={editMode ? onGestureUp : onAttackRelease}
          onPointerLeave={editMode ? undefined : onAttackRelease}
          onPointerCancel={editMode ? onGestureUp : onAttackRelease}
          onContextMenu={(e) => e.preventDefault()}
          className={`pointer-events-auto flex h-full w-full select-none items-center justify-center rounded-full border-2 shadow-lg backdrop-blur transition-colors duration-75 ${
            editMode
              ? 'cursor-move border-dashed border-cyan-400 bg-cyan-500/20 text-cyan-200'
              : pressed
                ? 'scale-90 border-red-400 bg-red-500/40 text-red-100'
                : 'border-red-500/50 bg-slate-900/70 text-red-300'
          }`}
          style={{ touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
        >
          <Swords size={iconSize} strokeWidth={2.2} />
        </button>
        {editMode && (
          <div
            role="slider"
            aria-label="Redimensionar botão de ataque"
            onPointerDown={onGestureDown('resize')}
            onPointerMove={onGestureMove}
            onPointerUp={onGestureUp}
            onPointerCancel={onGestureUp}
            className="pointer-events-auto absolute -top-3 -left-3 flex h-9 w-9 items-center justify-center rounded-full border-2 border-cyan-300 bg-slate-900 text-cyan-300 shadow-lg"
            style={{ touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
          >
            <Move size={16} />
          </div>
        )}
      </div>
    </>
  );
}
