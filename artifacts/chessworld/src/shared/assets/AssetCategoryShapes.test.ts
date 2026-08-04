import { describe, expect, it } from 'vitest';
import {
  ASSET_REF_RE,
  MAX_ASSET_REFS_PER_CATEGORY,
  craftItemRef,
  genFamilyRef,
  genVariantRef,
  parseAssetRef,
  slugifyCategoryName,
  validateAssetCategoryConfig,
  type AssetCategoryConfig,
} from './AssetCategoryShapes';

const valid = (over: Partial<AssetCategoryConfig> = {}): AssetCategoryConfig => ({
  categoryId: 'default-character',
  name: 'Default Character',
  parentId: null,
  assetRefs: ['gen:top/top1', 'gen:hair/hair2/c1', 'craft:ouro'],
  ...over,
});

describe('ASSET_REF_RE / parseAssetRef', () => {
  it('aceita ref de família inteira', () => {
    expect(parseAssetRef('gen:weapon/axe1')).toEqual({
      kind: 'gen',
      layer: 'weapon',
      familyId: 'axe1',
      variantId: null,
    });
  });
  it('aceita ref de variação específica', () => {
    expect(parseAssetRef('gen:crafttools/hammer/c2')).toEqual({
      kind: 'gen',
      layer: 'crafttools',
      familyId: 'hammer',
      variantId: 'c2',
    });
  });
  it('aceita ref de craft item', () => {
    expect(parseAssetRef('craft:barra-de-ferro')).toEqual({ kind: 'craft', itemId: 'barra-de-ferro' });
  });
  it('rejeita formatos quebrados', () => {
    for (const bad of ['gen:top', 'gen:', 'craft:', 'top/top1', 'gen:top/top1/c1/x', 'craft:Maiúsculo', '']) {
      expect(parseAssetRef(bad)).toBeNull();
      expect(ASSET_REF_RE.test(bad)).toBe(false);
    }
  });
  it('builders geram refs válidas', () => {
    expect(ASSET_REF_RE.test(genFamilyRef('top', 'top3'))).toBe(true);
    expect(ASSET_REF_RE.test(genVariantRef('top', 'top3', 'c4'))).toBe(true);
    expect(ASSET_REF_RE.test(craftItemRef('ouro'))).toBe(true);
  });
});

describe('slugifyCategoryName', () => {
  it('gera slugs previsíveis', () => {
    expect(slugifyCategoryName('Default Character')).toBe('default-character');
    expect(slugifyCategoryName('  Loja § do Jogo!  ')).toBe('loja-do-jogo');
    expect(slugifyCategoryName('Evolução')).toBe('evolucao');
  });
  it('devolve vazio quando nada sobra', () => {
    expect(slugifyCategoryName('§§§')).toBe('');
  });
});

describe('validateAssetCategoryConfig', () => {
  it('aceita config válida (raiz e sub)', () => {
    expect(validateAssetCategoryConfig(valid()).ok).toBe(true);
    expect(validateAssetCategoryConfig(valid({ parentId: 'shop-assets' })).ok).toBe(true);
    expect(validateAssetCategoryConfig(valid({ assetRefs: [] })).ok).toBe(true);
  });
  it('rejeita id/nome inválidos', () => {
    expect(validateAssetCategoryConfig(valid({ categoryId: 'Maiúsculo' })).ok).toBe(false);
    expect(validateAssetCategoryConfig(valid({ name: '' })).ok).toBe(false);
    expect(validateAssetCategoryConfig(valid({ name: 'x'.repeat(61) })).ok).toBe(false);
  });
  it('rejeita parentId apontando para si mesma', () => {
    expect(validateAssetCategoryConfig(valid({ parentId: 'default-character' })).ok).toBe(false);
  });
  it('rejeita refs malformadas, duplicadas e excesso', () => {
    expect(validateAssetCategoryConfig(valid({ assetRefs: ['top1'] })).ok).toBe(false);
    expect(validateAssetCategoryConfig(valid({ assetRefs: ['craft:a', 'craft:a'] })).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_ASSET_REFS_PER_CATEGORY + 1 }, (_, i) => `craft:item-${i}`);
    expect(validateAssetCategoryConfig(valid({ assetRefs: tooMany })).ok).toBe(false);
  });
  it('rejeita não-objetos', () => {
    expect(validateAssetCategoryConfig(null).ok).toBe(false);
    expect(validateAssetCategoryConfig([]).ok).toBe(false);
    expect(validateAssetCategoryConfig('x').ok).toBe(false);
  });
});
