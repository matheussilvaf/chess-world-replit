import { describe, expect, it } from 'vitest';
import {
  autoChoicesFor,
  canCraft,
  classifyCraftEntityId,
  craftPrepSeconds,
  craftableTargetIds,
  ingredientOptionPrepSeconds,
  ingredientOptionQuantity,
  ingredientOptions,
  isInventoryItemId,
  missingIngredientsFor,
  recipeIngredientItemIds,
  recipeOutputQuantity,
  resolveRecipeChoices,
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

  it('rejeita nós do mapa que não são item (pedra de mão, animais) como alvo ou ingrediente', () => {
    const asIngredient = validateCraftRecipeConfig({
      targetId: 'gen:weapon/sword/iron',
      ingredients: [{ itemId: 'hand_stone', quantity: 1 }],
    });
    expect(asIngredient.ok).toBe(false);
    expect(asIngredient.errors.join(' ')).toContain('hand_stone');
    expect(
      validateCraftRecipeConfig({ targetId: 'hand_stone', ingredients: [{ itemId: 'mineral:pedra', quantity: 1 }] }).ok,
    ).toBe(false);
    expect(
      validateCraftRecipeConfig({ targetId: 'barra-de-ouro', ingredients: [{ itemId: 'animal:cow', quantity: 1 }] }).ok,
    ).toBe(false);
    // O item que a pedra de mão rende continua válido.
    expect(
      validateCraftRecipeConfig({ targetId: 'gen:weapon/sword/iron', ingredients: [{ itemId: 'mineral:pedra', quantity: 1 }] }).ok,
    ).toBe(true);
  });
});

