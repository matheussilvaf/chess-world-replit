/**
 * Interactive rig frame canvas: draws one composed-sheet frame with origin
 * marker, collision body, hurtboxes (lime) and hitboxes (magenta), and
 * handles all mouse interactions (drag origin/body, draw/move/resize boxes).
 *
 * Box coordinates are ORIGIN-RELATIVE frame pixels (shared rig contract,
 * spec §25); this component converts to/from frame coordinates internally
 * and NEVER reports scaled (canvas) pixels upward.
 *
 * The image is any CanvasImageSource — here, the spritesheet composed live
 * by the Character Generator compositor (real assets, not a static PNG).
 */
import { useEffect, useRef, useState } from 'react';
import type { LocalRectangle, RigFrameConfig } from '../../../shared/combat/RigShapes';
import { frameToScreenCoordinates, screenToFrameCoordinates } from '../../../shared/combat/RigShapes';
import type { BoxKind, BoxSelection, EditorTool } from './types';

const HURT_COLOR = '#00ff66';
const HIT_COLOR = '#ff00ff';
const HANDLE_HIT_PX = 7; // canvas px tolerance for resize handles

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState {
  mode: 'origin' | 'body' | 'move' | 'resize' | 'draw';
  kind?: BoxKind;
  index?: number;
  handle?: Handle;
  start: { x: number; y: number }; // frame coords (sprite px)
  startRect?: LocalRectangle; // origin-relative
}

interface RigCanvasProps {
  image: CanvasImageSource | null;
  frameWidth: number;
  frameHeight: number;
  /** Sheet row of the current direction. */
  rowIndex: number;
  /** Absolute sheet column of the current animation frame. */
  sheetColumn: number;
  scale: number;
  origin: { x: number; y: number };
  body: { offsetX: number; offsetY: number; radius: number };
  frame: RigFrameConfig;
  showBoxes: boolean;
  selection: BoxSelection | null;
  tool: EditorTool;
  snap1px: boolean;
  /** Fired once at the start of any drag/draw — the page snapshots undo here. */
  onInteractionStart: () => void;
  onOriginChange: (x: number, y: number, committed: boolean) => void;
  onBodyChange: (offsetX: number, offsetY: number, committed: boolean) => void;
  onRectChange: (kind: BoxKind, index: number, rect: LocalRectangle) => void;
  onRectAdd: (kind: BoxKind, rect: LocalRectangle) => void;
  onSelect: (sel: BoxSelection | null) => void;
}

function handleList(r: LocalRectangle): { id: Handle; x: number; y: number }[] {
  const xs = [r.x, r.x + r.width / 2, r.x + r.width];
  const ys = [r.y, r.y + r.height / 2, r.y + r.height];
  return [
    { id: 'nw', x: xs[0], y: ys[0] },
    { id: 'n', x: xs[1], y: ys[0] },
    { id: 'ne', x: xs[2], y: ys[0] },
    { id: 'w', x: xs[0], y: ys[1] },
    { id: 'e', x: xs[2], y: ys[1] },
    { id: 'sw', x: xs[0], y: ys[2] },
    { id: 's', x: xs[1], y: ys[2] },
    { id: 'se', x: xs[2], y: ys[2] },
  ];
}

