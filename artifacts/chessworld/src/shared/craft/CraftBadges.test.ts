import { describe, expect, it } from 'vitest';
import {
  BADGE_FOOD,
  MAX_CRAFT_BADGES_PER_ITEM,
  isBadgeableItemId,
  itemHasBadge,
  itemsWithBadge,
  normalizeCraftBadge,
  normalizeCraftBadges,
} from './CraftBadges';

describe('normalizeCraftBadge', () => {
  it('apara, minúscula e troca espaços internos por hífen', () => {
    expect(normalizeCraftBadge('  Food ')).toBe('food');
    expect(normalizeCraftBadge('Raw  Meat')).toBe('raw-meat');
    expect(normalizeCraftBadge('potion_2')).toBe('potion_2');
  });

  it('rejeita vazio, caracteres fora do padrão, começo com - e textos longos', () => {
    expect(normalizeCraftBadge('')).toBeNull();
    expect(normalizeCraftBadge('   ')).toBeNull();
    expect(normalizeCraftBadge('comida!')).toBeNull();
    expect(normalizeCraftBadge('-food')).toBeNull();
    expect(normalizeCraftBadge('a'.repeat(25))).toBeNull();
    expect(normalizeCraftBadge(42)).toBeNull();
  });
});

describe('normalizeCraftBadges', () => {
  it('remove repetidas mantendo a ordem e devolve erro para badge inválida', () => {
    expect(normalizeCraftBadges(['Food', 'forging', 'food'])).toEqual({ ok: true, badges: ['food', 'forging'] });
    const bad = normalizeCraftBadges(['food', 'não vale']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('não vale');
    expect(normalizeCraftBadges('food').ok).toBe(false);
  });

  it('limita a quantidade por item', () => {
    const many = Array.from({ length: MAX_CRAFT_BADGES_PER_ITEM + 1 }, (_, i) => `b${i}`);
    expect(normalizeCraftBadges(many).ok).toBe(false);
    expect(normalizeCraftBadges(many.slice(0, MAX_CRAFT_BADGES_PER_ITEM)).ok).toBe(true);
  });
});

describe('badges por item', () => {
  const map = { beef: ['food'], 'ferro-barra': ['smelting', 'forging'], 'gen:weapon/sword/iron': ['forging'] };

  it('itemHasBadge e itemsWithBadge (ordenado por id) toleram mapa ausente', () => {
    expect(itemHasBadge(map, 'beef', BADGE_FOOD)).toBe(true);
    expect(itemHasBadge(map, 'beef', 'forging')).toBe(false);
    expect(itemHasBadge(null, 'beef', BADGE_FOOD)).toBe(false);
    expect(itemsWithBadge(map, 'forging')).toEqual(['ferro-barra', 'gen:weapon/sword/iron']);
    expect(itemsWithBadge(undefined, 'forging')).toEqual([]);
  });

  it('aceita qualquer id da página de receitas e rejeita lixo', () => {
    expect(isBadgeableItemId('beef')).toBe(true);
    expect(isBadgeableItemId('mineral:ferro')).toBe(true);
    expect(isBadgeableItemId('gen:crafttools/pickaxe/iron')).toBe(true);
    expect(isBadgeableItemId('')).toBe(false);
    expect(isBadgeableItemId('../etc')).toBe(false);
    expect(isBadgeableItemId(null)).toBe(false);
  });
});
