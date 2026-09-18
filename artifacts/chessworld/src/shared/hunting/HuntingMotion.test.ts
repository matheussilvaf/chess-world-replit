import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_FPS,
  RUN_AIR_FRAMES,
  RUN_GROUND_FRAMES,
  RUN_GROUND_SPEED,
  RUN_LEAP,
  RUN_MAX_FPS,
  RUN_MIN_FPS,
  effectiveRunFps,
  runDistanceBetween,
  runFrameAt,
  runFrameMs,
  runLeapFrames,
  runLeapMs,
  runLeapProfile,
  runPhaseAt,
  runSpeedMultiplierAt,
  runStrideFor,
} from './HuntingMotion';

const TICK_MS = 50; // server simulation tick

/** Simulates the server: advances the run in fixed ticks and returns frame + cumulative distance per tick. */
function simulate(speed: number, fps: number, totalMs: number): { t: number; frame: number; distance: number; step: number }[] {
  const out: { t: number; frame: number; distance: number; step: number }[] = [];
  let elapsed = 0, distance = 0;
  while (elapsed < totalMs - 1e-9) {
    const frame = runFrameAt(elapsed, fps);
    const next = Math.min(totalMs, elapsed + TICK_MS);
    const step = runDistanceBetween(elapsed, next, speed, fps);
    elapsed = next;
    distance += step;
    out.push({ t: elapsed, frame, distance, step });
  }
  return out;
}

describe('HuntingMotion — leap run cycle', () => {
  it('one leap plays gather (1) → take-off (2) → flight (0) and its average speed is exactly 1×', () => {
    expect(RUN_LEAP.map((phase) => phase.frame)).toEqual([1, 2, 0]);
    expect(RUN_LEAP[0]).toMatchObject({ frames: RUN_GROUND_FRAMES, speed: RUN_GROUND_SPEED });
    expect(runLeapFrames()).toBeCloseTo(RUN_GROUND_FRAMES + RUN_AIR_FRAMES, 12);
    const weighted = RUN_LEAP.reduce((sum, phase) => sum + phase.frames * phase.speed, 0) / runLeapFrames();
    expect(weighted).toBeCloseTo(1, 12);
    // other ground pauses/speeds (bench knobs) keep the same invariant
    for (const [ground, slow] of [[1, 0], [2, 0.3], [0.5, 0.5]] as const) {
      const leap = runLeapProfile(ground, slow);
      const avg = leap.reduce((sum, phase) => sum + phase.frames * phase.speed, 0) / runLeapFrames(leap);
      expect(avg).toBeCloseTo(1, 12);
      expect(leap[1].speed).toBeGreaterThan(1);
      expect(leap[2].speed).toBe(leap[1].speed);
    }
  });

  it('covers exactly speed × time over whole leaps, whatever the tick size, and stride = speed × leap duration', () => {
    for (const [fps, speed] of [[10, 120], [4, 70], [16, 150], [7, 95]] as const) {
      const leapMs = runLeapMs(fps);
      expect(leapMs).toBeCloseTo(runFrameMs(fps) * runLeapFrames(), 9);
      const leaps = 5;
      const total = simulate(speed, fps, leapMs * leaps).at(-1)!.distance;
      expect(total).toBeCloseTo(speed * (leapMs * leaps) / 1000, 6);
      expect(total).toBeCloseTo(runStrideFor(speed, fps) * leaps, 6);
      // exact integration: split integrals add up
      const a = runDistanceBetween(0, 137, speed, fps), b = runDistanceBetween(137, 611, speed, fps), c = runDistanceBetween(0, 611, speed, fps);
      expect(a + b).toBeCloseTo(c, 9);
    }
    // lower fps = longer leaps at the same speed
    expect(runStrideFor(120, 5)).toBeCloseTo(runStrideFor(120, 10) * 2, 9);
  });

  it('the displacement happens on the airborne frames: the gather is a near stop, never a freeze', () => {
    const speed = 120, fps = 10;
    const frameMs = runFrameMs(fps), groundMs = RUN_GROUND_FRAMES * frameMs;
    const gather = runDistanceBetween(0, groundMs, speed, fps);                     // frame 1 — crouched
    const takeoff = runDistanceBetween(groundMs, groundMs + frameMs, speed, fps);   // frame 2 — arched
    const flight = runDistanceBetween(groundMs + frameMs, groundMs + 2 * frameMs, speed, fps); // frame 0 — stretched
    expect(takeoff).toBeCloseTo(flight, 9);
    expect(takeoff + flight).toBeGreaterThan((takeoff + flight + gather) * 0.85);
    expect(gather).toBeGreaterThan(0);
    expect(runSpeedMultiplierAt(groundMs * 0.5, fps)).toBe(RUN_GROUND_SPEED);
    expect(runSpeedMultiplierAt(groundMs + frameMs * 0.5, fps)).toBeGreaterThan(1.5);
    expect(runSpeedMultiplierAt(groundMs + frameMs * 1.5, fps)).toBeGreaterThan(1.5);
    for (const { step } of simulate(speed, fps, 3000)) expect(step).toBeGreaterThan(0);
  });

  it('the frame written by the server is the phase of the same clock that moves the animal', () => {
    const fps = 10, frameMs = runFrameMs(fps), leapMs = runLeapMs(fps);
    expect(runPhaseAt(0, fps)).toBe(0);
    expect(runFrameAt(0, fps)).toBe(1);
    expect(runFrameAt(RUN_GROUND_FRAMES * frameMs - 1, fps)).toBe(1);
    expect(runFrameAt(RUN_GROUND_FRAMES * frameMs, fps)).toBe(2);
    expect(runFrameAt((RUN_GROUND_FRAMES + 1) * frameMs, fps)).toBe(0);
    expect(runFrameAt(leapMs, fps)).toBe(1); // wraps
    expect(runFrameAt(leapMs * 3 + frameMs * 2, fps)).toBe(2);
    // a 50 ms tick at 10 fps: 1,1,1 | 2,2 | 0,0 | 1,1,1 …
    const frames = simulate(120, fps, leapMs * 2).map((tick) => tick.frame);
    expect(frames).toEqual([1, 1, 1, 2, 2, 0, 0, 1, 1, 1, 2, 2, 0, 0]);
    // the fast ticks are exactly the ticks that show an airborne frame
    const ticks = simulate(120, fps, leapMs * 4);
    const air = ticks.filter((tick) => tick.frame !== 1).map((tick) => tick.step);
    const ground = ticks.filter((tick) => tick.frame === 1).map((tick) => tick.step);
    expect(Math.min(...air)).toBeGreaterThan(Math.max(...ground) * 5);
  });

  it('clamps the run frame-rate to the readable window', () => {
    expect(effectiveRunFps(DEFAULT_RUN_FPS)).toBe(DEFAULT_RUN_FPS);
    expect(effectiveRunFps(1)).toBe(RUN_MIN_FPS);
    expect(effectiveRunFps(99)).toBe(RUN_MAX_FPS);
    expect(effectiveRunFps(Number.NaN)).toBe(DEFAULT_RUN_FPS);
    expect(effectiveRunFps(0)).toBe(DEFAULT_RUN_FPS);
    expect(runDistanceBetween(10, 10, 120, 10)).toBe(0);
    expect(runDistanceBetween(20, 10, 120, 10)).toBe(0);
  });
});
