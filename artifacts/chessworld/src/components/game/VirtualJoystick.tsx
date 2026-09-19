import { useEffect, useRef, useState } from 'react';
import nipplejs from 'nipplejs';
import type { WorldScene } from '../../game/scenes/WorldScene';
import { useTouchControlsStore } from '../../stores/touchControlsStore';

const ZONE_PADDING = 24;

export function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export function VirtualJoystick({ getScene }: { getScene: () => WorldScene | null }) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const getSceneRef = useRef(getScene);
  getSceneRef.current = getScene;
  const joystick = useTouchControlsStore((s) => s.joystick);
  const positioning = useTouchControlsStore((s) => s.positioning);
  const [isTouch] = useState(detectTouchDevice);
  const visible = joystick.enabled && isTouch && !positioning;

  useEffect(() => {
    if (!visible || !zoneRef.current) {
      getSceneRef.current()?.setExternalMoveVector(0, 0);
      return;
    }
    const manager = nipplejs.create({
      zone: zoneRef.current,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      size: joystick.size,
      color: 'white',
      restOpacity: 0.7,
      fadeTime: 0,
      multitouch: true,
      maxNumberOfJoysticks: 1,
    });
    const zero = () => getSceneRef.current()?.setExternalMoveVector(0, 0);
    manager.on('move', (event) => {
      const data = event.data;
      if (!data?.vector) return;
      const magnitude = Math.min(1, (data.distance || 0) / (joystick.size / 2));
      if (magnitude < 0.12) return zero();
      getSceneRef.current()?.setExternalMoveVector(
        data.vector.x * magnitude,
        -data.vector.y * magnitude,
      );
    });
    manager.on('end', zero);
    const onVisibility = () => { if (document.hidden) zero(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      zero();
      document.removeEventListener('visibilitychange', onVisibility);
      manager.destroy();
    };
  }, [visible, joystick.size]);

  if (!visible) return null;
  // Área de toque maior que o analógico (margem de 24 px em volta) para o dedo não "errar" o início do arrasto.
  const zoneSize = joystick.size + ZONE_PADDING * 2;
  return (
    <div
      ref={zoneRef}
      aria-label="Analógico de movimento"
      className="absolute z-[140] pointer-events-auto select-none"
      style={{
        width: zoneSize,
        height: zoneSize,
        left: joystick.position.x - zoneSize / 2,
        bottom: joystick.position.y - zoneSize / 2,
        opacity: joystick.opacity,
        touchAction: 'none',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
