import { useEffect, useRef, useState } from 'react';
import nipplejs from 'nipplejs';
import type { WorldScene } from '../../game/scenes/WorldScene';
import { useTouchControlsStore } from '../../stores/touchControlsStore';

const ZONE_PADDING = 24;
const DEADZONE = 0.12;

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
  // O modo "static" do nipplejs calcula o centro uma vez; ao girar/redimensionar a tela recriamos o analógico.
  const [layoutTick, setLayoutTick] = useState(0);
  const visible = joystick.enabled && isTouch && !positioning;

  useEffect(() => {
    if (!visible) return;
    const bump = () => setLayoutTick((tick) => tick + 1);
    window.addEventListener('resize', bump);
    window.addEventListener('orientationchange', bump);
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener('orientationchange', bump);
    };
  }, [visible]);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!visible || !zone) {
      getSceneRef.current()?.setExternalMoveVector(0, 0);
      return;
    }
    const manager = nipplejs.create({
      zone,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      size: joystick.size,
      // Fundo escuro translúcido + bolinha clara e opaca (o padrão "white/white a 50%" some dentro do círculo).
      color: { back: 'rgba(15, 23, 42, 0.62)', front: 'linear-gradient(135deg, #c7d2fe, #6366f1)' },
      restOpacity: 1,
      fadeTime: 0,
      multitouch: true,
      maxNumberOfJoysticks: 1,
    });
    const zero = () => getSceneRef.current()?.setExternalMoveVector(0, 0);
    // O nipplejs escuta pointermove/pointerup no `document`: nada aqui pode interromper a propagação
    // desses eventos (era o que travava o analógico enquanto o dedo estava sobre a área de toque).
    manager.on('move', (event) => {
      const data = event.data;
      if (!data?.vector) return;
      const magnitude = Math.min(1, (data.distance || 0) / (joystick.size / 2));
      if (magnitude < DEADZONE) return zero();
      getSceneRef.current()?.setExternalMoveVector(
        data.vector.x * magnitude,
        -data.vector.y * magnitude,
      );
    });
    manager.on('end', zero);
    // O Phaser também escuta touchstart/touchend na window e ignora eventos já cancelados:
    // cancelar aqui evita que o dedo do analógico vire um pointer do jogo (pinch/toque para andar).
    const swallowTouch = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const touchEvents = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
    for (const type of touchEvents) zone.addEventListener(type, swallowTouch, { passive: false });
    const onVisibility = () => { if (document.hidden) zero(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      zero();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const type of touchEvents) zone.removeEventListener(type, swallowTouch);
      manager.destroy();
    };
  }, [visible, joystick.size, joystick.position.x, joystick.position.y, layoutTick]);

  if (!visible) return null;
  // Área de toque maior que o analógico (margem de 24 px em volta) para o dedo não "errar" o início do arrasto.
  const zoneSize = joystick.size + ZONE_PADDING * 2;
  return (
    <div
      ref={zoneRef}
      aria-label="Analógico de movimento"
      className="chess-joystick absolute z-[140] pointer-events-auto select-none"
      style={{
        width: zoneSize,
        height: zoneSize,
        left: joystick.position.x - zoneSize / 2,
        bottom: joystick.position.y - zoneSize / 2,
        opacity: joystick.opacity,
        touchAction: 'none',
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
