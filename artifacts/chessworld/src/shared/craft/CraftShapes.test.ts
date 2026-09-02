import { describe, expect, it } from 'vitest';
import {
  canCraft,
  classifyCraftEntityId,
  craftableTargetIds,
  missingIngredientsFor,
  sameIngredientBag,
  slugifyCraftItemName,
  validateCraftItemConfig,
  validateCraftRecipeConfig,
  type CraftRecipeConfig,
} from './CraftShapes';

describe('classifyCraftEntityId', () => {
  it('reconhece refs gen: completas de arma e ferramenta', () => {
    expect(classifyCraftEntityId('gen:crafttools/axe/stone')).toBe('gen');
    expect(classifyCraftEntityId('gen:weapon/sword/default')).toBe('gen');
    expect(classifyCraftEntityId('gen:weapon/bowandarrow/c2')).toBe('gen');
  });

  it('exige a variação explícita e categoria conhecida', () => {
    expect(classifyCraftEntityId('gen:crafttools/axe')).toBeNull();
    expect(classifyCraftEntityId('gen:hat/top/default')).toBeNull();
    expect(classifyCraftEntityId('gen:weapon/Sword/stone')).toBeNull();
  });

  it('reconhece chaves de recurso do Mundo de Coleta', () => {
    expect(classifyCraftEntityId('mineral:pedra')).toBe('resource');
    expect(classifyCraftEntityId('tree:pinheiro_peao')).toBe('resource');
    expect(classifyCraftEntityId('herb:queen_thorn')).toBe('resource');
    expect(classifyCraftEntityId('animal:cow')).toBe('resource');
  });

  it('chaves de recurso com cara de slug NÃO viram custom', () => {
    expect(classifyCraftEntityId('bush')).toBe('resource');
    expect(classifyCraftEntityId('hand_stone')).toBe('resource');
  });

  it('slugs comuns são custom; lixo é null', () => {
    expect(classifyCraftEntityId('barra-de-ouro')).toBe('custom');
    expect(classifyCraftEntityId('axe_stone')).toBe('custom'); // alvo legado migrável
    expect(classifyCraftEntityId('')).toBeNull();
    expect(classifyCraftEntityId('Maiusculo')).toBeNull();
    expect(classifyCraftEntityId('mineral:nao_existe')).toBeNull();
    expect(classifyCraftEntityId(42)).toBeNull();
  });
});

describe('slugifyCraftItemName', () => {
  it('gera slug e rejeita colisão com chave de recurso', () => {
    expect(slugifyCraftItemName('Barra de Ouro')).toBe('barra-de-ouro');
    expect(slugifyCraftItemName('Bush')).toBe('');
    // Espaço vira "-", nunca "_" — logo "hand stone" NÃO colide com hand_stone.
    expect(slugifyCraftItemName('hand stone')).toBe('hand-stone');
  });
});

describe('validateCraftItemConfig — repairsItemId', () => {
  const base = { itemId: 'kit-machado', name: 'Kit do Machado', imageUrl: null };

  it('aceita null/ausente e ref gen: válida', () => {
    expect(validateCraftItemConfig(base).ok).toBe(true);
    expect(validateCraftItemConfig({ ...base, repairsItemId: null }).ok).toBe(true);
    expect(
      validateCraftItemConfig({ ...base, repairsItemId: 'gen:crafttools/axe/stone' }).ok,
    ).toBe(true);
  });

  it('rejeita alvo de reparo que não é arma/ferramenta', () => {
    expect(validateCraftItemConfig({ ...base, repairsItemId: 'mineral:pedra' }).ok).toBe(false);
    expect(validateCraftItemConfig({ ...base, repairsItemId: 'barra-de-ouro' }).ok).toBe(false);
    expect(validateCraftItemConfig({ ...base, repairsItemId: 'gen:crafttools/axe' }).ok).toBe(false);
  });

  it('rejeita itemId que colide com recurso', () => {
    expect(validateCraftItemConfig({ itemId: 'bush', name: 'Arbusto falso', imageUrl: null }).ok).toBe(
      false,
    );
  });
});

