import type { HuntCompassEntry } from './huntCompassBus';

/** A contract animal already projected to container-relative CSS px (`sx`, `sy`) with its world distance to the player. */
export interface CompassTarget {
  id: string;
  name: string;
  sx: number;
  sy: number;
  distancePx: number;
}

export interface CompassViewport {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** Player position in the same coordinates (the arrows radiate from here). */
  originX: number;
  originY: number;
}

/**
 * Arrows stay inside this box (CSS px from each canvas edge): below the contract chip (top-20 + its
 * height + half an arrow), above the hotbar, and far enough from the sides for the label pill.
 */
export const COMPASS_INSET = { x: 60, top: 140, bottom: 120 } as const;
/** An animal leaves the view this many px late and comes back this many px early — no flicker at the edge. */
export const COMPASS_EDGE_HYSTERESIS = 10;

/**
 * Pure part of the HUD compass: which targets are out of view (with hysteresis per id, carried in
 * `inView`) and where their arrows sit — the point where the ray from the player to the animal
 * leaves the inset box, rotated towards the animal. Returns the entries in `targets` order and
 * updates `inView` in place (entries for ids no longer targeted are dropped).
 */
export function computeCompassArrows(viewport: CompassViewport, targets: readonly CompassTarget[], inView: Map<string, boolean>): HuntCompassEntry[] {
  const { width, height } = viewport;
  const left = COMPASS_INSET.x, right = Math.max(left + 1, width - COMPASS_INSET.x);
  const top = COMPASS_INSET.top, bottom = Math.max(top + 1, height - COMPASS_INSET.bottom);
  const ox = Math.min(right, Math.max(left, viewport.originX)), oy = Math.min(bottom, Math.max(top, viewport.originY));
  const entries: HuntCompassEntry[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    seen.add(target.id);
    const wasInView = inView.get(target.id) ?? true;
    const margin = wasInView ? COMPASS_EDGE_HYSTERESIS : -COMPASS_EDGE_HYSTERESIS;
    const visible = target.sx >= -margin && target.sx <= width + margin && target.sy >= -margin && target.sy <= height + margin;
    inView.set(target.id, visible);
    if (visible) continue;
    const dx = target.sx - ox, dy = target.sy - oy;
    if (dx === 0 && dy === 0) continue;
    // scale the ray from the player to the first edge of the inset box
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (right - ox) / dx); else if (dx < 0) t = Math.min(t, (left - ox) / dx);
    if (dy > 0) t = Math.min(t, (bottom - oy) / dy); else if (dy < 0) t = Math.min(t, (top - oy) / dy);
    if (!Number.isFinite(t) || t < 0) t = 0;
    entries.push({
      id: target.id, name: target.name,
      x: Math.min(right, Math.max(left, ox + dx * t)), y: Math.min(bottom, Math.max(top, oy + dy * t)),
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      distancePx: target.distancePx,
    });
  }
  for (const id of [...inView.keys()]) if (!seen.has(id)) inView.delete(id);
  return entries;
}
