import { describe, expect, it } from 'vitest';
import { AnimalPlayback, cullState } from './animalPlayback';

describe('AnimalPlayback', () => {
  it('aplica pose somente depois do atraso', () => {
    const playback = new AnimalPlayback(120);
    playback.push('attack', 2, 0, 1000);
    expect(playback.update(1119)).toMatchObject({ anim: 'idle', dir: 0, changed: false });
    expect(playback.update(1120)).toMatchObject({ anim: 'attack', dir: 2, changed: true });
  });

  it('mostra o quadro de corrida escolhido pelo servidor, com o mesmo atraso da posição', () => {
    const playback = new AnimalPlayback(100);
    playback.push('run', 0, 1, 0);
    playback.push('run', 0, 2, 150);
    playback.push('run', 0, 0, 250);
    expect(playback.update(99).frame).toBeNull(); // still idle
    expect(playback.update(100).frame).toBe(1);
    expect(playback.update(249).frame).toBe(1);
    expect(playback.update(250).frame).toBe(2);
    expect(playback.update(350).frame).toBe(0);
  });

  it('só troca de quadro muda a pose sem marcar changed (a animação em loop não reinicia)', () => {
    const playback = new AnimalPlayback(0);
    playback.push('run', 3, 1, 0);
    expect(playback.update(0)).toMatchObject({ anim: 'run', dir: 3, frame: 1, changed: true });
    playback.push('run', 3, 2, 1);
    expect(playback.update(1)).toMatchObject({ frame: 2, changed: false });
    playback.push('run', 1, 2, 2);
    expect(playback.update(2)).toMatchObject({ dir: 1, frame: 2, changed: true });
  });

  it('fora da corrida o quadro é nulo (idle/walk/attack rodam pelo relógio do cliente)', () => {
    const playback = new AnimalPlayback(0);
    playback.push('walk', 0, 2, 0);
    expect(playback.update(0).frame).toBeNull();
    playback.push('run', 0, 2, 1);
    expect(playback.update(1).frame).toBe(2);
    playback.push('idle', 0, 2, 2);
    expect(playback.update(2).frame).toBeNull();
  });

  it('descarta poses repetidas e pula direto para a mais recente já vencida', () => {
    const playback = new AnimalPlayback(50);
    playback.push('run', 0, 1, 0);
    playback.push('run', 0, 1, 10);
    playback.push('run', 0, 2, 20);
    playback.push('run', 0, 0, 30);
    expect(playback.update(80)).toMatchObject({ frame: 0, changed: true });
  });
});

describe('cullState', () => {
  it('entra na margem e só sai depois da faixa de histerese', () => {
    expect(cullState(1199, 50, 0, 1000, 0, 100, 200, false)).toBe(true);
    expect(cullState(1225, 50, 0, 1000, 0, 100, 200, false)).toBe(false);
    expect(cullState(1225, 50, 0, 1000, 0, 100, 200, true)).toBe(true);
    expect(cullState(1241, 50, 0, 1000, 0, 100, 200, true)).toBe(false);
  });

  it('aplica os limites nos dois eixos', () => {
    expect(cullState(50, -201, 0, 100, 0, 100, 200, false)).toBe(false);
    expect(cullState(-200, 300, 0, 100, 0, 100, 200, false)).toBe(true);
  });
});
