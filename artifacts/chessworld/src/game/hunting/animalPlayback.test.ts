import { describe, expect, it } from 'vitest';
import { AnimalPlayback } from './animalPlayback';

describe('AnimalPlayback', () => {
  it('aplica pose somente depois do atraso', () => {
    const playback = new AnimalPlayback(120);
    playback.push('attack', 2, 40, 1000);
    expect(playback.update(1119, 0, 0)).toMatchObject({ anim: 'idle', dir: 0, changed: false });
    expect(playback.update(1120, 0, 0)).toMatchObject({ anim: 'attack', dir: 2, changed: true });
  });

  // stride 40 → ciclo de 80 px: no ar (quadro 0) 0-32, agachado (1) 32-40, no ar (2) 40-72, agachado (1) 72-80
  it('escolhe quadros 0, 1, 2, 1 pela distância', () => {
    const playback = new AnimalPlayback(0);
    playback.push('run', 0, 40, 0);
    expect(playback.update(0, 0, 0).frame).toBe(0);
    expect(playback.update(1, 20, 0).frame).toBe(0);
    expect(playback.update(2, 35, 0).frame).toBe(1);
    expect(playback.update(3, 50, 0).frame).toBe(2);
    expect(playback.update(4, 75, 0).frame).toBe(1);
    expect(playback.update(5, 85, 0).frame).toBe(0);
  });

  it('reinicia o acumulador ao voltar a correr', () => {
    const playback = new AnimalPlayback(0);
    playback.push('run', 0, 40, 0);
    playback.update(0, 0, 0);
    playback.update(1, 50, 0);
    playback.push('walk', 0, 40, 2);
    playback.update(2, 55, 0);
    playback.push('run', 0, 40, 3);
    expect(playback.update(3, 60, 0).frame).toBe(0);
  });

  it('reinicia o ciclo quando a passada muda', () => {
    const playback = new AnimalPlayback(0);
    playback.push('run', 0, 40, 0);
    playback.update(0, 0, 0);
    expect(playback.update(1, 50, 0).frame).toBe(2);
    // stride 20 → ciclo de 40 px: agachado entre 16 e 20
    playback.push('run', 0, 20, 2);
    expect(playback.update(2, 52, 0).frame).toBe(0);
    expect(playback.update(3, 68, 0).frame).toBe(1);
  });

  it('ignora saltos de teleporte', () => {
    const playback = new AnimalPlayback(0);
    playback.push('run', 0, 40, 0);
    playback.update(0, 0, 0);
    playback.update(1, 5, 0);
    expect(playback.update(2, 500, 0).frame).toBe(0);
    expect(playback.update(3, 530, 0).frame).toBe(1);
  });
});