describe('validateCraftRecipeConfig — ids de qualquer classe', () => {
  const known = new Set(['barra-de-ouro']);

  it('aceita alvo gen:/recurso/custom com ingredientes mistos', () => {
    const recipe = {
      targetId: 'gen:crafttools/axe/iron',
      ingredients: [
        { itemId: 'mineral:ferro', quantity: 3 },
        { itemId: 'tree:carvalho_torre', quantity: 2 },
        { itemId: 'barra-de-ouro', quantity: 1 },
      ],
    };
    expect(validateCraftRecipeConfig(recipe, known).ok).toBe(true);
    expect(
      validateCraftRecipeConfig({ targetId: 'barra-de-ouro', ingredients: [{ itemId: 'mineral:ouro', quantity: 5 }] }, known).ok,
    ).toBe(true);
  });

  it('rejeita o próprio item como ingrediente', () => {
    const res = validateCraftRecipeConfig(
      { targetId: 'mineral:ferro', ingredients: [{ itemId: 'mineral:ferro', quantity: 1 }] },
      known,
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/próprio item/);
  });

  it('só cobra existência no banco de ids custom', () => {
    const res = validateCraftRecipeConfig(
      {
        targetId: 'gen:weapon/sword/iron',
        ingredients: [
          { itemId: 'mineral:ferro', quantity: 1 }, // recurso: nunca vai ao banco
          { itemId: 'sumiu-do-banco', quantity: 1 },
        ],
      },
      known,
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('sumiu-do-banco');
    expect(res.errors.join(' ')).not.toContain('mineral:ferro');
  });

  it('rejeita id fora de qualquer classe e duplicado', () => {
    expect(
      validateCraftRecipeConfig({ targetId: 'GEN:x', ingredients: [{ itemId: 'mineral:pedra', quantity: 1 }] }).ok,
    ).toBe(false);
    const dup = validateCraftRecipeConfig({
      targetId: 'gen:weapon/sword/iron',
      ingredients: [
        { itemId: 'mineral:pedra', quantity: 1 },
        { itemId: 'mineral:pedra', quantity: 2 },
      ],
    });
    expect(dup.ok).toBe(false);
  });
});

describe('craftabilidade', () => {
  const recipes: Record<string, CraftRecipeConfig> = {
    'gen:crafttools/axe/stone': {
      targetId: 'gen:crafttools/axe/stone',
      ingredients: [
        { itemId: 'mineral:pedra', quantity: 3 },
        { itemId: 'tree:pinheiro_peao', quantity: 2 },
      ],
    },
    'barra-de-ouro': {
      targetId: 'barra-de-ouro',
      ingredients: [{ itemId: 'mineral:ouro', quantity: 5 }],
    },
  };

  it('missingIngredientsFor calcula need/have por item', () => {
    const missing = missingIngredientsFor(recipes['gen:crafttools/axe/stone'], {
      'mineral:pedra': 1,
    });
    expect(missing).toEqual([
      { itemId: 'mineral:pedra', need: 3, have: 1 },
      { itemId: 'tree:pinheiro_peao', need: 2, have: 0 },
    ]);
  });

  it('canCraft e craftableTargetIds respondem direto de um Record de contagens', () => {
    const counts = { 'mineral:pedra': 3, 'tree:pinheiro_peao': 2, 'mineral:ouro': 4 };
    expect(canCraft(recipes['gen:crafttools/axe/stone'], counts)).toBe(true);
    expect(canCraft(recipes['barra-de-ouro'], counts)).toBe(false);
    expect(craftableTargetIds(recipes, counts)).toEqual(['gen:crafttools/axe/stone']);
    expect(craftableTargetIds(recipes, {})).toEqual([]);
  });
});

describe('sameIngredientBag', () => {
  it('continua ignorando ordem', () => {
    expect(
      sameIngredientBag(
        [
          { itemId: 'a', quantity: 1 },
          { itemId: 'b', quantity: 2 },
        ],
        [
          { itemId: 'b', quantity: 2 },
          { itemId: 'a', quantity: 1 },
        ],
      ),
    ).toBe(true);
  });
});
