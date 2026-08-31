/**
 * Varredura de movimento com colisão, em substeps curtos.
 *
 * Por que existe: checar só o PONTO FINAL do movimento deixa um corpo
 * "atravessar" um bloqueio fino quando o passo do frame é maior que a célula
 * da grade de colisão (16px) — ex.: velocidade de fuga alta + frame lento.
 * Aqui o trajeto é dividido em substeps de no máximo `stepPx` e paramos no
 * último ponto livre antes do primeiro bloqueado.
 */
export interface SweepResult {
  x: number;
  y: number;
  moved: boolean;
}

export function sweepPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  isBlocked: (x: number, y: number) => boolean,
  stepPx = 8, // meia célula da grade de 16px — impossível pular uma célula
): SweepResult {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: fromX, y: fromY, moved: false };
  const steps = Math.max(1, Math.ceil(dist / stepPx));
  let okX = fromX;
  let okY = fromY;
  let moved = false;
  for (let i = 1; i <= steps; i++) {
    const px = fromX + (dx * i) / steps;
    const py = fromY + (dy * i) / steps;
    if (isBlocked(px, py)) break;
    okX = px;
    okY = py;
    moved = true;
  }
  return { x: okX, y: okY, moved };
}
