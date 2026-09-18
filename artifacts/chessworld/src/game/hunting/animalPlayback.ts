import type { AnimalAnimation } from '../../shared/hunting/HuntingShapes';
import { INTERPOLATION_DELAY_MS } from '../network/interpolation';

/**
 * Server pose (anim/dir/run frame) applied with the same delay as the interpolated position, so
 * the picture always matches the motion being shown (see shared/hunting/HuntingMotion).
 */
interface Pose {
  anim: AnimalAnimation;
  dir: number;
  frame: number;
  timestamp: number;
}

export interface AnimalPlaybackState {
  anim: AnimalAnimation;
  dir: number;
  /** Local run frame (0..2) chosen by the server, or null when the looping animations drive the sprite. */
  frame: number | null;
  changed: boolean;
}

export class AnimalPlayback {
  private queue: Pose[] = [];
  private shown: Pose = { anim: 'idle', dir: 0, frame: 0, timestamp: 0 };

  constructor(private readonly delayMs = INTERPOLATION_DELAY_MS) {}

  push(anim: AnimalAnimation, dir: number, frame: number, now: number): void {
    const last = this.queue.at(-1) ?? this.shown;
    if (last.anim === anim && last.dir === dir && last.frame === frame) return;
    this.queue.push({ anim, dir, frame, timestamp: now });
  }

  update(now: number): AnimalPlaybackState {
    let due: Pose | null = null;
    while (this.queue.length && this.queue[0].timestamp + this.delayMs <= now) due = this.queue.shift()!;
    const previous = this.shown;
    if (due) this.shown = due;
    return {
      anim: this.shown.anim,
      dir: this.shown.dir,
      frame: this.shown.anim === 'run' ? this.shown.frame : null,
      changed: previous.anim !== this.shown.anim || previous.dir !== this.shown.dir,
    };
  }
}
