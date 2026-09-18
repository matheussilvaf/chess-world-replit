import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION,
  LEAP_MIN_AIR_MS,
  MOTION_LIMITS,
  parseMotionConfig,
  runDistanceBetween,
  runFrameAt,
  runLeapFor,
  runPhaseAt,
  runSpeedMultiplierAt,
  type HuntingMotionConfig,
  type RunLeap,
} from './HuntingMotion';

const TICK_MS = 50; // server simulation tick

/** Simulates the server: advances the run in fixed ticks and returns frame + cumulative distance per tick. */
function simulate(speed: number, leap: RunLeap, totalMs: number): { t: number; frame: number; distance: number; step: number }[] {
  const out: { t: number; frame: number; distance: number; step: number }[] = [];
  let elapsed = 0, distance = 0;
  while (elapsed < totalMs - 1e-9) {
    const frame = runFrameAt(elapsed, leap);
    const next = Math.min(totalMs, elapsed + TICK_MS);
    const step = runDistanceBetween(elapsed, next, speed, leap);
    elapsed = next;
    distance += step;
    out.push({ t: elapsed, frame, distance, step });
  }
  return out;
}
const averageOf = (leap: RunLeap) => leap.phases.reduce((sum, phase) => sum + phase.ms * phase.speed, 0) / leap.periodMs;
const motion = (patch: Partial<HuntingMotionConfig> = {}): HuntingMotionConfig => ({ ...DEFAULT_MOTION, ...patch });

