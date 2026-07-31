import { useState } from 'react';
import { Swords } from 'lucide-react';
import type { WorldScene } from '../../game/scenes/WorldScene';

/** True on devices whose PRIMARY pointer is a finger (phones/tablets). */
function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/**
 * Mobile-only circular Attack button (bottom-right, thumb reach). Triggers the
 * same attack intent as the F key; the scene itself enforces the cooldown,
 * death lock and seat/match locks, so spamming it never produces ghost swings.
 */
export function AttackButton({ getScene }: { getScene: () => WorldScene | null }) {
  const [isTouch] = useState(detectTouchDevice);
  const [pressed, setPressed] = useState(false);

  if (!isTouch) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Keep the tap out of the canvas (no hold-to-move) and avoid ghost clicks.
    e.preventDefault();
    e.stopPropagation();
    setPressed(true);
    getScene()?.tryAttack();
  };

  return (
    <div
      className="absolute z-40 pointer-events-none"
      style={{
        right: 'max(1rem, env(safe-area-inset-right))',
        // High enough to clear the mobile browser's bottom toolbar overlap.
        bottom: 'max(4.5rem, calc(env(safe-area-inset-bottom) + 3rem))',
      }}
    >
      <button
        type="button"
        aria-label="Atacar"
        onPointerDown={onPointerDown}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onContextMenu={(e) => e.preventDefault()}
        className={`pointer-events-auto flex h-[72px] w-[72px] select-none items-center justify-center rounded-full border-2 shadow-lg backdrop-blur transition-all duration-75 ${
          pressed
            ? 'scale-90 border-red-400 bg-red-500/40 text-red-100'
            : 'border-red-500/50 bg-slate-900/70 text-red-300'
        }`}
        style={{ touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
      >
        <Swords size={30} strokeWidth={2.2} />
      </button>
    </div>
  );
}
