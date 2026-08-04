import { describe, expect, it } from 'vitest';
import {
  MAX_INGREDIENT_QUANTITY,
  MAX_RECIPE_INGREDIENTS,
  sameIngredientBag,
  slugifyCraftItemName,
  validateCraftItemConfig,
  validateCraftRecipeConfig,
} from './CraftShapes';

// Ids/names are deliberately generic — tests must not depend on real assets.

describe('slugifyCraftItemName', () => {
  it('normaliza acentos, espaços e maiúsculas', () => {
    expect(slugifyCraftItemName('  Minério de Ouro  ')).toBe('minerio-de-ouro');
    expect(slugifyCraftItemName('PRATA')).toBe('prata');
  });

  it('devolve vazio quando nada sobra', () => {
    expect(slugifyCraftItemName('!!!')).toBe('');
    expect(slugifyCraftItemName('   ')).toBe('');
  });
});

describe('validateCraftItemConfig', () => {
  it('aceita config mínima válida (imageUrl null)', () => {
    const r = validateCraftItemConfig({ itemId: 'item-a', name: 'Item A', imageUrl: null });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejeita id fora do padrão de slug', () => {
    expect(validateCraftItemConfig({ itemId: 'Item A', name: 'x', imageUrl: null }).ok).toBe(false);
    expect(validateCraftItemConfig({ itemId: '', name: 'x', imageUrl: null }).ok).toBe(false);
  });

  it('rejeita nome vazio e URL não-http', () => {
    expect(validateCraftItemConfig({ itemId: 'a1', name: '   ', imageUrl: null }).ok).toBe(false);
    expect(validateCraftItemConfig({ itemId: 'a1', name: 'ok', imageUrl: 'ftp://x' }).ok).toBe(false);
    expect(validateCraftItemConfig({ itemId: 'a1', name: 'ok', imageUrl: 'https://x/y.png' }).ok).toBe(true);
  });
});

describe('validateCraftRecipeConfig', () => {
  const ing = (itemId: string, quantity = 1) => ({ itemId, quantity });

  it('aceita receita com 1 e com 9 ingredientes', () => {
    expect(validateCraftRecipeConfig({ targetId: 'tool1', ingredients: [ing('a')] }).ok).toBe(true);
    const nine = Array.from({ length: MAX_RECIPE_INGREDIENTS }, (_, i) => ing(`item-${i}`));
    expect(validateCraftRecipeConfig({ targetId: 'tool1_c2', ingredients: nine }).ok).toBe(true);
  });

  it('rejeita 0 e mais de 9 ingredientes', () => {
    expect(validateCraftRecipeConfig({ targetId: 'tool1', ingredients: [] }).ok).toBe(false);
    const ten = Array.from({ length: MAX_RECIPE_INGREDIENTS + 1 }, (_, i) => ing(`item-${i}`));
    expect(validateCraftRecipeConfig({ targetId: 'tool1', ingredients: ten }).ok).toBe(false);
  });

  it('rejeita ingredientes repetidos', () => {
    const r = validateCraftRecipeConfig({ targetId: 'tool1', ingredients: [ing('a'), ing('a')] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('repetido'))).toBe(true);
  });

  it('valida limites de quantidade (inteiro 1..999)', () => {
    expect(validateCraftRecipeConfig({ targetId: 't', ingredients: [ing('a', 0)] }).ok).toBe(false);
    expect(
      validateCraftRecipeConfig({ targetId: 't', ingredients: [ing('a', MAX_INGREDIENT_QUANTITY + 1)] }).ok,
    ).toBe(false);
    expect(validateCraftRecipeConfig({ targetId: 't', ingredients: [ing('a', 1.5)] }).ok).toBe(false);
    expect(
      validateCraftRecipeConfig({ targetId: 't', ingredients: [ing('a', MAX_INGREDIENT_QUANTITY)] }).ok,
    ).toBe(true);
  });

  it('rejeita item desconhecido quando a lista de itens é fornecida', () => {
    const known = new Set(['a', 'b']);
    expect(validateCraftRecipeConfig({ targetId: 't', ingredients: [ing('a')] }, known).ok).toBe(true);
    const r = validateCraftRecipeConfig({ targetId: 't', ingredients: [ing('zz')] }, known);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('desconhecido'))).toBe(true);
  });

  it('rejeita targetId inválido', () => {
    expect(validateCraftRecipeConfig({ targetId: 'não válido', ingredients: [ing('a')] }).ok).toBe(false);
  });
});

describe('sameIngredientBag', () => {
  it('é independente de ordem', () => {
    const a = [
      { itemId: 'x', quantity: 2 },
      { itemId: 'y', quantity: 1 },
    ];
    const b = [
      { itemId: 'y', quantity: 1 },
      { itemId: 'x', quantity: 2 },
    ];
    expect(sameIngredientBag(a, b)).toBe(true);
  });

  it('detecta diferenças de quantidade e de tamanho', () => {
    expect(
      sameIngredientBag([{ itemId: 'x', quantity: 1 }], [{ itemId: 'x', quantity: 2 }]),
    ).toBe(false);
    expect(sameIngredientBag([{ itemId: 'x', quantity: 1 }], [])).toBe(false);
  });
});
