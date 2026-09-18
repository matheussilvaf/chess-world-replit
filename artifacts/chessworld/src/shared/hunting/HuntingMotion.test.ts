import { describe, expect, it } from 'vitest';
import {
  RUN_CYCLE_SLOTS,
  RUN_FRAME_SEQUENCE,
  RUN_MAX_FPS,
  RUN_MIN_FPS,
  RUN_SLOT_SPEED,
  DEFAULT_RUN_FPS,
  effectiveRunFps,
  runCycleDistance,
  runCycleMs,
  runDistanceBetween,
  runFps,
  runFrameForDistance,
  runSlotForDistance,
  runSpeedMultiplierAt,
  runStrideFor,
} from './HuntingMotion';

const TICK_MS = 50; // server simulation tick

/** Simulates the server: advances the run in fixed ticks and returns the cumulative distance per tick. */
function simulate(stride: number, speed: number, totalMs: number): { t: number; distance: number; step: number }[] {
  const out: { t: number; distance: number; step: number }[] = [];
  let elapsed = 0, distance = 0;
  while (elapsed < totalMs - 1e-9) {
    const next = Math.min(totalMs, elapsed + TICK_MS);
    const step = runDistanceBetween(elapsed, next, stride, speed);
    elapsed = next;
    distance += step;
    out.push({ t: elapsed, distance, step });
  }
  return out;
}

describe('HuntingMotion — leap run cycle', () => {
  it('speed multipliers average exactly 1 so the configured speed is preserved', () => {
    const avg = RUN_SLOT_SPEED.reduce((s, m) => s + m, 0) / RUN_SLOT_SPEED.length;
    expect(avg).toBeCloseTo(1, 10);
    expect(RUN_FRAME_SEQUENCE).toEqual([0, 1, 2, 1]);
    expect(RUN_CYCLE_SLOTS).toBe(4);
  });

  it('covers exactly speed × time over whole cycles, whatever the tick size', () => {
    for (const [fps, speed] of [[10, 120], [4, 70], [16, 150], [7, 95]] as const) {
      const eff = runStrideFor(speed, fps);
      const cycle = runCycleMs(eff, speed);
      const cycles = 5;
      const total = simulate(eff, speed, cycle * cycles).at(-1)!.distance;
      expect(total).toBeCloseTo(speed * (cycle * cycles) / 1000, 6);
      expect(total).toBeCloseTo(runCycleDistance(eff) * cycles, 6);
      // exact integration: split integrals add up
      const a = runDistanceBetween(0, 137, eff, speed), b = runDistanceBetween(137, 611, eff, speed), c = runDistanceBetween(0, 611, eff, speed);
      expect(a + b).toBeCloseTo(c, 9);
    }
  });

  it('moves in bursts: the airborne slots (frames 0 and 2) cover far more ground than the gather slots (frame 1)', () => {
    const speed = 120, stride = runStrideFor(speed, 10);
    const slotMs = runCycleMs(stride, speed) / RUN_CYCLE_SLOTS;
    const fly = runDistanceBetween(0, slotMs, stride, speed);            // frame 0 — stretched, in the air
    const gather = runDistanceBetween(slotMs, 2 * slotMs, stride, speed); // frame 1 — crouched, pushing off
    const fly2 = runDistanceBetween(2 * slotMs, 3 * slotMs, stride, speed); // frame 2 — in the air again
    const gather2 = runDistanceBetween(3 * slotMs, 4 * slotMs, stride, speed);
    expect(fly / gather).toBeGreaterThanOrEqual(4);
    expect(fly2).toBeCloseTo(fly, 9);
    expect(gather2).toBeCloseTo(gather, 9);
    // the fast slot is at least 1.4× the average speed, the slow one below half of it
    expect(runSpeedMultiplierAt(slotMs * 0.5, stride, speed)).toBeGreaterThanOrEqual(1.4);
    expect(runSpeedMultiplierAt(slotMs * 1.5, stride, speed)).toBeLessThanOrEqual(0.5);
    expect(runSpeedMultiplierAt(slotMs * 2.5, stride, speed)).toBeGreaterThanOrEqual(1.4);
    // never stops completely (the animal keeps gliding a little while gathering)
    for (const { step } of simulate(stride, speed, 3000)) expect(step).toBeGreaterThan(0);
  });

  it('distance-driven frames follow the 0-1-2-1 yoyo and the airborne frames own the fast ground', () => {
    const stride = runStrideFor(120, 10);
    const cycle = runCycleDistance(stride);
    const frames: number[] = [];
    for (let d = 0; d < cycle * 2; d += 0.5) {
      const f = runFrameForDistance(d, stride);
      if (frames.at(-1) !== f) frames.push(f);
    }
    expect(frames).toEqual([0, 1, 2, 1, 0, 1, 2, 1]);
    let airborne = 0;
    for (let d = 0; d < cycle; d += 0.25) if (runFrameForDistance(d, stride) !== 1) airborne += 0.25;
    expect(airborne / cycle).toBeCloseTo(0.8, 1);
  });

  it('server (time-based bursts) and client (distance-based frames) agree on the slot', () => {
    const speed = 120, stride = runStrideFor(speed, 10);
    const slotMs = runCycleMs(stride, speed) / RUN_CYCLE_SLOTS;
    for (const { t, distance } of simulate(stride, speed, 4000)) {
      const inSlot = (t % slotMs) / slotMs;
      if (inSlot < 0.2 || inSlot > 0.8) continue; // skip boundaries blurred by the tick
      const serverSlot = Math.floor((t % runCycleMs(stride, speed)) / slotMs);
      expect(runSlotForDistance(distance, stride)).toBe(serverSlot);
    }
  });

  it('the animation rate is the configured fps (clamped to the readable window) whatever the speed', () => {
    for (const speed of [10, 70, 95, 120, 150, 600]) {
      for (const configured of [1, 4, 10, 16, 40, NaN]) {
        const stride = runStrideFor(speed, configured);
        const fps = runFps(stride, speed);
        expect(fps).toBeCloseTo(effectiveRunFps(configured), 9);
        expect(fps).toBeGreaterThanOrEqual(RUN_MIN_FPS - 1e-9);
        expect(fps).toBeLessThanOrEqual(RUN_MAX_FPS + 1e-9);
      }
    }
    // 10 fps = 5 leaps per second: a 120 px/s animal covers 24 px per leap, a 150 px/s one 30 px
    expect(runStrideFor(120, 10)).toBeCloseTo(24, 9);
    expect(runStrideFor(150, DEFAULT_RUN_FPS)).toBeCloseTo(30, 9);
    expect(effectiveRunFps(NaN)).toBe(DEFAULT_RUN_FPS);
    expect(effectiveRunFps(0)).toBe(DEFAULT_RUN_FPS);
    // the run is faster than the walk animation (8 fps) by default
    expect(DEFAULT_RUN_FPS).toBeGreaterThan(8);
  });
});
