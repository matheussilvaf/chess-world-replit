/**
 * Collision / safe-zone queries over the generated crafting-world geometry.
 * Used by the server animal AI (no TMJ at runtime) and reusable by the client.
 * Tiled rectangles carry a rotation (clockwise degrees around the top-left corner);
 * they are NEVER treated as AABBs (see memory: "parede invisível").
 */
import { CRAFTING_WORLD_MAP, type MapCollisionRect, type MapRect } from './craftingWorldMapData.js';

const CELL = 256;

interface Rotated { x: number; y: number; w: number; h: number; cos: number; sin: number; aabb: MapRect }

function toRotated([x, y, w, h, deg]: MapCollisionRect): Rotated {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // corners: (0,0) (w,0) (w,h) (0,h) rotated around origin then translated
  const xs = [0, w * cos, w * cos - h * sin, -h * sin].map((v) => v + x);
  const ys = [0, w * sin, w * sin + h * cos, h * cos].map((v) => v + y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x, y, w, h, cos, sin, aabb: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

function containsPoint(r: Rotated, px: number, py: number): boolean {
  if (px < r.aabb.x || py < r.aabb.y || px > r.aabb.x + r.aabb.width || py > r.aabb.y + r.aabb.height) return false;
  // inverse-rotate the point into the rectangle's local frame
  const dx = px - r.x, dy = py - r.y;
  const lx = dx * r.cos + dy * r.sin;
  const ly = -dx * r.sin + dy * r.cos;
  return lx >= 0 && lx <= r.w && ly >= 0 && ly <= r.h;
}

export class HuntingMapGeometry {
  readonly width: number;
  readonly height: number;
  readonly safeZone: MapRect;
  private readonly cells = new Map<number, Rotated[]>();
  private readonly cols: number;

  constructor(map = CRAFTING_WORLD_MAP) {
    this.width = map.widthPx;
    this.height = map.heightPx;
    this.safeZone = map.safeZone;
    this.cols = Math.ceil(this.width / CELL) + 1;
    for (const raw of map.collisionRects) {
      const r = toRotated(raw);
      const c0 = Math.floor(r.aabb.x / CELL), c1 = Math.floor((r.aabb.x + r.aabb.width) / CELL);
      const r0 = Math.floor(r.aabb.y / CELL), r1 = Math.floor((r.aabb.y + r.aabb.height) / CELL);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const key = cy * this.cols + cx;
        let list = this.cells.get(key);
        if (!list) { list = []; this.cells.set(key, list); }
        list.push(r);
      }
    }
  }

  isInsideMap(x: number, y: number, margin = 16): boolean {
    return x >= margin && y >= margin && x <= this.width - margin && y <= this.height - margin;
  }

  /** True when the point is inside a collision rectangle. */
  isBlocked(x: number, y: number): boolean {
    const list = this.cells.get(Math.floor(y / CELL) * this.cols + Math.floor(x / CELL));
    if (!list) return false;
    for (const r of list) if (containsPoint(r, x, y)) return true;
    return false;
  }

  /** Safe zone (+ optional margin) — animals may never enter it. */
  inSafeZone(x: number, y: number, margin = 0): boolean {
    const z = this.safeZone;
    return x >= z.x - margin && x <= z.x + z.width + margin && y >= z.y - margin && y <= z.y + z.height + margin;
  }

  /** A point an animal may stand on: inside the map, outside walls and outside the safe zone. */
  isWalkableForAnimal(x: number, y: number, safeMargin = 24): boolean {
    return this.isInsideMap(x, y) && !this.inSafeZone(x, y, safeMargin) && !this.isBlocked(x, y);
  }

  /** A point the NPC may stand on: inside the safe zone and outside walls. */
  isWalkableForNpc(x: number, y: number, inset = 24): boolean {
    const z = this.safeZone;
    return x >= z.x + inset && x <= z.x + z.width - inset && y >= z.y + inset && y <= z.y + z.height - inset && !this.isBlocked(x, y);
  }

  /** Samples the segment every `step` px; true when every sample is walkable. */
  segmentWalkable(x0: number, y0: number, x1: number, y1: number, walkable: (x: number, y: number) => boolean, step = 12): boolean {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!walkable(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }
}

let shared: HuntingMapGeometry | null = null;
export function getCraftingWorldGeometry(): HuntingMapGeometry {
  if (!shared) shared = new HuntingMapGeometry();
  return shared;
}
