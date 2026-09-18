import { DEFAULT_RUN_STRIDE_PX, type AnimalAnimation } from '../../shared/hunting/HuntingShapes';
import { runFrameForDistance } from '../../shared/hunting/HuntingMotion';
import { INTERPOLATION_DELAY_MS } from '../network/interpolation';

/** Server pose (anim/dir/stride) applied with the same delay as the interpolated position. */
interface Pose {
  anim: AnimalAnimation;
  dir: number;
  stride: number;
  timestamp: number;
}
/** Position jumps above this (px per update) are spawn snaps/teleports, not running. */
const TELEPORT_PX = 160;

export interface AnimalPlaybackState {
  anim: AnimalAnimation;
  dir: number;
  frame: number | null;
  changed: boolean;
}

export class AnimalPlayback {
  private queue: Pose[] = [];
  private shown: Pose = { anim: 'idle', dir: 0, stride: DEFAULT_RUN_STRIDE_PX, timestamp: 0 };
  private distance = 0;
  private lastX = 0;
  private lastY = 0;
  private hasPosition = false;

  constructor(private readonly delayMs = INTERPOLATION_DELAY_MS) {}

  push(anim: AnimalAnimation, dir: number, stride: number, now: number): void {
    const last = this.queue.at(-1) ?? this.shown;
    if (last.anim === anim && last.dir === dir && last.stride === stride) return;
    this.queue.push({ anim, dir, stride, timestamp: now });
  }

  update(now: number, x: number, y: number): AnimalPlaybackState {
    let due: Pose | null = null;
    while (this.queue.length && this.queue[0].timestamp + this.delayMs <= now) due = this.queue.shift()!;
    const previous = this.shown;
    if (due) this.shown = due;
    const changed = previous.anim !== this.shown.anim || previous.dir !== this.shown.dir;
    // the server restarts its leap cycle when the run starts or the stride changes — mirror both
    const restart = (previous.anim !== 'run' && this.shown.anim === 'run') || previous.stride !== this.shown.stride;
    const delta = this.hasPosition ? Math.hypot(x - this.lastX, y - this.lastY) : 0;
    if (restart) this.distance = 0;
    if (this.shown.anim === 'run' && delta <= TELEPORT_PX) this.distance += delta;
    this.lastX = x;
    this.lastY = y;
    this.hasPosition = true;
    return {
      anim: this.shown.anim,
      dir: this.shown.dir,
      frame: this.shown.anim === 'run' ? runFrameForDistance(this.distance, this.shown.stride) : null,
      changed,
    };
  }
}