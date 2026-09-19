import { useEffect, useRef } from 'react';
import { Gamepad2, RotateCcw, Swords } from 'lucide-react';
import { useTouchControlsStore } from '../../stores/touchControlsStore';

export function TouchControlsPositioner() {
  const positioning = useTouchControlsStore((s) => s.positioning);
  const joystick = useTouchControlsStore((s) => s.joystick);
  const attack = useTouchControlsStore((s) => s.attack);
  const setJoystick = useTouchControlsStore((s) => s.setJoystick);
  const setAttack = useTouchControlsStore((s) => s.setAttack);
  const setPositioning = useTouchControlsStore((s) => s.setPositioning);
  const resetPosition = useTouchControlsStore((s) => s.resetPosition);
  const clampToViewport = useTouchControlsStore((s) => s.clampToViewport);
  const dragOffset = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const clamp = () => clampToViewport();
    window.addEventListener('resize', clamp);
    window.addEventListener('orientationchange', clamp);
    clamp();
    return () => {
      window.removeEventListener('resize', clamp);
      window.removeEventListener('orientationchange', clamp);
    };
  }, [clampToViewport]);
  if (!positioning) return null;

  const size = positioning === 'joystick' ? joystick.size : attack.size;
  const left = positioning === 'joystick'
    ? joystick.position.x - size / 2
    : window.innerWidth - (attack.position?.right ?? 16) - size;
  const bottom = positioning === 'joystick'
    ? joystick.position.y - size / 2
    : attack.position?.bottom ?? 100;

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const nextLeft = Math.max(0, Math.min(window.innerWidth - size, event.clientX - dragOffset.current.x));
    const nextBottom = Math.max(0, Math.min(window.innerHeight - size, window.innerHeight - event.clientY - dragOffset.current.y));
    if (positioning === 'joystick') {
      setJoystick({ position: { x: nextLeft + size / 2, y: nextBottom + size / 2 } });
    } else {
      setAttack({ position: { right: window.innerWidth - nextLeft - size, bottom: nextBottom } });
    }
  };

  return (
    <div className="fixed inset-0 z-[600] bg-black/60 pointer-events-auto touch-none">
      <div className="absolute left-1/2 top-5 w-[90%] max-w-sm -translate-x-1/2 rounded-xl border border-cyan-500/40 bg-slate-900/95 p-3 text-center text-sm text-white shadow-xl">
        <p className="font-semibold text-cyan-300">
          {positioning === 'joystick' ? 'Arraste o analógico para onde quiser' : 'Arraste o botão de ataque para onde quiser'}
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={() => resetPosition(positioning)} className="flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Redefinir posição
          </button>
          <button onClick={() => setPositioning(null)} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950">
            Concluir
          </button>
        </div>
      </div>
      <div
        className={`absolute flex cursor-move touch-none select-none items-center justify-center rounded-full border-2 shadow-xl ${
          positioning === 'joystick'
            ? 'border-cyan-300/70 bg-slate-800/70 text-cyan-200'
            : 'border-red-400 bg-slate-900/80 text-red-300'
        }`}
        style={{ width: size, height: size, left, bottom, opacity: positioning === 'joystick' ? joystick.opacity : attack.opacity }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          dragOffset.current = { x: event.clientX - rect.left, y: rect.bottom - event.clientY };
        }}
        onPointerMove={move}
      >
        {positioning === 'joystick' ? <Gamepad2 size={size * 0.4} /> : <Swords size={size * 0.42} />}
      </div>
    </div>
  );
}