/**
 * Formas de colisão dos objetos do Tiled (camada `Collisions` dos TMJ).
 *
 * O Tiled gira retângulos, elipses e polígonos em torno de (x, y) — o canto
 * superior esquerdo do retângulo — em graus, sentido horário (eixo Y para
 * baixo). Ignorar `rotation` põe a parede no lugar errado: um retângulo
 * 510×28 girado 90° é uma parede HORIZONTAL saindo de (x, y) para a
 * esquerda, não uma parede vertical à direita. Era isso que fechava a porta
 * da estação de poções no Mundo de Coleta.
 *
 * Saída por objeto:
 *   - `rect`: retângulo alinhado aos eixos (sem rotação ou múltiplo de 90°);
 *   - `poly`: vértices absolutos (polígono do Tiled, elipse aproximada ou
 *     retângulo girado). Para o retângulo girado também vem `box`, o corpo
 *     exato para o Matter (centro + ângulo em radianos).
 */

export interface TmjPoint {
  x: number;
  y: number;
}

export interface TmjRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TmjCollisionObject {
  id?: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  polygon?: TmjPoint[];
  polyline?: TmjPoint[];
  ellipse?: boolean;
  point?: boolean;
}

export interface RotatedBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Radianos, sentido horário (convenção do Matter e do Tiled com Y para baixo). */
  angle: number;
}

export type TmjCollisionShape =
  | { kind: 'rect'; rect: TmjRect }
  | { kind: 'poly'; points: TmjPoint[]; box: RotatedBox | null };

/** Vértices por elipse aproximada (polígono convexo). */
const ELLIPSE_SEGMENTS = 16;
/** Ângulos até aqui (graus) contam como "sem rotação". */
const ROTATION_EPSILON_DEG = 0.01;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Gira um ponto local em torno da origem do objeto e devolve a posição absoluta. */
function rotateAround(origin: TmjPoint, local: TmjPoint, cos: number, sin: number): TmjPoint {
  return {
    x: origin.x + local.x * cos - local.y * sin,
    y: origin.y + local.x * sin + local.y * cos,
  };
}

function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Caixa alinhada aos eixos que envolve os pontos. */
export function boundsOf(points: TmjPoint[]): TmjRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Converte um objeto da camada de colisão na forma que o jogo usa. Pontos,
 * polilinhas e objetos degenerados (sem área) devolvem null.
 */
export function tmjCollisionShape(obj: TmjCollisionObject): TmjCollisionShape | null {
  if (obj.point || obj.polyline) return null;
  const rotationDeg = typeof obj.rotation === 'number' && Number.isFinite(obj.rotation) ? obj.rotation : 0;
  const rotated = Math.abs(rotationDeg) > ROTATION_EPSILON_DEG;
  const rad = toRadians(rotationDeg);
  const cos = rotated ? Math.cos(rad) : 1;
  const sin = rotated ? Math.sin(rad) : 0;
  const origin = { x: obj.x, y: obj.y };

  if (obj.polygon) {
    if (obj.polygon.length < 3) return null;
    const points = obj.polygon.map((p) => rotateAround(origin, p, cos, sin));
    return { kind: 'poly', points, box: null };
  }

  const width = typeof obj.width === 'number' ? obj.width : 0;
  const height = typeof obj.height === 'number' ? obj.height : 0;
  if (!(width > 0) || !(height > 0)) return null;

  if (obj.ellipse) {
    const points: TmjPoint[] = [];
    for (let i = 0; i < ELLIPSE_SEGMENTS; i += 1) {
      const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
      points.push(rotateAround(origin, { x: width / 2 + (width / 2) * Math.cos(t), y: height / 2 + (height / 2) * Math.sin(t) }, cos, sin));
    }
    return { kind: 'poly', points, box: null };
  }

  if (!rotated) {
    return { kind: 'rect', rect: { x: obj.x, y: obj.y, width, height } };
  }

  const corners = [
    rotateAround(origin, { x: 0, y: 0 }, cos, sin),
    rotateAround(origin, { x: width, y: 0 }, cos, sin),
    rotateAround(origin, { x: width, y: height }, cos, sin),
    rotateAround(origin, { x: 0, y: height }, cos, sin),
  ];
  // Múltiplos de 90°: a caixa envolvente É o retângulo — segue o caminho barato.
  const normalized = normalizeDegrees(rotationDeg);
  const quarter = Math.round(normalized / 90) * 90;
  if (Math.abs(normalized - quarter) <= ROTATION_EPSILON_DEG) {
    return { kind: 'rect', rect: boundsOf(corners) };
  }
  const center = rotateAround(origin, { x: width / 2, y: height / 2 }, cos, sin);
  return { kind: 'poly', points: corners, box: { cx: center.x, cy: center.y, width, height, angle: rad } };
}
