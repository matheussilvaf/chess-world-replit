/**
 * Locomotion model of the animals — shared by the server (moves the animal AND picks the run
 * frame), the game client (shows the server frame) and the `/dev/caca` bench (where the leap is
 * configured and saved as the game default).
 *
 * The run animation of every sheet is a LEAP. Checked frame by frame on the wolf, bear, boar and
 * fox sheets: local frame 1 is the GATHER (crouched, all legs under the body — landing and pushing
 * off), frame 2 is the TAKE-OFF (back arched, tail up) and frame 0 is the FLIGHT (body fully
 * stretched). One leap plays 1 → 2 → 0: the animal (almost) stops while gathered and moves from
 * point A to point B — abruptly — on the two airborne frames.
 *
 * The leap is configured ONCE for the whole game (`HuntingConfig.motion`, edited in /dev/caca):
 *   - `leapPx`      how far the animal moves from take-off (A) to landing (B) in one leap;
 *   - `leapMs`      how long that move takes (take-off + flight together) — shorter = more abrupt;
 *   - `groundMinMs` the shortest gather (crouched) between two leaps;
 *   - `groundMaxMs` the longest gather — slow animals shorten the leap instead of waiting longer;
 *   - `groundSpeed` creep while gathered, as a fraction of the run speed (0 = frozen).
 * The run speed of the animal (per variant/level, admin) stays the AVERAGE speed: the gather lasts
 * exactly as long as needed for `leapPx` per (gather + leap) to equal it. Faster animals therefore
 * leap more OFTEN, not farther. Only when the speed does not fit the configured leap does the leap
 * change: gather already at its minimum → the leap gets quicker; air time already at its floor →
 * longer (the animal must still cover its speed); gather at its maximum → shorter.
 *
 * The server owns both the motion and the picture: every tick it advances the leap clock, moves the
 * animal by the distance of the current phase and writes the local frame into `AnimalState.frame`.
 * The client only displays that frame (delayed like the interpolated position), so picture and
 * motion cannot drift apart, whatever the latency or the interpolation buffer.
 */

/** Leap settings saved in the hunting config (`HuntingConfig.motion`). */
export interface HuntingMotionConfig {
  /** Displacement (px) of one leap — the ground covered between take-off and landing. */
  leapPx: number;
  /** Duration (ms) of that displacement — the take-off and flight frames together. */
  leapMs: number;
  /** Shortest gather (crouched pause) between two leaps (ms). */
  groundMinMs: number;
  /** Longest gather (ms): when the speed would need a longer pause, the leap shrinks instead. */
  groundMaxMs: number;
  /** Speed while gathered, as a fraction of the run speed (0 = frozen, never above 0.9). */
  groundSpeed: number;
}

export const MOTION_LIMITS = {
  leapPx: { min: 8, max: 600 },
  leapMs: { min: 60, max: 2000 },
  groundMinMs: { min: 0, max: 3000 },
  groundMaxMs: { min: 0, max: 10000 },
  groundSpeed: { min: 0, max: 0.9 },
} as const;

/** Factory leap: about one wolf body length, covered in a fifth of a second. */
export const DEFAULT_MOTION: Readonly<HuntingMotionConfig> = Object.freeze({
  leapPx: 90, leapMs: 200, groundMinMs: 80, groundMaxMs: 900, groundSpeed: 0.15,
});

/** Shortest airborne time (ms) when a very fast animal forces the leap to get quicker. */
export const LEAP_MIN_AIR_MS = 60;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Lenient parser: missing/invalid fields fall back to the factory leap; the pause window is kept ordered. */
export function parseMotionConfig(raw: unknown): HuntingMotionConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_MOTION;
  const groundMinMs = clampNumber(source.groundMinMs, d.groundMinMs, MOTION_LIMITS.groundMinMs.min, MOTION_LIMITS.groundMinMs.max);
  const groundMaxMs = Math.max(groundMinMs, clampNumber(source.groundMaxMs, d.groundMaxMs, MOTION_LIMITS.groundMaxMs.min, MOTION_LIMITS.groundMaxMs.max));
  return {
    leapPx: clampNumber(source.leapPx, d.leapPx, MOTION_LIMITS.leapPx.min, MOTION_LIMITS.leapPx.max),
    leapMs: clampNumber(source.leapMs, d.leapMs, MOTION_LIMITS.leapMs.min, MOTION_LIMITS.leapMs.max),
    groundMinMs,
    groundMaxMs,
    groundSpeed: clampNumber(source.groundSpeed, d.groundSpeed, MOTION_LIMITS.groundSpeed.min, MOTION_LIMITS.groundSpeed.max),
  };
}

/** One phase of the leap: which run frame is shown, for how long, and how fast the animal moves. */
export interface RunPhase {
  /** Local frame (0..2) of the run row. */
  frame: number;
  /** Duration (ms). */
  ms: number;
  /** Speed multiplier relative to the configured run speed. */
  speed: number;
}