describe('HuntingMotion — configurable leap', () => {
  it('plays gather (1) → take-off (2) → flight (0); the leap is the configured displacement in the configured time', () => {
    const leap = runLeapFor(120, DEFAULT_MOTION);
    expect(leap.phases.map((phase) => phase.frame)).toEqual([1, 2, 0]);
    expect(leap.fit).toBe('exact');
    expect(leap.leapPx).toBeCloseTo(DEFAULT_MOTION.leapPx, 9);
    expect(leap.airMs).toBeCloseTo(DEFAULT_MOTION.leapMs, 9);
    expect(leap.airSpeed).toBeCloseTo(DEFAULT_MOTION.leapPx * 1000 / DEFAULT_MOTION.leapMs, 9);
    expect(leap.phases[0]).toMatchObject({ ms: leap.groundMs, speed: DEFAULT_MOTION.groundSpeed });
    expect(leap.phases[1].ms).toBeCloseTo(leap.airMs / 2, 9);
    expect(leap.phases[2].speed).toBe(leap.phases[1].speed);
    expect(leap.phases[1].speed).toBeGreaterThan(1);
    // the average speed over a period is exactly the run speed: the gather absorbs the difference
    expect(averageOf(leap)).toBeCloseTo(1, 12);
    expect(leap.groundMs).toBeGreaterThan(DEFAULT_MOTION.groundMinMs);
    expect(leap.groundMs).toBeLessThan(DEFAULT_MOTION.groundMaxMs);
  });

  it('faster animals leap more often, not farther; the displacement never depends on the speed while the pause fits', () => {
    const slow = runLeapFor(95, DEFAULT_MOTION), fast = runLeapFor(150, DEFAULT_MOTION);
    expect(slow.leapPx).toBeCloseTo(fast.leapPx, 9);
    expect(slow.airMs).toBeCloseTo(fast.airMs, 9);
    expect(fast.groundMs).toBeLessThan(slow.groundMs);
    expect(1000 / fast.periodMs).toBeGreaterThan(1000 / slow.periodMs);
    for (const speed of [95, 120, 150, 300]) expect(averageOf(runLeapFor(speed, DEFAULT_MOTION))).toBeCloseTo(1, 12);
  });

  it('too fast for the pause: the leap gets quicker (same distance), then longer; too slow: the pause is capped and the leap shrinks', () => {
    const m = motion({ leapPx: 90, leapMs: 200, groundMinMs: 80, groundMaxMs: 900, groundSpeed: 0.15 });
    const quicker = runLeapFor(400, m);
    expect(quicker.fit).toBe('quicker');
    expect(quicker.groundMs).toBe(80);
    expect(quicker.leapPx).toBeCloseTo(90, 9);
    expect(quicker.airMs).toBeLessThan(200);
    expect(quicker.airMs).toBeGreaterThanOrEqual(LEAP_MIN_AIR_MS);
    const longer = runLeapFor(1500, m);
    expect(longer.fit).toBe('longer-fast');
    expect(longer.airMs).toBe(LEAP_MIN_AIR_MS);
    expect(longer.groundMs).toBe(80);
    expect(longer.leapPx).toBeGreaterThan(90); // 1500 px/s with an 80 ms pause: each leap must cover more ground
    const slow = runLeapFor(40, m);
    expect(slow.fit).toBe('shorter-slow');
    expect(slow.groundMs).toBe(900);
    expect(slow.airMs).toBeCloseTo(200, 9);
    expect(slow.leapPx).toBeLessThan(90);
    expect(slow.leapPx).toBeGreaterThan(0);
    for (const leap of [quicker, longer, slow]) expect(averageOf(leap)).toBeCloseTo(1, 12);
    // a zero minimum pause is allowed: the gather disappears for fast animals and the cycle still works
    const noPause = runLeapFor(600, motion({ groundMinMs: 0, groundMaxMs: 0, groundSpeed: 0 }));
    expect(noPause.groundMs).toBe(0);
    expect(runPhaseAt(0, noPause)).toBe(1);
    expect(averageOf(noPause)).toBeCloseTo(1, 12);
    expect(runDistanceBetween(0, noPause.periodMs, 600, noPause)).toBeCloseTo(600 * noPause.periodMs / 1000, 6);
  });

  it('covers exactly speed × time over whole periods, whatever the tick size; split integrals add up', () => {
    for (const [speed, m] of [[120, DEFAULT_MOTION], [70, motion({ leapPx: 140, leapMs: 300 })], [150, motion({ groundSpeed: 0 })], [95, motion({ leapMs: 90 })]] as const) {
      const leap = runLeapFor(speed, m);
      const periods = 5;
      const total = simulate(speed, leap, leap.periodMs * periods).at(-1)!.distance;
      expect(total).toBeCloseTo(speed * (leap.periodMs * periods) / 1000, 6);
      expect(total).toBeCloseTo((leap.leapPx + speed * m.groundSpeed * leap.groundMs / 1000) * periods, 6);
      const a = runDistanceBetween(0, 137, speed, leap), b = runDistanceBetween(137, 611, speed, leap), c = runDistanceBetween(0, 611, speed, leap);
      expect(a + b).toBeCloseTo(c, 9);
    }
  });

  it('the displacement happens on the airborne frames: A → B measures the configured leap, the gather is a creep', () => {
    const speed = 120, leap = runLeapFor(speed, DEFAULT_MOTION);
    const gather = runDistanceBetween(0, leap.groundMs, speed, leap);                                    // frame 1 — crouched
    const takeoff = runDistanceBetween(leap.groundMs, leap.groundMs + leap.airMs / 2, speed, leap);     // frame 2 — arched
    const flight = runDistanceBetween(leap.groundMs + leap.airMs / 2, leap.periodMs, speed, leap);      // frame 0 — stretched
    expect(takeoff).toBeCloseTo(flight, 9);
    expect(takeoff + flight).toBeCloseTo(DEFAULT_MOTION.leapPx, 6);
    expect(gather).toBeCloseTo(speed * DEFAULT_MOTION.groundSpeed * leap.groundMs / 1000, 9);
    expect(gather).toBeLessThan(DEFAULT_MOTION.leapPx * 0.2);
    expect(runSpeedMultiplierAt(0, leap)).toBe(DEFAULT_MOTION.groundSpeed);
    expect(runSpeedMultiplierAt(leap.groundMs + 1, leap)).toBeCloseTo(leap.airSpeed / speed, 9);
  });

  it('the frame published by the server is the phase of the next interval, on every tick, and cycles 1 → 2 → 0', () => {
    const speed = 120, leap = runLeapFor(speed, DEFAULT_MOTION);
    const ticks = simulate(speed, leap, leap.periodMs * 3);
    const seen = new Set(ticks.map((tick) => tick.frame));
    expect([...seen].sort()).toEqual([0, 1, 2]);
    // the frame at the START of the tick decides how far it moves: gather ticks barely move, air ticks jump
    const gatherSteps = ticks.filter((tick) => tick.frame === 1 && tick.t > TICK_MS).map((tick) => tick.step);
    const airSteps = ticks.filter((tick) => tick.frame === 0).map((tick) => tick.step);
    expect(Math.max(...gatherSteps)).toBeLessThan(Math.min(...airSteps));
    // order within a period
    let last = runFrameAt(0, leap);
    const order = [last];
    for (let t = 1; t < leap.periodMs; t++) { const f = runFrameAt(t, leap); if (f !== last) { order.push(f); last = f; } }
    expect(order).toEqual([1, 2, 0]);
    expect(runFrameAt(leap.periodMs, leap)).toBe(1);
    expect(runFrameAt(-1, leap)).toBe(0);
  });

  it('parseMotionConfig is lenient: defaults for garbage, clamps to the limits, keeps the pause window ordered', () => {
    expect(parseMotionConfig(undefined)).toEqual(DEFAULT_MOTION);
    expect(parseMotionConfig({ leapPx: 'x', leapMs: null })).toEqual(DEFAULT_MOTION);
    expect(parseMotionConfig({ leapPx: '120', leapMs: 150 })).toMatchObject({ leapPx: 120, leapMs: 150 });
    expect(parseMotionConfig({ leapPx: 1e9, leapMs: 1, groundSpeed: 5 })).toMatchObject({ leapPx: MOTION_LIMITS.leapPx.max, leapMs: MOTION_LIMITS.leapMs.min, groundSpeed: MOTION_LIMITS.groundSpeed.max });
    const window = parseMotionConfig({ groundMinMs: 500, groundMaxMs: 100 });
    expect(window.groundMaxMs).toBeGreaterThanOrEqual(window.groundMinMs);
    // legacy per-variant runFps has no effect any more
    expect(parseMotionConfig({ runFps: 4 })).toEqual(DEFAULT_MOTION);
  });
});
