/**
 * Mapeamento de teclas: padrão WASD/F/E, troca em caso de conflito, saneamento
 * do storage, rótulos e vetor de movimento.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTROL_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  actionForCode,
  isBindableCode,
  isSystemChord,
  keyLabelForCode,
  labelForKeyEvent,
  moveVectorFromActions,
  rebind,
  sanitizeBindings,
  type ControlAction,
} from './keyBindings.js';

describe('padrão', () => {
  it('WASD move, F ataca, E interage, sem teclas repetidas', () => {
    expect(DEFAULT_KEY_BINDINGS.moveUp.code).toBe('KeyW');
    expect(DEFAULT_KEY_BINDINGS.moveLeft.code).toBe('KeyA');
    expect(DEFAULT_KEY_BINDINGS.moveDown.code).toBe('KeyS');
    expect(DEFAULT_KEY_BINDINGS.moveRight.code).toBe('KeyD');
    expect(DEFAULT_KEY_BINDINGS.attack.code).toBe('KeyF');
    expect(DEFAULT_KEY_BINDINGS.interact.code).toBe('KeyE');
    const codes = CONTROL_ACTIONS.map((a) => DEFAULT_KEY_BINDINGS[a].code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('isBindableCode', () => {
  it('aceita letras, dígitos, setas, espaço, Shift e pontuação', () => {
    for (const code of ['KeyW', 'Digit1', 'Numpad5', 'ArrowUp', 'Space', 'ShiftLeft', 'Semicolon', 'IntlRo', 'Enter']) {
      expect(isBindableCode(code), code).toBe(true);
    }
  });
  it('recusa teclas do navegador/sistema (Ctrl/Alt/Meta inclusive) e lixo', () => {
    for (const code of ['Escape', 'Tab', 'F5', 'F11', 'MetaLeft', 'ControlLeft', 'AltRight', 'CapsLock', 'Backspace', '', 42, null, 'x'.repeat(30)]) {
      expect(isBindableCode(code), String(code)).toBe(false);
    }
  });
  it('isSystemChord: Ctrl/Alt/Meta ou IME; Shift não', () => {
    expect(isSystemChord({ ctrlKey: true })).toBe(true);
    expect(isSystemChord({ altKey: true })).toBe(true);
    expect(isSystemChord({ metaKey: true })).toBe(true);
    expect(isSystemChord({ isComposing: true })).toBe(true);
    expect(isSystemChord({ shiftKey: true } as any)).toBe(false);
    expect(isSystemChord({})).toBe(false);
  });
});

describe('rótulos', () => {
  it('deriva do code quando não há caractere', () => {
    expect(keyLabelForCode('KeyQ')).toBe('Q');
    expect(keyLabelForCode('Digit7')).toBe('7');
    expect(keyLabelForCode('Numpad3')).toBe('Num 3');
    expect(keyLabelForCode('ArrowLeft')).toBe('←');
    expect(keyLabelForCode('Space')).toBe('Espaço');
    expect(keyLabelForCode('ShiftLeft')).toBe('Shift Esq.');
  });
  it('prefere o caractere do layout (ABNT2 mostra Ç, não ;)', () => {
    expect(labelForKeyEvent({ code: 'Semicolon', key: 'ç' })).toBe('Ç');
    expect(labelForKeyEvent({ code: 'KeyW', key: 'w' })).toBe('W');
    expect(labelForKeyEvent({ code: 'Space', key: ' ' })).toBe('Espaço');
    expect(labelForKeyEvent({ code: 'ArrowUp', key: 'ArrowUp' })).toBe('↑');
    expect(labelForKeyEvent({ code: 'Quote', key: 'Dead' })).toBe("'");
  });
  it('com Shift segurado rotula pela tecla base (Shift+3 é "3", não "#")', () => {
    expect(labelForKeyEvent({ code: 'Digit3', key: '#', shiftKey: true })).toBe('3');
    expect(labelForKeyEvent({ code: 'ShiftLeft', key: 'Shift', shiftKey: true })).toBe('Shift Esq.');
  });
});

describe('rebind', () => {
  it('tecla livre: só a ação escolhida muda', () => {
    const { bindings, swappedWith } = rebind(DEFAULT_KEY_BINDINGS, 'attack', { code: 'Space', label: 'Espaço' });
    expect(swappedWith).toBeNull();
    expect(bindings.attack).toEqual({ code: 'Space', label: 'Espaço' });
    expect(bindings.moveUp).toEqual(DEFAULT_KEY_BINDINGS.moveUp);
    expect(DEFAULT_KEY_BINDINGS.attack.code).toBe('KeyF'); // imutável
  });

  it('tecla de outra ação: as duas trocam e ninguém fica sem tecla', () => {
    const { bindings, swappedWith } = rebind(DEFAULT_KEY_BINDINGS, 'moveUp', { code: 'KeyF', label: 'F' });
    expect(swappedWith).toBe('attack');
    expect(bindings.moveUp.code).toBe('KeyF');
    expect(bindings.attack.code).toBe('KeyW');
    expect(bindings.attack.label).toBe('W');
    const codes = CONTROL_ACTIONS.map((a) => bindings[a].code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('mesma tecla que já tinha: sem mudança (mesmo objeto)', () => {
    const r = rebind(DEFAULT_KEY_BINDINGS, 'attack', { code: 'KeyF', label: 'F' });
    expect(r.bindings).toBe(DEFAULT_KEY_BINDINGS);
    expect(r.swappedWith).toBeNull();
  });

  it('tecla proibida é ignorada', () => {
    const r = rebind(DEFAULT_KEY_BINDINGS, 'attack', { code: 'Escape', label: 'Esc' });
    expect(r.bindings).toBe(DEFAULT_KEY_BINDINGS);
  });
});

describe('sanitizeBindings (storage → mapeamento)', () => {
  it('completa ações ausentes e descarta entradas inválidas', () => {
    const b = sanitizeBindings({ attack: { code: 'Space', label: 'Espaço' }, moveUp: { code: 'F5', label: 'F5' }, interact: 'E' });
    expect(b.attack.code).toBe('Space');
    expect(b.moveUp).toEqual(DEFAULT_KEY_BINDINGS.moveUp);
    expect(b.interact).toEqual(DEFAULT_KEY_BINDINGS.interact);
    expect(b.moveLeft).toEqual(DEFAULT_KEY_BINDINGS.moveLeft);
  });

  it('rótulo ausente/longo é derivado ou cortado', () => {
    const b = sanitizeBindings({ attack: { code: 'KeyJ' }, interact: { code: 'KeyK', label: 'x'.repeat(40) } });
    expect(b.attack.label).toBe('J');
    expect(b.interact.label).toHaveLength(12);
  });

  it('duplicata corrompida: a primeira ação fica com a tecla, a outra volta ao padrão', () => {
    const b = sanitizeBindings({ moveUp: { code: 'KeyE', label: 'E' }, interact: { code: 'KeyE', label: 'E' }, attack: { code: 'KeyW', label: 'W' } });
    expect(b.moveUp.code).toBe('KeyE');
    expect(b.attack.code).toBe('KeyW');
    expect(b.interact.code).toBe('KeyF'); // padrão (KeyE) ocupado → primeira tecla livre (F, o padrão de atacar, ficou solto)
    expect(b.interact.label).toBe('F');
  });

  it('nunca deixa duas ações na mesma tecla, mesmo com o padrão ocupado', () => {
    const cases: unknown[] = [
      { moveUp: { code: 'KeyF' }, attack: { code: 'KeyF' } },
      { moveLeft: { code: 'KeyE' } },
      Object.fromEntries(CONTROL_ACTIONS.map((a) => [a, { code: 'Space' }])),
      Object.fromEntries(CONTROL_ACTIONS.map((a) => [a, { code: 'KeyW' }])),
    ];
    for (const raw of cases) {
      const b = sanitizeBindings(raw);
      const codes = CONTROL_ACTIONS.map((a) => b[a].code);
      expect(new Set(codes).size, JSON.stringify(raw)).toBe(codes.length);
      for (const a of CONTROL_ACTIONS) expect(actionForCode(b, b[a].code)).toBe(a);
    }
  });

  it('entrada inválida vira o padrão', () => {
    expect(sanitizeBindings(null)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(sanitizeBindings('lixo')).toEqual(DEFAULT_KEY_BINDINGS);
  });
});

describe('moveVectorFromActions', () => {
  const set = (...a: ControlAction[]) => new Set<ControlAction>(a);
  it('parado sem direções', () => {
    expect(moveVectorFromActions(set())).toBeNull();
  });
  it('eixos e cancelamento de opostos', () => {
    expect(moveVectorFromActions(set('moveUp'))).toEqual({ x: 0, y: -1 });
    expect(moveVectorFromActions(set('moveRight'))).toEqual({ x: 1, y: 0 });
    expect(moveVectorFromActions(set('moveUp', 'moveDown'))).toBeNull();
    expect(moveVectorFromActions(set('moveUp', 'moveDown', 'moveLeft'))).toEqual({ x: -1, y: 0 });
  });
  it('diagonal normalizada', () => {
    const v = moveVectorFromActions(set('moveDown', 'moveRight'))!;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
