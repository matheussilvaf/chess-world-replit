/**
 * KeyboardControls: teclas físicas → ações, bloqueio (chat/menu), foco
 * perdido e troca de mapeamento — sem DOM (alvo de eventos falso).
 */
import { describe, expect, it, vi } from 'vitest';
import { KeyboardControls, type KeyEventTarget } from './KeyboardControls.js';
import { DEFAULT_KEY_BINDINGS, rebind, type KeyBindings } from '../../lib/controls/keyBindings.js';

class FakeTarget implements KeyEventTarget {
  listeners = new Map<string, Set<(e: any) => void>>();
  hidden = false;
  addEventListener(type: string, l: (e: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: (e: any) => void) {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: string, e: any = {}) {
    for (const l of this.listeners.get(type) ?? []) l(e);
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

function setup(opts: { blocked?: () => boolean; bindings?: () => KeyBindings } = {}) {
  const target = new FakeTarget();
  const doc = new FakeTarget();
  const onAction = vi.fn();
  let bindings: KeyBindings = DEFAULT_KEY_BINDINGS;
  const kb = new KeyboardControls({
    target,
    document: doc,
    getBindings: opts.bindings ?? (() => bindings),
    isBlocked: opts.blocked ?? (() => false),
    onAction,
  }).attach();
  const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => {
    const preventDefault = vi.fn();
    target.emit(type, { code, repeat, preventDefault });
    return preventDefault;
  };
  return { kb, target, doc, onAction, key, setBindings: (b: KeyBindings) => { bindings = b; } };
}

describe('movimento', () => {
  it('keyup de tecla do jogo também tem preventDefault (Espaço não "clica" botão com foco)', () => {
    const { key } = setup();
    key('keydown', 'KeyF');
    expect(key('keyup', 'KeyF')).toHaveBeenCalled();
    expect(key('keyup', 'KeyZ')).not.toHaveBeenCalled();
  });

  it('W/S/A/D pressionadas viram vetor; soltar zera', () => {
    const { kb, key } = setup();
    expect(kb.moveVector()).toBeNull();
    expect(key('keydown', 'KeyW')).toHaveBeenCalled(); // tecla do jogo: preventDefault
    expect(kb.moveVector()).toEqual({ x: 0, y: -1 });
    key('keydown', 'KeyD');
    const v = kb.moveVector()!;
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2);
    key('keyup', 'KeyW');
    expect(kb.moveVector()).toEqual({ x: 1, y: 0 });
    key('keyup', 'KeyD');
    expect(kb.moveVector()).toBeNull();
    expect(kb.isMoving()).toBe(false);
  });

  it('atalhos do navegador (Ctrl/Alt/Meta + tecla) passam direto, sem virar comando', () => {
    const { kb, target, onAction } = setup();
    for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      const preventDefault = vi.fn();
      target.emit('keydown', { code: 'KeyF', [mod]: true, preventDefault });
      expect(preventDefault, mod).not.toHaveBeenCalled();
      target.emit('keydown', { code: 'KeyW', [mod]: true, preventDefault });
      expect(kb.moveVector(), mod).toBeNull();
    }
    expect(onAction).not.toHaveBeenCalled();
    // Ctrl apertado DEPOIS de W: o keyup de W ainda solta a direção
    target.emit('keydown', { code: 'KeyW', preventDefault: vi.fn() });
    expect(kb.moveVector()).toEqual({ x: 0, y: -1 });
    target.emit('keyup', { code: 'KeyW', ctrlKey: true, preventDefault: vi.fn() });
    expect(kb.moveVector()).toBeNull();
  });

  it('tecla fora do mapeamento é ignorada (sem preventDefault)', () => {
    const { kb, key, onAction } = setup();
    expect(key('keydown', 'KeyZ')).not.toHaveBeenCalled();
    expect(kb.moveVector()).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('auto-repeat do keydown não duplica nada', () => {
    const { kb, key } = setup();
    key('keydown', 'KeyA');
    key('keydown', 'KeyA', true);
    expect(kb.moveVector()).toEqual({ x: -1, y: 0 });
    key('keyup', 'KeyA');
    expect(kb.moveVector()).toBeNull();
  });
});

describe('ações', () => {
  it('F ataca (inclusive no auto-repeat); E interage só no primeiro keydown', () => {
    const { key, onAction } = setup();
    key('keydown', 'KeyF');
    key('keydown', 'KeyF', true);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenLastCalledWith('attack');
    key('keydown', 'KeyE');
    key('keydown', 'KeyE', true);
    expect(onAction).toHaveBeenCalledTimes(3);
    expect(onAction).toHaveBeenLastCalledWith('interact');
  });
});

describe('bloqueio (chat/menu)', () => {
  it('bloqueado: keydown não vira ação nem direção', () => {
    const { kb, key, onAction } = setup({ blocked: () => true });
    expect(key('keydown', 'KeyW')).not.toHaveBeenCalled();
    key('keydown', 'KeyF');
    expect(kb.moveVector()).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('bloqueio no meio do movimento solta as direções; keyup ainda é processado', () => {
    let blocked = false;
    const { kb, key } = setup({ blocked: () => blocked });
    key('keydown', 'KeyW');
    expect(kb.moveVector()).toEqual({ x: 0, y: -1 });
    blocked = true; // abriu o chat com W apertado
    expect(kb.moveVector()).toBeNull();
    key('keyup', 'KeyW');
    blocked = false;
    expect(kb.moveVector()).toBeNull(); // não ficou preso
  });
});

describe('foco e visibilidade', () => {
  it('blur da janela e aba oculta soltam tudo', () => {
    const { kb, key, target, doc } = setup();
    key('keydown', 'KeyS');
    target.emit('blur');
    expect(kb.moveVector()).toBeNull();
    key('keydown', 'KeyS');
    doc.hidden = true;
    doc.emit('visibilitychange');
    expect(kb.moveVector()).toBeNull();
    doc.hidden = false;
    key('keydown', 'KeyS');
    doc.emit('visibilitychange'); // voltou visível: nada muda
    expect(kb.moveVector()).toEqual({ x: 0, y: 1 });
  });
});

describe('mapeamento', () => {
  it('usa o mapeamento atual e solta teclas presas quando ele muda', () => {
    const { kb, key, setBindings, onAction } = setup();
    key('keydown', 'KeyW');
    expect(kb.moveVector()).toEqual({ x: 0, y: -1 });
    // W passa a ser Atacar (troca com F)
    setBindings(rebind(DEFAULT_KEY_BINDINGS, 'attack', { code: 'KeyW', label: 'W' }).bindings);
    key('keydown', 'KeyW');
    expect(onAction).toHaveBeenCalledWith('attack');
    expect(kb.moveVector()).toBeNull(); // o W antigo não ficou "andando"
    key('keydown', 'KeyF');
    expect(kb.moveVector()).toEqual({ x: 0, y: -1 }); // F virou Mover para cima
  });
});

describe('ciclo de vida', () => {
  it('destroy remove os ouvintes e limpa o estado', () => {
    const { kb, key, target, doc } = setup();
    key('keydown', 'KeyW');
    kb.destroy();
    expect(target.count()).toBe(0);
    expect(doc.count()).toBe(0);
    expect(kb.moveVector()).toBeNull();
    key('keydown', 'KeyW');
    expect(kb.moveVector()).toBeNull();
  });
});
