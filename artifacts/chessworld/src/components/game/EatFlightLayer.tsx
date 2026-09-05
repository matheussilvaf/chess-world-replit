/**
 * "Comida voando": ao comer pela hotbar, o ícone do item sai do slot e voa
 * até o personagem, onde encolhe e some — um ícone por unidade prevista,
 * espaçados ao longo do loader (ver lib/progress/eatFlight). Só visual: o
 * inventário e a energia mudam quando o servidor confirma.
 *
 * Cada voo anima o próprio elemento via requestAnimationFrame (transform e
 * opacity direto no DOM, sem re-render) e mira o personagem A CADA quadro —
 * se ele andar, a comida acompanha. Sem ponte com o mundo (bancada), o alvo
 * é o centro da janela. Com `prefers-reduced-motion`, nada voa.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getInventoryBridge } from '../../game/inventory/inventoryBridge';
import type { CraftCatalog } from '../../lib/craft/craftCatalog';
import { EAT_FLIGHT_MS, eatFlightPose, eatFlightSchedule, type FlightPoint } from '../../lib/progress/eatFlight';
import { InventoryItemThumb } from './InventoryItemVisual';

export interface EatFlight {
  id: number;
  itemKey: string;
  from: FlightPoint;
}

const ICON_PX = 34;
let flightSeq = 0;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Onde o personagem está na tela agora (centro do sprite); sem mundo, o centro da janela. */
function playerScreenPoint(): FlightPoint {
  const bridge = getInventoryBridge();
  const center = bridge?.getPlayerCenter();
  const screen = center ? bridge?.worldToScreen(center.x, center.y) : null;
  return screen ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function transformFor(point: FlightPoint, scale = 1, rotate = 0): string {
  return `translate3d(${point.x - ICON_PX / 2}px, ${point.y - ICON_PX / 2}px, 0) scale(${scale}) rotate(${rotate}deg)`;
}

function FlyingItem({ flight, catalog, onDone }: { flight: EatFlight; catalog: CraftCatalog | null; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / EAT_FLIGHT_MS);
      const pose = eatFlightPose(flight.from, playerScreenPoint(), t);
      el.style.transform = transformFor(pose, pose.scale, pose.rotate);
      el.style.opacity = String(pose.opacity);
      if (t < 1) frame = requestAnimationFrame(step);
      else onDone(flight.id);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [flight, onDone]);
  return (
    <div
      ref={ref}
      className="absolute left-0 top-0 will-change-transform"
      style={{ width: ICON_PX, height: ICON_PX, transform: transformFor(flight.from), filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.75))' }}
      data-testid="eat-flight"
      data-item-key={flight.itemKey}
    >
      <InventoryItemThumb itemKey={flight.itemKey} catalog={catalog} size={ICON_PX} />
    </div>
  );
}

/** Camada fixa acima do HUD e da janela do inventário (z-500), abaixo do ghost de arrasto (z-1000). */
export function EatFlightLayer({ flights, catalog, onDone }: { flights: EatFlight[]; catalog: CraftCatalog | null; onDone: (id: number) => void }) {
  if (flights.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[600]" aria-hidden data-testid="eat-flight-layer">
      {flights.map((flight) => (
        <FlyingItem key={flight.id} flight={flight} catalog={catalog} onDone={onDone} />
      ))}
    </div>
  );
}

/**
 * Dono da lista de voos. `launch` agenda `count` saídas ao longo de `eatMs`;
 * cada uma lê a origem na hora (`origin()`, o slot pode ter se movido) e avisa
 * `onLaunch(quantosJáSaíram)` — é isso que faz o número do slot descer um a
 * um. Com movimento reduzido só o aviso acontece. Timers morrem com o dono.
 */
export function useEatFlights() {
  const [flights, setFlights] = useState<EatFlight[]>([]);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    [],
  );
  const remove = useCallback((id: number) => setFlights((list) => list.filter((flight) => flight.id !== id)), []);
  const launch = useCallback(
    (itemKey: string, count: number, eatMs: number, origin: () => FlightPoint | null, onLaunch?: (launched: number) => void) => {
      const reduced = prefersReducedMotion();
      eatFlightSchedule(count, eatMs).forEach((delay, i) => {
        const timer = setTimeout(() => {
          timers.current = timers.current.filter((t) => t !== timer);
          const from = origin();
          if (from && !reduced) setFlights((list) => [...list, { id: ++flightSeq, itemKey, from }]);
          onLaunch?.(i + 1);
        }, delay);
        timers.current.push(timer);
      });
    },
    [],
  );
  return { flights, launch, remove };
}
