import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag (and optionally resize) placement for floating HUD panels.
 *
 * Coordinates live in right/bottom space (panels are anchored near the
 * bottom-right by default), so a panel keeps hugging its corner when the
 * viewport changes. `box === null` means "never moved" — the component should
 * render its default CSS position/size classes; once the user drags or
 * resizes, inline right/bottom (+ width/height) take over and the placement
 * persists to localStorage across sessions.
 *
 * Handles get `touch-action: none` so touch-dragging never scrolls/zooms the
 * page (same policy as the board pinch handling).
 */

export interface PanelBox {
  right: number;
  bottom: number;
  w: number | null;
  h: number | null;
}

interface Options {
  storageKey: string;
  /** Fallback size estimates used for clamping before the panel is measured. */
  defaultWidth: number;
  defaultHeight: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /** Minimum gap kept between the panel and the viewport edges. */
  margin?: number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(hi, lo));
}

function loadBox(key: string): PanelBox | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PanelBox> | null;
    if (typeof p?.right !== 'number' || typeof p?.bottom !== 'number') return null;
    return {
      right: p.right,
      bottom: p.bottom,
      w: typeof p.w === 'number' ? p.w : null,
      h: typeof p.h === 'number' ? p.h : null,
    };
  } catch {
    return null;
  }
}

interface Gesture {
  mode: 'drag' | 'resize';
  startX: number;
  startY: number;
  box: PanelBox;
}

export function usePanelPlacement(opts: Options) {
  const {
    storageKey,
    defaultWidth,
    defaultHeight,
    minW = 280,
    minH = 300,
    maxW = 640,
    maxH = 720,
    margin = 8,
  } = opts;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<PanelBox | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [box, setBoxState] = useState<PanelBox | null>(() => {
    const b = loadBox(storageKey);
    boxRef.current = b;
    return b;
  });
  const [viewport, setViewport] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  const [gestureMode, setGestureMode] = useState<'drag' | 'resize' | null>(null);

  const setBox = useCallback((b: PanelBox | null) => {
    boxRef.current = b;
    setBoxState(b);
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const begin = useCallback(
    (e: React.PointerEvent, mode: 'drag' | 'resize') => {
      // Don't hijack taps on interactive controls inside the handle (e.g. the X button).
      if ((e.target as HTMLElement).closest('button, input, textarea, a, select')) return;
      const el = panelRef.current;
      if (!el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const current: PanelBox = boxRef.current ?? {
        right: Math.max(margin, window.innerWidth - rect.right),
        bottom: Math.max(margin, window.innerHeight - rect.bottom),
        w: null,
        h: null,
      };
      // Resizing needs a concrete starting size; capture the rendered one.
      const start: PanelBox = mode === 'resize' ? { ...current, w: rect.width, h: rect.height } : current;
      gestureRef.current = { mode, startX: e.clientX, startY: e.clientY, box: start };
      setBox(start);
      setGestureMode(mode);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [margin, setBox],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      e.preventDefault();
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (g.mode === 'drag') {
        const w = g.box.w ?? panelRef.current?.offsetWidth ?? defaultWidth;
        const h = g.box.h ?? panelRef.current?.offsetHeight ?? defaultHeight;
        setBox({
          ...g.box,
          right: clamp(g.box.right - dx, margin, vw - w - margin),
          bottom: clamp(g.box.bottom - dy, margin, vh - h - margin),
        });
      } else {
        // Top-left handle: dragging up/left grows the panel (its bottom-right
        // corner stays pinned). If growth would push the left/top edge
        // off-screen, the panel is nudged right/down so growing always works.
        const w = clamp((g.box.w ?? defaultWidth) - dx, minW, Math.min(maxW, vw - 2 * margin));
        const h = clamp((g.box.h ?? defaultHeight) - dy, minH, Math.min(maxH, vh - 2 * margin));
        setBox({
          right: clamp(g.box.right, margin, vw - w - margin),
          bottom: clamp(g.box.bottom, margin, vh - h - margin),
          w,
          h,
        });
      }
    },
    [defaultWidth, defaultHeight, margin, minW, minH, maxW, maxH, setBox],
  );

  const end = useCallback(() => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    setGestureMode(null);
    try {
      const b = boxRef.current;
      if (b) localStorage.setItem(storageKey, JSON.stringify(b));
    } catch {
      /* storage unavailable — placement just won't persist */
    }
  }, [storageKey]);

  const dragHandleProps = {
    onPointerDown: (e: React.PointerEvent) => begin(e, 'drag'),
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    style: { touchAction: 'none' } as React.CSSProperties,
  };

  const resizeHandleProps = {
    onPointerDown: (e: React.PointerEvent) => begin(e, 'resize'),
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    style: { touchAction: 'none' } as React.CSSProperties,
  };

  // Render-time clamp: the stored placement stays raw, but what we render
  // always fits the current viewport (keyboard / rotation shrink it briefly).
  let style: React.CSSProperties | undefined;
  if (box) {
    const width = box.w != null ? Math.min(box.w, viewport.vw - 2 * margin) : null;
    const height = box.h != null ? Math.min(box.h, viewport.vh - 2 * margin) : null;
    const w = width ?? panelRef.current?.offsetWidth ?? defaultWidth;
    const h = height ?? panelRef.current?.offsetHeight ?? defaultHeight;
    style = {
      right: clamp(box.right, margin, viewport.vw - w - margin),
      bottom: clamp(box.bottom, margin, viewport.vh - h - margin),
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    };
  }

  return {
    panelRef,
    /** Inline placement style; undefined until the user first moves/resizes. */
    style,
    /** True once the user has customized the size (explicit width/height set). */
    hasCustomSize: box?.w != null,
    dragging: gestureMode === 'drag',
    resizing: gestureMode === 'resize',
    dragHandleProps,
    resizeHandleProps,
  };
}
