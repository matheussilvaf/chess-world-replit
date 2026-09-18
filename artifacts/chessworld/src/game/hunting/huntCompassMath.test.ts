import { describe, expect, it } from 'vitest';
import { COMPASS_EDGE_HYSTERESIS, COMPASS_INSET, computeCompassArrows, type CompassTarget } from './huntCompassMath';

const viewport = { width: 1280, height: 720, originX: 640, originY: 360 };
const target = (id: string, sx: number, sy: number, distancePx = 500): CompassTarget => ({ id, name: 'Lobo', sx, sy, distancePx });

describe('HUD compass arrows', () => {
  it('emits nothing for animals inside the view and drops forgotten ids from the hysteresis map', () => {
    const inView = new Map<string, boolean>([['gone', false]]);
    expect(computeCompassArrows(viewport, [target('a', 100, 100), target('b', 1270, 700)], inView)).toEqual([]);
    expect([...inView.keys()].sort()).toEqual(['a', 'b']);
  });

  it('clamps the arrow to the inset box on the side of the animal and points at it', () => {
    const inView = new Map<string, boolean>();
    const [right, up, downLeft] = computeCompassArrows(viewport, [
      target('r', 3000, 360, 2400), target('u', 640, -900), target('dl', -600, 2000),
    ], inView);
    expect(right.x).toBeCloseTo(1280 - COMPASS_INSET.x, 6);
    expect(right.y).toBeCloseTo(360, 6);
    expect(right.angleDeg).toBeCloseTo(0, 6);
    expect(right.distancePx).toBe(2400);
    expect(up.y).toBeCloseTo(COMPASS_INSET.top, 6);
    expect(up.x).toBeCloseTo(640, 6);
    expect(up.angleDeg).toBeCloseTo(-90, 6);
    expect(downLeft.x).toBeGreaterThanOrEqual(COMPASS_INSET.x);
    expect(downLeft.y).toBeLessThanOrEqual(720 - COMPASS_INSET.bottom);
    // the arrow lies on the ray from the player to the animal
    const slope = (downLeft.y - 360) / (downLeft.x - 640);
    expect(slope).toBeCloseTo((2000 - 360) / (-600 - 640), 6);
    expect(downLeft.angleDeg).toBeGreaterThan(90);
    expect(downLeft.angleDeg).toBeLessThan(180);
  });

  it('never leaves the inset box, even when the player is projected outside it (camera not centred)', () => {
    const inView = new Map<string, boolean>();
    const [entry] = computeCompassArrows({ ...viewport, originX: 5, originY: 715 }, [target('a', -400, 900)], inView);
    expect(entry.x).toBeCloseTo(COMPASS_INSET.x, 6);
    expect(entry.y).toBeCloseTo(720 - COMPASS_INSET.bottom, 6);
  });

  it('uses hysteresis at the edge: leaves the view late and comes back early', () => {
    const inView = new Map<string, boolean>();
    const half = COMPASS_EDGE_HYSTERESIS / 2;
    // just outside the canvas while still "in view" → still no arrow
    expect(computeCompassArrows(viewport, [target('a', 1280 + half, 360)], inView)).toHaveLength(0);
    // clearly outside → arrow
    expect(computeCompassArrows(viewport, [target('a', 1280 + COMPASS_EDGE_HYSTERESIS + 1, 360)], inView)).toHaveLength(1);
    // back just inside the canvas but still within the hysteresis band → keeps the arrow
    expect(computeCompassArrows(viewport, [target('a', 1280 - half, 360)], inView)).toHaveLength(1);
    // clearly inside → arrow gone
    expect(computeCompassArrows(viewport, [target('a', 1280 - COMPASS_EDGE_HYSTERESIS - 1, 360)], inView)).toHaveLength(0);
  });
});