function resizeRect(
  start: LocalRectangle,
  handle: Handle,
  dx: number,
  dy: number,
  snapFn: (v: number) => number,
): LocalRectangle {
  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.width;
  let y2 = start.y + start.height;
  if (handle.includes('w')) x1 = snapFn(start.x + dx);
  if (handle.includes('e')) x2 = snapFn(start.x + start.width + dx);
  if (handle.includes('n')) y1 = snapFn(start.y + dy);
  if (handle.includes('s')) y2 = snapFn(start.y + start.height + dy);
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  if (x2 - x1 < 1) x2 = x1 + 1;
  if (y2 - y1 < 1) y2 = y1 + 1;
  return { ...start, x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function RigCanvas(props: RigCanvasProps) {
  const {
    image,
    frameWidth: fw,
    frameHeight: fh,
    rowIndex,
    sheetColumn,
    scale: s,
    origin,
    body,
    frame,
    showBoxes,
    selection,
    tool,
    snap1px,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<LocalRectangle | null>(null); // frame coords
  const [snapGuides, setSnapGuides] = useState({ x: false, y: false });

  const opx = origin.x * fw; // origin in frame coords (sprite px)
  const opy = origin.y * fh;

  const snap = (v: number) => (snap1px ? Math.round(v) : Math.round(v * 10) / 10);
  const rectToFrame = (r: LocalRectangle): LocalRectangle => ({
    ...r,
    x: opx + r.x,
    y: opy + r.y,
  });
  const frameToRect = (r: LocalRectangle): LocalRectangle => ({
    ...r,
    x: r.x - opx,
    y: r.y - opy,
  });

  // ------------------------------------------------------------ drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = fw * s;
    canvas.height = fh * s;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Checkerboard
    const tile = 8 * s;
    for (let y = 0; y < canvas.height; y += tile) {
      for (let x = 0; x < canvas.width; x += tile) {
        const isLight = (x / tile + y / tile) % 2 === 0;
        ctx.fillStyle = isLight ? '#1e293b' : '#0f172a';
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // Sprite frame (from the live-composed generator sheet)
    if (image) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, sheetColumn * fw, rowIndex * fh, fw, fh, 0, 0, fw * s, fh * s);
    }

    // Frame border + center dashes
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, fw * s, fh * s);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo((fw * s) / 2, 0);
    ctx.lineTo((fw * s) / 2, fh * s);
    ctx.moveTo(0, (fh * s) / 2);
    ctx.lineTo(fw * s, (fh * s) / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Combat boxes
    if (showBoxes) {
      const drawGroup = (kind: BoxKind, rects: LocalRectangle[], enabled: boolean, color: string) => {
        rects.forEach((r, i) => {
          const fr = rectToFrame(r);
          const selected = selection?.kind === kind && selection.index === i;
          ctx.globalAlpha = enabled ? 0.14 : 0.06;
          ctx.fillStyle = color;
          ctx.fillRect(fr.x * s, fr.y * s, fr.width * s, fr.height * s);
          ctx.globalAlpha = enabled ? 1 : 0.4;
          ctx.strokeStyle = color;
          ctx.lineWidth = selected ? 2 : 1;
          if (!enabled) ctx.setLineDash([3, 3]);
          ctx.strokeRect(fr.x * s, fr.y * s, fr.width * s, fr.height * s);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          if (selected) {
            for (const h of handleList(fr)) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(h.x * s - 3, h.y * s - 3, 6, 6);
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1;
              ctx.strokeRect(h.x * s - 3, h.y * s - 3, 6, 6);
            }
          }
        });
      };
      drawGroup('hurtbox', frame.hurtbox.rectangles, frame.hurtbox.enabled, HURT_COLOR);
      drawGroup('hitbox', frame.hitbox.rectangles, frame.hitbox.enabled, HIT_COLOR);
    }

    // Ghost rectangle while drawing
    if (ghost) {
      const color = tool === 'draw-hitbox' ? HIT_COLOR : HURT_COLOR;
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(ghost.x * s, ghost.y * s, ghost.width * s, ghost.height * s);
      ctx.setLineDash([]);
    }

    // Origin snap guides
    const oxS = opx * s;
    const oyS = opy * s;
    if (snapGuides.x || snapGuides.y) {
      ctx.strokeStyle = 'rgba(0,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      if (snapGuides.x) {
        ctx.moveTo(oxS, 0);
        ctx.lineTo(oxS, fh * s);
      }
      if (snapGuides.y) {
        ctx.moveTo(0, oyS);
        ctx.lineTo(fw * s, oyS);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Origin crosshair (cyan)
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(oxS - 10, oyS);
    ctx.lineTo(oxS + 10, oyS);
    ctx.moveTo(oxS, oyS - 10);
    ctx.lineTo(oxS, oyS + 10);
    ctx.stroke();
    ctx.font = '10px monospace';
    ctx.fillStyle = '#00ffff';
    ctx.fillText('ORIGIN', oxS + 12, oyS - 4);

    // Collision body (red) + feet line (green)
    const bx = oxS + body.offsetX * s;
    const by = oyS + body.offsetY * s;
    const br = body.radius * s;
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText('BODY', bx + br + 4, by + 4);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx - br - 5, by + br);
    ctx.lineTo(bx + br + 5, by + br);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#00ff00';
    ctx.fillText('FEET', bx + br + 4, by + br + 3);
  });

  // ------------------------------------------------------------ interaction
  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const findTopRect = (rects: LocalRectangle[], fx: number, fy: number): number => {
    for (let i = rects.length - 1; i >= 0; i--) {
      const fr = rectToFrame(rects[i]);
      if (fx >= fr.x && fx <= fr.x + fr.width && fy >= fr.y && fy <= fr.y + fr.height) return i;
    }
    return -1;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getPos(e);
    const { x: fx, y: fy } = screenToFrameCoordinates(pos.x, pos.y, s);

    // Draw tool: start a new rectangle
    if (tool !== 'select') {
      const kind: BoxKind = tool === 'draw-hitbox' ? 'hitbox' : 'hurtbox';
      const start = { x: snap(fx), y: snap(fy) };
      props.onInteractionStart();
      dragRef.current = { mode: 'draw', kind, start };
      setGhost({ id: 'ghost', x: start.x, y: start.y, width: 0, height: 0 });
      return;
    }

    // Resize handles of the selected rectangle
    if (showBoxes && selection) {
      const selRect = frame[selection.kind].rectangles[selection.index];
      if (selRect) {
        const fr = rectToFrame(selRect);
        for (const h of handleList(fr)) {
          const hs = frameToScreenCoordinates(h.x, h.y, s);
          if (Math.abs(pos.x - hs.x) <= HANDLE_HIT_PX && Math.abs(pos.y - hs.y) <= HANDLE_HIT_PX) {
            props.onInteractionStart();
            dragRef.current = {
              mode: 'resize',
              kind: selection.kind,
              index: selection.index,
              handle: h.id,
              start: { x: fx, y: fy },
              startRect: { ...selRect },
            };
            return;
          }
        }
      }
    }

    // Origin marker
    const oxS = opx * s;
    const oyS = opy * s;
    if (Math.hypot(pos.x - oxS, pos.y - oyS) < 14) {
      props.onInteractionStart();
      dragRef.current = { mode: 'origin', start: { x: fx, y: fy } };
      return;
    }

    // Body circle: center dot or edge ring
    const bx = oxS + body.offsetX * s;
    const by = oyS + body.offsetY * s;
    const br = body.radius * s;
    const dBody = Math.hypot(pos.x - bx, pos.y - by);
    if (dBody < 12 || Math.abs(dBody - br) < 7) {
      props.onInteractionStart();
      dragRef.current = { mode: 'body', start: { x: fx, y: fy } };
      return;
    }

    // Rectangle bodies (hitboxes are drawn on top → tested first)
    if (showBoxes) {
      const hitIdx = findTopRect(frame.hitbox.rectangles, fx, fy);
      if (hitIdx >= 0) {
        props.onSelect({ kind: 'hitbox', index: hitIdx });
        props.onInteractionStart();
        dragRef.current = {
          mode: 'move',
          kind: 'hitbox',
          index: hitIdx,
          start: { x: fx, y: fy },
          startRect: { ...frame.hitbox.rectangles[hitIdx] },
        };
        return;
      }
      const hurtIdx = findTopRect(frame.hurtbox.rectangles, fx, fy);
      if (hurtIdx >= 0) {
        props.onSelect({ kind: 'hurtbox', index: hurtIdx });
        props.onInteractionStart();
        dragRef.current = {
          mode: 'move',
          kind: 'hurtbox',
          index: hurtIdx,
          start: { x: fx, y: fy },
          startRect: { ...frame.hurtbox.rectangles[hurtIdx] },
        };
        return;
      }
    }

    props.onSelect(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const pos = getPos(e);
    const { x: fx, y: fy } = screenToFrameCoordinates(pos.x, pos.y, s);

    if (d.mode === 'origin') {
      let nx = fx / fw;
      let ny = fy / fh;
      const snapX = Math.abs(nx - 0.5) < 4 / fw;
      const snapY = Math.abs(ny - 0.5) < 4 / fh;
      if (snapX) nx = 0.5;
      if (snapY) ny = 0.5;
      setSnapGuides({ x: snapX, y: snapY });
      nx = Math.max(0, Math.min(1, nx));
      ny = Math.max(0, Math.min(1, ny));
      props.onOriginChange(Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000, false);
    } else if (d.mode === 'body') {
      props.onBodyChange(Math.round((fx - opx) * 10) / 10, Math.round((fy - opy) * 10) / 10, false);
    } else if (d.mode === 'draw') {
      const x1 = snap(fx);
      const y1 = snap(fy);
      setGhost({
        id: 'ghost',
        x: Math.min(d.start.x, x1),
        y: Math.min(d.start.y, y1),
        width: Math.abs(x1 - d.start.x),
        height: Math.abs(y1 - d.start.y),
      });
    } else if (d.mode === 'move' && d.startRect && d.kind !== undefined && d.index !== undefined) {
      const dx = fx - d.start.x;
      const dy = fy - d.start.y;
      props.onRectChange(d.kind, d.index, {
        ...d.startRect,
        x: snap(d.startRect.x + dx),
        y: snap(d.startRect.y + dy),
      });
    } else if (d.mode === 'resize' && d.startRect && d.kind !== undefined && d.index !== undefined && d.handle) {
      props.onRectChange(d.kind, d.index, resizeRect(d.startRect, d.handle, fx - d.start.x, fy - d.start.y, snap));
    }
  };

  const handleMouseUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setSnapGuides({ x: false, y: false });
    if (!d) return;

    if (d.mode === 'draw') {
      const g = ghost;
      setGhost(null);
      if (g && d.kind && g.width >= 2 && g.height >= 2) {
        props.onRectAdd(
          d.kind,
          frameToRect({ id: '', x: snap(g.x), y: snap(g.y), width: snap(g.width), height: snap(g.height) }),
        );
      }
      return;
    }
    if (d.mode === 'origin') props.onOriginChange(origin.x, origin.y, true);
    if (d.mode === 'body') props.onBodyChange(body.offsetX, body.offsetY, true);
  };

  return (
    <canvas
      ref={canvasRef}
      className="cursor-crosshair"
      style={{ imageRendering: 'pixelated' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
