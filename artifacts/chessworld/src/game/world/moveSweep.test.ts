import { describe, expect, it } from 'vitest';
import { sweepPath } from './moveSweep';

/** Parede fina de 16px (uma célula da grade): x em [16, 32). */
const thinWall = (x: number, _y: number): boolean => x >= 16 && x < 32;

describe('sweepPath', () => {
  it('nunca atravessa uma parede de 16px, mesmo com passos grandes por frame', () => {
    // Velocidade de fuga máxima (400px/s) com frames lentos: 50ms, 100ms, 250ms.
    for (const deltaMs of [50, 100, 250]) {
      const step = (400 * deltaMs) / 1000; // 20px, 40px, 100px
      const r = sweepPath(8, 50, 8 + step, 50, thinWall);
      // Invariante: NUNCA aparece do outro lado nem entra na parede
      // (pode até não se mover se o 1º substep já cair dentro dela).
      expect(r.x).toBeLessThan(16);
      expect(r.x).toBeGreaterThanOrEqual(8); // e nunca anda para trás
    }
  });

  it('sem bloqueio, chega exatamente no destino', () => {
    const r = sweepPath(0, 0, 100, 40, () => false);
    expect(r).toEqual({ x: 100, y: 40, moved: true });
  });

  it('bloqueado logo no primeiro substep: não se move', () => {
    const r = sweepPath(15.5, 50, 60, 50, thinWall);
    expect(r.moved).toBe(false);
    expect(r.x).toBe(15.5);
  });

  it('trajeto diagonal também respeita a parede', () => {
    const r = sweepPath(8, 0, 108, 100, thinWall);
    expect(r.moved).toBe(true);
    expect(r.x).toBeLessThan(16);
  });

  it('destino igual à origem: sem movimento', () => {
    const r = sweepPath(10, 10, 10, 10, () => false);
    expect(r.moved).toBe(false);
  });
});
