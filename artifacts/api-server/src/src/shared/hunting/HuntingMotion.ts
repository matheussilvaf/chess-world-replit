/**
 * Locomotion model of the animals — shared by the server (moves the animal), the game client
 * (picks the run frame) and the `/dev/caca` bench.
 *
 * The run animation of every sheet is a LEAP: frame 0 gathers the legs, frame 1 is airborne
 * (stretched) and frame 2 lands. Played 0-1-2-1 (yoyo) one cycle contains two leaps.
 * Moving at a constant speed under that animation looks like sliding, so the server moves the
 * animal in bursts: each slot of the cycle has its own speed multiplier (average exactly 1) and
 * the client chooses the frame from the DISTANCE travelled, which keeps picture and motion in
 * sync regardless of latency or interpolation delay.
 */

/** Local frames (0..2) of a full run cycle, in playback order. */
export const RUN_FRAME_SEQUENCE: readonly number[] = [0, 1, 2, 1];
/** Speed multiplier of each slot of RUN_FRAME_SEQUENCE (gather, fly, land, fly). Average = 1. */
export const RUN_SLOT_SPEED: readonly number[] = [0.3, 1.5, 0.7, 1.5];
/** Cumulative share of the cycle distance covered at the end of each slot. */
export const RUN_SLOT_DISTANCE_END: readonly number[] = (() => {
  const total = RUN_SLOT_SPEED.reduce((sum, m) => sum + m, 0);
  let acc = 0;
  return RUN_SLOT_SPEED.map((m) => (acc += m / total));
})();
/** Frame-rate window of the run animation; the stride is clamped so the fps stays inside it. */
export const RUN_MIN_FPS = 4;
export const RUN_MAX_FPS = 16;
/** Slots per cycle (= leaps × 2). */
export const RUN_CYCLE_SLOTS = RUN_FRAME_SEQUENCE.length;
/** Leaps per cycle (the yoyo shows the airborne frame twice). */
export const RUN_LEAPS_PER_CYCLE = 2;

/** Stride actually used for `speed` px/s: the configured one, clamped so 2 × speed / stride ∈ [RUN_MIN_FPS, RUN_MAX_FPS]. */
export function effectiveRunStride(stridePx: number, speed: number): number {
  const slotsPerLeap = RUN_CYCLE_SLOTS / RUN_LEAPS_PER_CYCLE;
  const safeSpeed = Math.max(1, speed);
  const min = (slotsPerLeap * safeSpeed) / RUN_MAX_FPS;
  const max = (slotsPerLeap * safeSpeed) / RUN_MIN_FPS;
  const stride = Number.isFinite(stridePx) && stridePx > 0 ? stridePx : min;
  return Math.min(max, Math.max(min, stride));
}
/** Px covered by one full cycle (two leaps). */
export function runCycleDistance(stridePx: number): number { return stridePx * RUN_LEAPS_PER_CYCLE; }
/** Duration (ms) of one full cycle at `speed` px/s. */
export function runCycleMs(stridePx: number, speed: number): number { return (runCycleDistance(stridePx) / Math.max(1, speed)) * 1000; }
/** Frames per second of the run animation for this stride/speed. */
export function runFps(stridePx: number, speed: number): number { return RUN_CYCLE_SLOTS / (runCycleMs(stridePx, speed) / 1000); }

/** Speed multiplier at `elapsedMs` since the run started. */
export function runSpeedMultiplierAt(elapsedMs: number, stridePx: number, speed: number): number {
  const cycle = runCycleMs(stridePx, speed);
  const slotMs = cycle / RUN_CYCLE_SLOTS;
  const inCycle = ((elapsedMs % cycle) + cycle) % cycle;
  return RUN_SLOT_SPEED[Math.min(RUN_CYCLE_SLOTS - 1, Math.floor(inCycle / slotMs))];
}

/**
 * Distance (px) covered between `fromMs` and `toMs` (ms since the run started) — exact piecewise
 * integration of the burst profile, so the average speed over any whole cycle equals `speed`.
 */
export function runDistanceBetween(fromMs: number, toMs: number, stridePx: number, speed: number): number {
  if (!(toMs > fromMs)) return 0;
  const cycle = runCycleMs(stridePx, speed);
  const slotMs = cycle / RUN_CYCLE_SLOTS;
  // integer slot counter (never derived from `t` again) — dividing back would loop on float boundaries
  let slotIndex = Math.max(0, Math.floor(fromMs / slotMs + 1e-9));
  let t = fromMs, distance = 0;
  while (t < toMs - 1e-9) {
    const segmentEnd = Math.min((slotIndex + 1) * slotMs, toMs);
    if (segmentEnd > t) distance += speed * RUN_SLOT_SPEED[slotIndex % RUN_CYCLE_SLOTS] * ((segmentEnd - t) / 1000);
    t = segmentEnd;
    slotIndex++;
  }
  return distance;
}

/** Slot (0..3) of the cycle after `distance` px of running (distance-driven playback). */
export function runSlotForDistance(distance: number, stridePx: number): number {
  const cycle = runCycleDistance(stridePx);
  const share = (((distance % cycle) + cycle) % cycle) / cycle;
  for (let i = 0; i < RUN_CYCLE_SLOTS; i++) if (share < RUN_SLOT_DISTANCE_END[i]) return i;
  return RUN_CYCLE_SLOTS - 1;
}
/** Local frame (0..2) shown after `distance` px of running. */
export function runFrameForDistance(distance: number, stridePx: number): number {
  return RUN_FRAME_SEQUENCE[runSlotForDistance(distance, stridePx)];
}
