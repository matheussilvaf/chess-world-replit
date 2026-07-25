/**
 * playerTagBus — lightweight pub/sub that WorldScene uses to push
 * remote-player screen positions to the React HTML overlay each frame.
 * Using a plain event bus (not Zustand) avoids triggering React renders
 * at 60 fps; the overlay component updates DOM nodes directly.
 */

export type PlayerTagEntry = {
  sessionId: string;
  username: string;
  rating: number;
  /** Container-relative X, in CSS pixels (center of the name tag). */
  x: number;
  /** Container-relative Y, in CSS pixels (bottom edge of the name tag). */
  y: number;
};

type Listener = (entries: PlayerTagEntry[]) => void;

const listeners = new Set<Listener>();

export const playerTagBus = {
  emit(entries: PlayerTagEntry[]) {
    listeners.forEach(fn => fn(entries));
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