/** The leap of one animal: the configured leap fitted to its run speed (see `runLeapFor`). */
export interface RunLeap {
  /** gather (frame 1) → take-off (frame 2) → flight (frame 0). */
  phases: readonly RunPhase[];
  /** Gather + air (ms). */
  periodMs: number;
  /** Gather (crouched) duration (ms). */
  groundMs: number;
  /** Airborne duration (ms) — take-off + flight. */
  airMs: number;
  /** Ground actually covered while airborne (px) — `motion.leapPx` unless the speed forced a shorter leap. */
  leapPx: number;
  /** Speed while airborne (px/s). */
  airSpeed: number;
  /** Why the leap differs from the configured one, if it does. */
  fit: 'exact' | 'quicker' | 'longer-fast' | 'shorter-slow';
}

/**
 * Fits the configured leap to an animal running at `speed` px/s. The average speed over one period
 * is exactly `speed` in every branch; the displacement of the leap is `motion.leapPx` whenever the
 * gather window allows it.
 */
export function runLeapFor(speed: number, motion: HuntingMotionConfig): RunLeap {
  const v = Math.max(1, Number.isFinite(speed) ? speed : 1);
  const creep = Math.min(0.9, Math.max(0, motion.groundSpeed));
  const groundMin = Math.max(0, motion.groundMinMs);
  const groundMax = Math.max(groundMin, motion.groundMaxMs);
  const leapPx = Math.max(1, motion.leapPx);
  let airMs = Math.max(LEAP_MIN_AIR_MS, motion.leapMs);
  // period needed for `leapPx` per leap at the average speed, minus the airborne part → gather
  const budgetMs = (leapPx * 1000) / v;
  let groundMs = (budgetMs - airMs) / (1 - creep);
  let fit: RunLeap['fit'] = 'exact';
  if (groundMs < groundMin) {
    // too fast for this leap: keep the distance, make the leap quicker; at the air-time floor the minimum
    // pause forces a longer period, so the leap gets LONGER to keep the average speed
    groundMs = groundMin;
    airMs = budgetMs - (1 - creep) * groundMin;
    fit = 'quicker';
    if (airMs < LEAP_MIN_AIR_MS) { airMs = LEAP_MIN_AIR_MS; fit = 'longer-fast'; }
  } else if (groundMs > groundMax) {
    // too slow for this leap: cap the pause, the leap gets shorter
    groundMs = groundMax;
    fit = 'shorter-slow';
  }
  // multiplier that makes the average exactly 1× given the gather creep
  const airMultiplier = (groundMs + airMs - creep * groundMs) / airMs;
  const half = airMs / 2;
  return {
    phases: [
      { frame: 1, ms: groundMs, speed: creep },     // gather (crouched)
      { frame: 2, ms: half, speed: airMultiplier }, // take-off (arched)
      { frame: 0, ms: half, speed: airMultiplier }, // flight (stretched)
    ],
    periodMs: groundMs + airMs,
    groundMs,
    airMs,
    leapPx: (v * airMultiplier * airMs) / 1000,
    airSpeed: v * airMultiplier,
    fit,
  };
}

/** Index of the leap phase at `elapsedMs` since the run started. */
export function runPhaseAt(elapsedMs: number, leap: RunLeap): number {
  const { phases, periodMs } = leap;
  let local = ((elapsedMs % periodMs) + periodMs) % periodMs;
  for (let i = 0; i < phases.length - 1; i++) {
    if (local < phases[i].ms - 1e-9) return i;
    local -= phases[i].ms;
  }
  return phases.length - 1;
}
/** Local run frame (0..2) shown at `elapsedMs` since the run started. */
export function runFrameAt(elapsedMs: number, leap: RunLeap): number {
  return leap.phases[runPhaseAt(elapsedMs, leap)].frame;
}
/** Speed multiplier at `elapsedMs` since the run started. */
export function runSpeedMultiplierAt(elapsedMs: number, leap: RunLeap): number {
  return leap.phases[runPhaseAt(elapsedMs, leap)].speed;
}

/**
 * Distance (px) covered between `fromMs` and `toMs` (ms since the run started) by an animal whose
 * run speed is `speed` — exact piecewise integration of the leap, so the average over any whole
 * period equals `speed`.
 */
export function runDistanceBetween(fromMs: number, toMs: number, speed: number, leap: RunLeap): number {
  if (!(toMs > fromMs)) return 0;
  const { phases, periodMs } = leap;
  // locate the phase holding `fromMs` once, then advance phase by phase with an integer cursor
  // (re-deriving the phase from float time at every step would loop on boundaries)
  const periodIndex = Math.max(0, Math.floor(fromMs / periodMs + 1e-9));
  let local = Math.max(0, fromMs - periodIndex * periodMs);
  let phase = 0;
  while (phase < phases.length - 1 && local >= phases[phase].ms - 1e-9) { local -= phases[phase].ms; phase++; }
  let t = fromMs, phaseEnd = fromMs + Math.max(0, phases[phase].ms - local), distance = 0;
  while (t < toMs - 1e-9) {
    const segmentEnd = Math.min(phaseEnd, toMs);
    if (segmentEnd > t) distance += speed * phases[phase].speed * ((segmentEnd - t) / 1000);
    t = segmentEnd;
    if (segmentEnd >= phaseEnd - 1e-9) { phase = (phase + 1) % phases.length; phaseEnd += phases[phase].ms; }
  }
  return distance;
}
