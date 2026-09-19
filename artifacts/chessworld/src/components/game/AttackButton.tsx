import { useState } from 'react';
import { Swords } from 'lucide-react';
import type { WorldScene } from '../../game/scenes/WorldScene';
import { useTouchControlsStore } from '../../stores/touchControlsStore';
import { detectTouchDevice } from './VirtualJoystick';

/** Botão móvel de ataque. O posicionamento é feito em Configurações → Controles. */
export function AttackButton({ getScene }: { getScene: () => WorldScene | null }) {
  const [isTouch] = useState(detectTouchDevice);
  const [pressed, setPressed] = useState(false);
  const attack = useTouchControlsStore((s) => s.attack);
  const positioning = useTouchControlsStore((s) => s.positioning);
  if (!isTouch || positioning) return null;

  const release = () => setPressed(false);
  return (
    <div
      className="absolute z-[150] pointer-events-none"
      style={{
        right: attack.position?.right ?? 16,
        bottom: attack.position?.bottom != null
          ? attack.position.bottom
          : 'calc(var(--hud-bottom-stack, 76px) + 12px)',
        width: attack.size,
        height: attack.size,
        opacity: attack.opacity,
      }}
    >
      <button
        type="button"
        aria-label="Atacar"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          setPressed(true);
          getScene()?.tryAttack();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(event) => event.preventDefault()}
        className={`pointer-events-auto flex h-full w-full select-none items-center justify-center rounded-full border-2 shadow-lg backdrop-blur transition-transform duration-75 ${
          pressed
            ? 'scale-90 border-red-400 bg-red-500/40 text-red-100'
            : 'border-red-500/50 bg-slate-900/70 text-red-300'
        }`}
        style={{ touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
      >
        <Swords size={Math.max(18, Math.round(attack.size * 0.42))} strokeWidth={2.2} />
      </button>
    </div>
  );
}