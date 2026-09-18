/**
 * huntCompassBus — per-frame channel from WorldScene to the HuntCompass HTML overlay.
 *
 * Carries the on-screen arrows that point to the local player's contract animals while they are
 * OUT of view (the arrow of an animal that is visible, dead or gone is simply not emitted). Plain
 * pub/sub like playerTagBus: the overlay mutates DOM nodes directly instead of re-rendering React
 * at 60 fps.
 */

export type HuntCompassEntry = {
  /** Animal id (stable while the animal lives). */
  id: string;
  /** Animal display name. */
  name: string;
  /** Container-relative position of the arrow, in CSS pixels (clamped to the viewport edge). */
  x: number;
  y: number;
  /** Direction of the animal from the player, degrees (0 = right, 90 = down — CSS rotate convention). */
  angleDeg: number;
  /** Distance from the player to the animal, world px. */
  distancePx: number;
};

type Listener = (entries: HuntCompassEntry[]) => void;

const listeners = new Set<Listener>();

export const huntCompassBus = {
  emit(entries: HuntCompassEntry[]) {
    listeners.forEach((fn) => fn(entries));
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
