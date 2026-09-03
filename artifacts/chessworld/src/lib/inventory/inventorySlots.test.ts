/**
 * Grade de slots do inventário: slot reservado à arma, arrumação estável,
 * redimensionamento pelo admin e contagem de itens sem slot.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY_COLUMNS } from '../../shared/collection/CollectionShapes.js';
import {
  countUnslottedItems,
  emptySlots,
  reconcileSlots,
  sanitizeSlots,
  swapSlots,
  weaponSlotIndex,
} from './inventorySlots.js';

const CAP = INVENTORY_COLUMNS * 2; // duas linhas: 1ª guarda, 2ª acesso rápido
const WEAPON = weaponSlotIndex(CAP);

describe('weaponSlotIndex', () => {
  it('é o primeiro slot da última linha', () => {
    expect(WEAPON).toBe(CAP - INVENTORY_COLUMNS);
    expect(weaponSlotIndex(INVENTORY_COLUMNS)).toBe(0);
  });
});

describe('sanitizeSlots (storage → grade)', () => {
  it('ajusta tamanho, remove duplicatas/lixo e esvazia o slot reservado', () => {
    const raw = ['a', 'a', 7, '', 'b', 'reservado', null, 'c', 'd', 'e', 'extra'];
    const slots = sanitizeSlots(raw, CAP);
    expect(slots).toHaveLength(CAP);
    expect(slots[0]).toBe('a');
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBeNull();
    expect(slots[4]).toBe('b');
    expect(slots[WEAPON]).toBeNull();
    expect(slots.slice(WEAPON + 1)).toEqual([null, 'c', 'd', 'e']);
  });

  it('entrada inválida vira grade vazia', () => {
    expect(sanitizeSlots(null, CAP)).toEqual(emptySlots(CAP));
    expect(sanitizeSlots('x', CAP)).toEqual(emptySlots(CAP));
  });
});

describe('reconcileSlots', () => {
  it('mantém a arrumação, remove itens zerados e encaixa novos nos livres (nunca no reservado)', () => {
    const slots = emptySlots(CAP);
    slots[3] = 'wood';
    slots[7] = 'stone';
    const next = reconcileSlots(slots, { wood: 2, stone: 0, herb: 1, ore: 5 }, CAP);
    expect(next[3]).toBe('wood');
    expect(next[7]).toBeNull();
    expect(next[WEAPON]).toBeNull();
    expect(next.filter(Boolean).sort()).toEqual(['herb', 'ore', 'wood']);
    // novos entram nos primeiros livres, na ordem dos itens
    expect(next[0]).toBe('herb');
    expect(next[1]).toBe('ore');
  });

  it('nunca coloca item no slot reservado mesmo se ele vier preenchido', () => {
    const slots = emptySlots(CAP);
    slots[WEAPON] = 'wood';
    const next = reconcileSlots(slots, { wood: 1 }, CAP);
    expect(next[WEAPON]).toBeNull();
    expect(next.indexOf('wood')).toBeGreaterThanOrEqual(0);
  });

  it('crescer a capacidade preserva posições; encolher realoca órfãos primeiro', () => {
    const small = reconcileSlots(emptySlots(CAP), { a: 1, b: 1, c: 1 }, CAP);
    const bigger = reconcileSlots(small, { a: 1, b: 1, c: 1 }, CAP + INVENTORY_COLUMNS);
    expect(bigger.slice(0, 3)).toEqual(small.slice(0, 3));
    expect(bigger[weaponSlotIndex(CAP + INVENTORY_COLUMNS)]).toBeNull();

    const wide = emptySlots(CAP + INVENTORY_COLUMNS);
    wide[CAP + 1] = 'late'; // ficaria fora da grade menor
    wide[0] = 'first';
    const shrunk = reconcileSlots(wide, { first: 1, late: 1, fresh: 1 }, CAP);
    expect(shrunk).toHaveLength(CAP);
    expect(shrunk[0]).toBe('first');
    expect(shrunk.indexOf('late')).toBeLessThan(shrunk.indexOf('fresh'));
  });

  it('itens que não cabem ficam de fora e são contados', () => {
    const items = Object.fromEntries(Array.from({ length: CAP + 3 }, (_, i) => [`item${i}`, 1]));
    const slots = reconcileSlots(emptySlots(CAP), items, CAP);
    expect(slots.filter(Boolean)).toHaveLength(CAP - 1); // todos menos o reservado
    expect(countUnslottedItems(items, slots)).toBe(4);
  });
});

describe('swapSlots', () => {
  it('troca duas posições e recusa o slot reservado ou índices inválidos', () => {
    const slots = reconcileSlots(emptySlots(CAP), { a: 1, b: 1 }, CAP);
    const swapped = swapSlots(slots, 0, CAP - 1, CAP);
    expect(swapped[CAP - 1]).toBe('a');
    expect(swapped[0]).toBeNull();
    expect(swapSlots(slots, 0, WEAPON, CAP)).toBe(slots);
    expect(swapSlots(slots, WEAPON, 1, CAP)).toBe(slots);
    expect(swapSlots(slots, 0, CAP, CAP)).toBe(slots);
    expect(swapSlots(slots, 2, 2, CAP)).toBe(slots);
  });
});
