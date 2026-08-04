import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_LAYERS,
  COMPOSED_SHEET,
  SKIN_TONE_IDS,
  appearanceChoiceAllowed,
  appearanceHash,
  canonicalAppearanceString,
  findClassWeaponRef,
  parseAppearanceString,
  validateAppearanceAgainstRefs,
  validateCharacterAppearance,
  validatePlayerCharacterConfig,
  type AssetCategoryLike,
  type CharacterAppearanceV1,
} from './PlayerCharacterShapes';
import { SKIN_TONES } from '../../lib/character-generator/skinTones';

const appearance: CharacterAppearanceV1 = {
  v: 1,
  skinTone: 'tone2',
  layers: {
    head: { familyId: 'head1', variantId: 'default' },
    top: { familyId: 'top0', variantId: 'c2' },
    bottom: { familyId: 'bottom0', variantId: 'default' },
    hair: { familyId: 'hair3', variantId: 'c1' },
  },
};

describe('validateCharacterAppearance', () => {
  it('aceita uma aparência válida (e hair null)', () => {
    expect(validateCharacterAppearance(appearance).ok).toBe(true);
    expect(validateCharacterAppearance({ ...appearance, layers: { ...appearance.layers, hair: null } }).ok).toBe(true);
  });

  it('rejeita tom de pele desconhecido, camada faltando e ids inválidos', () => {
    expect(validateCharacterAppearance({ ...appearance, skinTone: 'roxo' }).ok).toBe(false);
    const semTop = { ...appearance, layers: { ...appearance.layers, top: undefined } };
    expect(validateCharacterAppearance(semTop).ok).toBe(false);
    const familiaInvalida = {
      ...appearance,
      layers: { ...appearance.layers, head: { familyId: '../hack', variantId: 'default' } },
    };
    expect(validateCharacterAppearance(familiaInvalida).ok).toBe(false);
    const camadaExtra = {
      ...appearance,
      layers: { ...appearance.layers, hat: { familyId: 'hat1', variantId: 'default' } },
    };
    expect(validateCharacterAppearance(camadaExtra).ok).toBe(false);
  });
});

describe('validatePlayerCharacterConfig', () => {
  it('aceita config completa e rejeita classe/arma inválidas', () => {
    const ok = validatePlayerCharacterConfig({
      v: 1,
      classId: 'mago',
      appearance,
      equippedWeapon: 'gen:weapon/wand1/default',
    });
    expect(ok.ok).toBe(true);
    expect(validatePlayerCharacterConfig({ v: 1, classId: 'paladino', appearance, equippedWeapon: null }).ok).toBe(false);
    expect(
      validatePlayerCharacterConfig({ v: 1, classId: 'mago', appearance, equippedWeapon: 'craft:espada' }).ok,
    ).toBe(false);
  });
});

describe('forma canônica + hash', () => {
  it('é estável independentemente da ordem de inserção das chaves', () => {
    const embaralhada = JSON.parse(
      '{"layers":{"hair":{"variantId":"c1","familyId":"hair3"},"bottom":{"variantId":"default","familyId":"bottom0"},"top":{"variantId":"c2","familyId":"top0"},"head":{"variantId":"default","familyId":"head1"}},"skinTone":"tone2","v":1}',
    );
    const validated = validateCharacterAppearance(embaralhada);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(canonicalAppearanceString(validated.appearance)).toBe(canonicalAppearanceString(appearance));
  });

  it('round-trip parse + hash muda quando a receita muda', () => {
    const canonical = canonicalAppearanceString(appearance);
    const parsed = parseAppearanceString(canonical);
    expect(parsed).not.toBeNull();
    expect(canonicalAppearanceString(parsed!)).toBe(canonical);
    const outra = canonicalAppearanceString({ ...appearance, skinTone: 'bone' });
    expect(appearanceHash(canonical)).not.toBe(appearanceHash(outra));
    expect(appearanceHash(canonical)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('parse rejeita strings inválidas', () => {
    expect(parseAppearanceString('')).toBeNull();
    expect(parseAppearanceString('não é json')).toBeNull();
    expect(parseAppearanceString('{"v":2}')).toBeNull();
  });
});

describe('permissões via refs de categoria', () => {
  const refs = ['gen:head/head1', 'gen:top/top0/c2', 'gen:bottom/bottom0', 'gen:hair/hair3'];

  it('família liberada aceita qualquer variante; ref pinada exige variante exata', () => {
    expect(appearanceChoiceAllowed(refs, 'head', { familyId: 'head1', variantId: 'c7' })).toBe(true);
    expect(appearanceChoiceAllowed(refs, 'top', { familyId: 'top0', variantId: 'c2' })).toBe(true);
    expect(appearanceChoiceAllowed(refs, 'top', { familyId: 'top0', variantId: 'c3' })).toBe(false);
    expect(appearanceChoiceAllowed(refs, 'head', { familyId: 'head9', variantId: 'default' })).toBe(false);
  });

  it('validateAppearanceAgainstRefs aponta a camada bloqueada', () => {
    expect(validateAppearanceAgainstRefs(appearance, refs)).toEqual([]);
    const bloqueada = { ...appearance, layers: { ...appearance.layers, hair: { familyId: 'hair9', variantId: 'default' } } };
    const errors = validateAppearanceAgainstRefs(bloqueada, refs);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('hair');
  });
});

describe('findClassWeaponRef', () => {
  const categories: Record<string, AssetCategoryLike> = {
    'default-weapons': { categoryId: 'default-weapons', name: 'Default weapons', parentId: null, assetRefs: [] },
    arqueiro: {
      categoryId: 'arqueiro',
      name: 'Arqueiro',
      parentId: 'default-weapons',
      assetRefs: ['gen:weapon/bow1arrow1/default'],
    },
    mago: { categoryId: 'mago', name: 'Mago', parentId: 'default-weapons', assetRefs: ['craft:invalida'] },
  };

  it('acha a arma da subcategoria da classe e ignora refs que não são de arma', () => {
    expect(findClassWeaponRef(categories, 'arqueiro')).toBe('gen:weapon/bow1arrow1/default');
    expect(findClassWeaponRef(categories, 'mago')).toBeNull();
    expect(findClassWeaponRef(categories, 'guerreiro')).toBeNull();
  });
});

describe('sincronia com o gerador', () => {
  it('SKIN_TONE_IDS espelha lib/character-generator/skinTones.ts', () => {
    expect([...SKIN_TONE_IDS]).toEqual(SKIN_TONES.map((t) => t.id));
  });

  it('camadas e frames batem com o layout do pack', () => {
    expect([...APPEARANCE_LAYERS].sort()).toEqual(['bottom', 'hair', 'head', 'top']);
    expect(COMPOSED_SHEET.columns).toBe(23);
    expect(COMPOSED_SHEET.rows).toBe(4);
    expect(Math.max(...COMPOSED_SHEET.attackFrames)).toBeLessThan(COMPOSED_SHEET.columns);
    expect(COMPOSED_SHEET.deadFrame).toBeLessThan(COMPOSED_SHEET.columns);
  });
});