describe('isInventoryItemId', () => {
  it('aceita gen:, craft items e recursos que rendem a si mesmos; recusa nós e lixo', () => {
    expect(isInventoryItemId('gen:crafttools/axe/iron')).toBe(true);
    expect(isInventoryItemId('barra-de-ouro')).toBe(true);
    expect(isInventoryItemId('mineral:pedra')).toBe(true);
    expect(isInventoryItemId('bush')).toBe(true);
    expect(isInventoryItemId('hand_stone')).toBe(false);
    expect(isInventoryItemId('animal:cow')).toBe(false);
    expect(isInventoryItemId('')).toBe(false);
    expect(isInventoryItemId(42)).toBe(false);
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

describe('outputQuantity — quantidade produzida pela receita', () => {
  const base = {
    targetId: 'barra-de-ouro',
    ingredients: [{ itemId: 'mineral:ouro', quantity: 5 }],
  };

  it('aceita ausente (legado = 1) e inteiro 1..999', () => {
    expect(validateCraftRecipeConfig(base).ok).toBe(true);
    expect(validateCraftRecipeConfig({ ...base, outputQuantity: 1 }).ok).toBe(true);
    expect(validateCraftRecipeConfig({ ...base, outputQuantity: 4 }).ok).toBe(true);
    expect(validateCraftRecipeConfig({ ...base, outputQuantity: 999 }).ok).toBe(true);
  });

  it('rejeita zero, negativo, fração, acima do teto e não-número', () => {
    for (const bad of [0, -1, 1.5, 1000, '2', null]) {
      const res = validateCraftRecipeConfig({ ...base, outputQuantity: bad });
      expect(res.ok).toBe(false);
      expect(res.errors.join(' ')).toContain('outputQuantity');
    }
  });

  it('recipeOutputQuantity aplica o padrão 1', () => {
    expect(recipeOutputQuantity({ ...base })).toBe(1);
    expect(recipeOutputQuantity({ ...base, outputQuantity: 4 })).toBe(4);
    expect(recipeOutputQuantity(undefined)).toBe(1);
    expect(recipeOutputQuantity(null)).toBe(1);
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

describe('ingredientes alternativos ("ou") e tempo de preparo', () => {
  const recipe: CraftRecipeConfig = {
    targetId: 'pocao-de-cura',
    ingredients: [
      {
        itemId: 'herb:queen_thorn',
        quantity: 2,
        prepSeconds: 0,
        alternatives: [
          { itemId: 'herb:red_herb', prepSeconds: 5 },
          { itemId: 'mineral:ouro', quantity: 5, prepSeconds: 20 },
        ],
      },
      { itemId: 'mineral:pedra', quantity: 1 },
    ],
  };

  it('valida alternativas: únicas na receita, item de inventário, tempo 0..300', () => {
    expect(validateCraftRecipeConfig(recipe).ok).toBe(true);
    const dup = validateCraftRecipeConfig({
      ...recipe,
      ingredients: [
        { ...recipe.ingredients[0], alternatives: [{ itemId: 'mineral:pedra' }] },
        recipe.ingredients[1],
      ],
    });
    expect(dup.ok).toBe(false);
    expect(dup.errors.some((e) => e.includes('repetido'))).toBe(true);
    const self = validateCraftRecipeConfig({
      ...recipe,
      ingredients: [{ ...recipe.ingredients[0], alternatives: [{ itemId: 'pocao-de-cura' }] }],
    });
    expect(self.ok).toBe(false);
    const badTime = validateCraftRecipeConfig({
      ...recipe,
      ingredients: [{ itemId: 'herb:queen_thorn', quantity: 1, alternatives: [{ itemId: 'herb:red_herb', prepSeconds: 301 }] }],
    });
    expect(badTime.ok).toBe(false);
    expect(badTime.errors.some((e) => e.includes('prepSeconds'))).toBe(true);
    const badQty = validateCraftRecipeConfig({
      ...recipe,
      ingredients: [{ itemId: 'herb:queen_thorn', quantity: 1, alternatives: [{ itemId: 'herb:red_herb', quantity: 0 }] }],
    });
    expect(badQty.ok).toBe(false);
    expect(badQty.errors.some((e) => e.includes('alternatives[0].quantity'))).toBe(true);
    const tooMany = validateCraftRecipeConfig({
      ...recipe,
      ingredients: [
        {
          itemId: 'herb:queen_thorn',
          quantity: 1,
          alternatives: [{ itemId: 'a' }, { itemId: 'b' }, { itemId: 'c' }, { itemId: 'd' }],
        },
      ],
    });
    expect(tooMany.ok).toBe(false);
    // Lista vazia é tolerada na leitura (registro sem alternativas).
    expect(
      validateCraftRecipeConfig({ ...recipe, ingredients: [{ itemId: 'herb:queen_thorn', quantity: 1, alternatives: [] }] }).ok,
    ).toBe(true);
  });

  it('ingredientOptions lista principal + alternativas; tempo só vale com alternativas', () => {
    expect(ingredientOptions(recipe.ingredients[0]).map((o) => o.itemId)).toEqual([
      'herb:queen_thorn',
      'herb:red_herb',
      'mineral:ouro',
    ]);
    expect(ingredientOptionPrepSeconds(recipe.ingredients[0], 'herb:queen_thorn')).toBe(0);
    expect(ingredientOptionPrepSeconds(recipe.ingredients[0], 'herb:red_herb')).toBe(5);
    // Quantidade por opção: própria quando definida; legado sem quantidade = a do principal.
    expect(ingredientOptions(recipe.ingredients[0]).map((o) => o.quantity)).toEqual([2, 2, 5]);
    expect(ingredientOptionQuantity(recipe.ingredients[0], 'herb:queen_thorn')).toBe(2);
    expect(ingredientOptionQuantity(recipe.ingredients[0], 'herb:red_herb')).toBe(2);
    expect(ingredientOptionQuantity(recipe.ingredients[0], 'mineral:ouro')).toBe(5);
    expect(ingredientOptionQuantity(recipe.ingredients[0], 'nao-e-opcao')).toBe(2);
    expect(ingredientOptionPrepSeconds({ itemId: 'x', quantity: 1, prepSeconds: 9 }, 'x')).toBe(0);
    expect(recipeIngredientItemIds(recipe)).toEqual(['herb:queen_thorn', 'herb:red_herb', 'mineral:ouro', 'mineral:pedra']);
  });

  it('resolveRecipeChoices aplica a escolha, calcula o maior tempo e recusa escolha inválida', () => {
    const primary = resolveRecipeChoices(recipe);
    expect(primary.ok && primary.ingredients.map((i) => i.itemId)).toEqual(['herb:queen_thorn', 'mineral:pedra']);
    expect(primary.ok && primary.prepSeconds).toBe(0);
    const alt = resolveRecipeChoices(recipe, { 'herb:queen_thorn': 'mineral:ouro' });
    expect(alt.ok && alt.ingredients[0]).toEqual({ primaryId: 'herb:queen_thorn', itemId: 'mineral:ouro', quantity: 5, prepSeconds: 20 });
    const legacy = resolveRecipeChoices(recipe, { 'herb:queen_thorn': 'herb:red_herb' });
    expect(legacy.ok && legacy.ingredients[0].quantity).toBe(2);
    expect(craftPrepSeconds(recipe, { 'herb:queen_thorn': 'mineral:ouro' })).toBe(20);
    expect(resolveRecipeChoices(recipe, { 'herb:queen_thorn': 'mineral:pedra' }).ok).toBe(false);
    expect(resolveRecipeChoices(recipe, { 'mineral:pedra': 'mineral:pedra' }).ok).toBe(true);
    expect(resolveRecipeChoices(recipe, { 'mineral:pedra': 'herb:red_herb' }).ok).toBe(false);
    expect(resolveRecipeChoices(recipe, { 'nao-existe': 'mineral:pedra' }).ok).toBe(false);
  });

  it('craftabilidade considera qualquer opção do card (escolha automática) ou a escolha dada', () => {
    // mineral:ouro pede 5 (quantidade própria): com 2 não cobre; com 5 cobre.
    expect(autoChoicesFor(recipe, { 'mineral:ouro': 2, 'mineral:pedra': 1 })).toEqual({ 'herb:queen_thorn': 'herb:queen_thorn' });
    expect(canCraft(recipe, { 'mineral:ouro': 2, 'mineral:pedra': 1 })).toBe(false);
    const counts = { 'mineral:ouro': 5, 'mineral:pedra': 1 };
    expect(autoChoicesFor(recipe, counts)).toEqual({ 'herb:queen_thorn': 'mineral:ouro' });
    expect(canCraft(recipe, counts)).toBe(true);
    expect(missingIngredientsFor(recipe, { 'mineral:ouro': 4, 'mineral:pedra': 1 }, { 'herb:queen_thorn': 'mineral:ouro' })).toEqual([
      { itemId: 'mineral:ouro', need: 5, have: 4 },
    ]);
    expect(missingIngredientsFor(recipe, counts, { 'herb:queen_thorn': 'herb:red_herb' })).toEqual([
      { itemId: 'herb:red_herb', need: 2, have: 0 },
    ]);
    expect(autoChoicesFor(recipe, {})).toEqual({ 'herb:queen_thorn': 'herb:queen_thorn' });
    expect(craftableTargetIds({ [recipe.targetId]: recipe }, counts)).toEqual(['pocao-de-cura']);
  });

  it('sameIngredientBag distingue alternativas, quantidades por opção e tempos', () => {
    const base = recipe.ingredients;
    expect(sameIngredientBag(base, [...base].reverse())).toBe(true);
    // Alternativa legada sem quantidade == a mesma com a quantidade do principal explícita.
    expect(
      sameIngredientBag(base, [
        { ...base[0], alternatives: [{ itemId: 'herb:red_herb', quantity: 2, prepSeconds: 5 }, { itemId: 'mineral:ouro', quantity: 5, prepSeconds: 20 }] },
        base[1],
      ]),
    ).toBe(true);
    expect(
      sameIngredientBag(base, [
        { ...base[0], alternatives: [{ itemId: 'herb:red_herb', quantity: 3, prepSeconds: 5 }, { itemId: 'mineral:ouro', quantity: 5, prepSeconds: 20 }] },
        base[1],
      ]),
    ).toBe(false);
    expect(sameIngredientBag(base, [{ itemId: 'herb:queen_thorn', quantity: 2 }, base[1]])).toBe(false);
    expect(
      sameIngredientBag(base, [
        { ...base[0], alternatives: [{ itemId: 'herb:red_herb', prepSeconds: 7 }, { itemId: 'mineral:ouro', prepSeconds: 20 }] },
        base[1],
      ]),
    ).toBe(false);
  });
});
