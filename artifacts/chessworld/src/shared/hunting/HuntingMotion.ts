/**
 * Locomotion model of the animals — shared by the server (moves the animal AND picks the run
 * frame), the game client (shows the server frame) and the `/dev/caca` bench.
 *
 * The run animation of every sheet is a LEAP. Checked frame by frame on the wolf, bear, boar and
 * fox sheets: local frame 1 is the GATHER (crouched, all legs under the body — landing and pushing
 * off), frame 2 is the TAKE-OFF (back arched, tail up) and frame 0 is the FLIGHT (body fully
 * stretched). One leap plays 1 → 2 → 0 and the animal moves like a cheetah: it stays (almost)
 * still while gathered and covers the whole leap while airborne — the displacement happens on the
 * stretched frames, never on the crouched one.
 *
 * The server owns both the motion and the picture: every tick it advances the leap clock, moves the
 * animal by the distance of the current phase and writes the local frame into `AnimalState.frame`.
 * The client only displays that frame (delayed like the interpolated position), so picture and
 * motion cannot drift apart, whatever the latency or the interpolation buffer.
 *
 * Per-variant knob: `runFps` (admin) is the pace of the animation. The leap length follows from the
 * configured speed: stride = speed × leap duration. Lower fps = longer leaps at the same speed.
 */

/** One phase of the leap: which run frame is shown, for how long, and how fast the animal moves. */
export interface RunPhase {
  /** Local frame (0..2) of the run row. */
  frame: number;
  /** Duration in animation frames (1 = 1000 / runFps ms). */
  frames: number;
  /** Speed multiplier relative to the configured run speed. */
  speed: number;
}

/** Ground multiplier while gathered — a near stop (not a freeze, so the sprite never looks stuck). */
export const RUN_GROUND_SPEED = 0.15;
/** Duration of the gather in animation frames — a little longer than each airborne frame so the pause reads. */
export const RUN_GROUND_FRAMES = 1.5;
/** Airborne frames per leap (take-off + flight). */
export const RUN_AIR_FRAMES = 2;

/** Builds the leap profile — exported so the bench can try other ground pauses/speeds; the game uses RUN_LEAP. */
export function runLeapProfile(groundFrames = RUN_GROUND_FRAMES, groundSpeed = RUN_GROUND_SPEED): readonly RunPhase[] {
  const ground = Math.max(0.25, groundFrames);
  const slow = Math.min(1, Math.max(0, groundSpeed));
  // average over the leap must be exactly 1× the configured speed
  const air = (ground + RUN_AIR_FRAMES - slow * ground) / RUN_AIR_FRAMES;
  return [
    { frame: 1, frames: ground, speed: slow }, // gather (crouched)
    { frame: 2, frames: 1, speed: air },       // take-off (arched)
    { frame: 0, frames: 1, speed: air },       // flight (stretched)
  ];
}
/** Leap used by the game (server and client). */
export const RUN_LEAP: readonly RunPhase[] = runLeapProfile();

/** Frame-rate window of the run animation. */
export const RUN_MIN_FPS = 4;
export const RUN_MAX_FPS = 16;
/** Default run frame-rate — faster than the walk (8 fps) so the leap reads as a leap. */
export const DEFAULT_RUN_FPS = 10;

/** Frame-rate actually used: `fps` clamped to the readable window (NaN/0 → default). */
export function effectiveRunFps(fps: number): number {
  const value = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_RUN_FPS;
  return Math.min(RUN_MAX_FPS, Math.max(RUN_MIN_FPS, value));
}
/** Duration (ms) of one animation frame at `fps`. */
export function runFrameMs(fps: number): number { return 1000 / effectiveRunFps(fps); }
/** Animation frames per leap (sum of the phase durations). */
export function runLeapFrames(leap: readonly RunPhase[] = RUN_LEAP): number { return leap.reduce((sum, phase) => sum + phase.frames, 0); }
/** Duration (ms) of one leap at `fps`. */
export function runLeapMs(fps: number, leap: readonly RunPhase[] = RUN_LEAP): number { return runFrameMs(fps) * runLeapFrames(leap); }
/** Px covered by one leap when running at `speed` px/s with the animation at `fps`. */
export function runStrideFor(speed: number, fps: number, leap: readonly RunPhase[] = RUN_LEAP): number {
  return (Math.max(1, speed) * runLeapMs(fps, leap)) / 1000;
}

/** Index of the leap phase at `elapsedMs` since the run started. */
export function runPhaseAt(elapsedMs: number, fps: number, leap: readonly RunPhase[] = RUN_LEAP): number {
  const frameMs = runFrameMs(fps);
  const leapMs = frameMs * runLeapFrames(leap);
  let local = ((elapsedMs % leapMs) + leapMs) % leapMs;
  for (let i = 0; i < leap.length - 1; i++) {
    const duration = leap[i].frames * frameMs;
    if (local < duration - 1e-9) return i;
    local -= duration;
  }
  return leap.length - 1;
}
/** Local run frame (0..2) shown at `elapsedMs` since the run started. */
export function runFrameAt(elapsedMs: number, fps: number, leap: readonly RunPhase[] = RUN_LEAP): number {
  return leap[runPhaseAt(elapsedMs, fps, leap)].frame;
}
/** Speed multiplier at `elapsedMs` since the run started. */
export function runSpeedMultiplierAt(elapsedMs: number, fps: number, leap: readonly RunPhase[] = RUN_LEAP): number {
  return leap[runPhaseAt(elapsedMs, fps, leap)].speed;
}

/**
 * Distance (px) covered between `fromMs` and `toMs` (ms since the run started) — exact piecewise
 * integration of the leap profile, so the average speed over any whole leap equals `speed`.
 */
export function runDistanceBetween(fromMs: number, toMs: number, speed: number, fps: number, leap: readonly RunPhase[] = RUN_LEAP): number {
  if (!(toMs > fromMs)) return 0;
  const frameMs = runFrameMs(fps);
  const durations = leap.map((phase) => phase.frames * frameMs);
  const leapMs = durations.reduce((sum, d) => sum + d, 0);
  // locate the phase holding `fromMs` once, then advance phase by phase with an integer cursor
  // (re-deriving the phase from float time at every step would loop on boundaries)
  const leapIndex = Math.max(0, Math.floor(fromMs / leapMs + 1e-9));
  let local = Math.max(0, fromMs - leapIndex * leapMs);
  let phase = 0;
  while (phase < leap.length - 1 && local >= durations[phase] - 1e-9) { local -= durations[phase]; phase++; }
  let t = fromMs, phaseEnd = fromMs + Math.max(0, durations[phase] - local), distance = 0;
  while (t < toMs - 1e-9) {
    const segmentEnd = Math.min(phaseEnd, toMs);
    if (segmentEnd > t) distance += speed * leap[phase].speed * ((segmentEnd - t) / 1000);
    t = segmentEnd;
    if (segmentEnd >= phaseEnd - 1e-9) { phase = (phase + 1) % leap.length; phaseEnd += durations[phase]; }
  }
  return distance;
}
