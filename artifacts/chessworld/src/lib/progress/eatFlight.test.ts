import { describe, expect, it } from 'vitest';
import { EAT_FLIGHT_MS, eatFlightPose, eatFlightSchedule, predictEatCount } from './eatFlight';
import { isNewerProgressSnapshot } from './snapshotOrder';
import type { ProgressSnapshot } from '../../shared/progress/EnergySkillsShapes';

describe('predictEatCount', () => {
  it('come só o necessário para encher (mesma regra do servidor)', () => {
    expect(predictEatCount({ owned: 5, perUnit: 10, energy: 70, maxEnergy: 100 })).toBe(3);
    expect(predictEatCount({ owned: 5, perUnit: 10, energy: 75, maxEnergy: 100 })).toBe(3);
    expect(predictEatCount({ owned: 5, perUnit: 40, energy: 70, maxEnergy: 100 })).toBe(1);
  });

  it('limita ao que o jogador tem', () => {
    expect(predictEatCount({ owned: 2, perUnit: 10, energy: 0, maxEnergy: 100 })).toBe(2);
    expect(predictEatCount({ owned: 0, perUnit: 10, energy: 0, maxEnergy: 100 })).toBe(0);
  });

  it('sem snapshot (ou energia por unidade inválida) prevê um', () => {
    expect(predictEatCount({ owned: 4, perUnit: 10, energy: null, maxEnergy: null })).toBe(1);
    expect(predictEatCount({ owned: 4, perUnit: 0, energy: 50, maxEnergy: 100 })).toBe(1);
  });
});

describe('eatFlightSchedule', () => {
  it('um item sai na hora', () => {
    expect(eatFlightSchedule(1, 1600)).toEqual([0]);
  });

  it('distribui as saídas para o último chegar no fim do loader', () => {
    const delays = eatFlightSchedule(3, 1600, 650);
    expect(delays).toEqual([0, 475, 950]);
    expect(delays[delays.length - 1] + 650).toBe(1600);
  });

  it('cresce com a quantidade e nunca ultrapassa o loader', () => {
    const delays = eatFlightSchedule(10, 1600);
    expect(delays).toHaveLength(10);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    expect(delays[delays.length - 1] + EAT_FLIGHT_MS).toBeLessThanOrEqual(1600);
  });

  it('loader mais curto que o voo: todos saem juntos', () => {
    expect(eatFlightSchedule(3, 300, 650)).toEqual([0, 0, 0]);
  });
});

describe('eatFlightPose', () => {
  const from = { x: 200, y: 700 };
  const to = { x: 400, y: 300 };

  it('começa no slot e termina no personagem', () => {
    const start = eatFlightPose(from, to, 0);
    expect(start.x).toBeCloseTo(from.x);
    expect(start.y).toBeCloseTo(from.y);
    expect(start.scale).toBeCloseTo(1);
    expect(start.opacity).toBe(1);
    const end = eatFlightPose(from, to, 1);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.y).toBeCloseTo(to.y);
  });

  it('faz um arco por cima da reta e encolhe/some no final', () => {
    const mid = eatFlightPose(from, to, 0.5);
    const straightY = (from.y + to.y) / 2;
    expect(mid.y).toBeLessThan(straightY);
    expect(mid.scale).toBeGreaterThan(1);
    const late = eatFlightPose(from, to, 0.9);
    expect(late.scale).toBeLessThan(0.5);
    expect(late.opacity).toBeLessThan(1);
    const end = eatFlightPose(from, to, 1);
    expect(end.scale).toBe(0);
    expect(end.opacity).toBe(0);
  });

  it('segue o alvo quando o personagem se move', () => {
    const moved = { x: 500, y: 300 };
    expect(eatFlightPose(from, moved, 1).x).toBeCloseTo(moved.x);
    expect(eatFlightPose(from, to, 1.7).opacity).toBe(0);
  });
});

describe('isNewerProgressSnapshot', () => {
  const base = { seq: 10 } as ProgressSnapshot;

  it('aceita o primeiro snapshot e os mais novos', () => {
    expect(isNewerProgressSnapshot(null, base)).toBe(true);
    expect(isNewerProgressSnapshot(base, { seq: 11 } as ProgressSnapshot)).toBe(true);
  });

  it('descarta repetidos (HTTP + sala) e atrasados', () => {
    expect(isNewerProgressSnapshot(base, { seq: 10 } as ProgressSnapshot)).toBe(false);
    expect(isNewerProgressSnapshot(base, { seq: 9 } as ProgressSnapshot)).toBe(false);
  });

  it('sem seq de um dos lados (servidor antigo, bancada) aplica', () => {
    expect(isNewerProgressSnapshot(base, {} as ProgressSnapshot)).toBe(true);
    expect(isNewerProgressSnapshot({} as ProgressSnapshot, base)).toBe(true);
  });
});
