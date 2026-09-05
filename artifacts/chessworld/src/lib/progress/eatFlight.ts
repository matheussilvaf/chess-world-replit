/**
 * "Comida voando" — a matemática pura da animação de comer pela hotbar.
 *
 * O servidor consome `min(possui, ceil(faltando / energiaPorUnidade))`
 * unidades de uma vez; o cliente prevê esse número com os mesmos dados
 * (config pública + último snapshot) para soltar UM ícone por unidade,
 * espaçados ao longo do loader de comer — o último chega ao personagem
 * quando o pedido sai. Só visual: inventário e energia mudam quando o
 * servidor confirma.
 */
export interface FlightPoint {
  x: number;
  y: number;
}

export interface FlightPose extends FlightPoint {
  scale: number;
  opacity: number;
  /** Graus. */
  rotate: number;
}

/** Duração do voo slot → personagem, por ícone. */
export const EAT_FLIGHT_MS = 650;

/** Quantas unidades o servidor vai comer (mesma regra do ProgressService.eat). Sem snapshot: 1. */
export function predictEatCount(input: { owned: number; perUnit: number; energy: number | null; maxEnergy: number | null }): number {
  const owned = Math.max(0, Math.floor(input.owned));
  if (owned <= 0) return 0;
  if (input.perUnit <= 0 || input.energy === null || input.maxEnergy === null) return 1;
  const missing = Math.max(0, input.maxEnergy - input.energy);
  return Math.max(1, Math.min(owned, Math.ceil(missing / input.perUnit)));
}

/**
 * Atrasos (ms) de saída de cada ícone: o 1º sai na hora e o último parte de
 * modo a CHEGAR quando o loader termina (`eatMs`); os demais ficam
 * igualmente espaçados. Loader mais curto que um voo → todos saem juntos.
 */
export function eatFlightSchedule(count: number, eatMs: number, flightMs = EAT_FLIGHT_MS): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [0];
  const span = Math.max(0, eatMs - flightMs);
  const step = span / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Pose do ícone em `t` ∈ [0, 1]: arco (Bézier quadrática) de `from` a `to`,
 * cresce um pouco ao "levantar" do slot e, no trecho final, encolhe e some
 * dentro do personagem — como se tivesse sido engolido. `to` pode mudar a
 * cada quadro (o personagem anda): o arco é recalculado a partir dele.
 */
export function eatFlightPose(from: FlightPoint, to: FlightPoint, t: number): FlightPose {
  const k = Math.max(0, Math.min(1, t));
  const u = easeInOutCubic(k);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const arc = Math.max(40, Math.min(150, distance * 0.3));
  const control = { x: (from.x + to.x) / 2 + dx * 0.1, y: Math.min(from.y, to.y) - arc };
  const w0 = (1 - u) * (1 - u);
  const w1 = 2 * (1 - u) * u;
  const w2 = u * u;
  const shrinkFrom = 0.7;
  const scale = k < shrinkFrom ? 1 + 0.2 * Math.sin((Math.PI * k) / shrinkFrom) : Math.max(0, 1 - (k - shrinkFrom) / (1 - shrinkFrom));
  const fadeFrom = 0.8;
  const opacity = k < fadeFrom ? 1 : Math.max(0, 1 - (k - fadeFrom) / (1 - fadeFrom));
  return {
    x: w0 * from.x + w1 * control.x + w2 * to.x,
    y: w0 * from.y + w1 * control.y + w2 * to.y,
    scale,
    opacity,
    rotate: Math.sin(k * Math.PI * 2) * 12,
  };
}
