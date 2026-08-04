/**
 * WeaponShapes tests (spec §33) — name-independent: no real weapon family
 * names appear here; everything uses synthetic ids, exercising only the RULES
 * (the `_cN` rule, the resolution chain, the migration builder, validation).
 */
import { describe, expect, it } from 'vitest';
import type { LocalRectangle, RigConfig } from './RigShapes.js';
import {
  buildWeaponMigration,
  countWeaponProfileRects,
  getWeaponProfileFrame,
  mirrorWeaponFrameConfig,
  newWeaponProfileTemplate,
  parseWeaponAssetId,
  parseWeaponFileName,
  resolveWeaponProfileId,
  rigAnimationsWithLegacyHitboxes,
  DEFAULT_WEAPON_DAMAGE,
  DEFAULT_WEAPON_SPEED,
  defaultWeaponLevels,
  getWeaponVariantLevels,
  resolveWeaponLevelStats,
  validateWeaponFamilyConfig,
  validateWeaponHitboxProfile,
  weaponAssetId,
  weaponFamiliesUsingProfile,
  type WeaponFamilyConfig,
} from './WeaponShapes.js';

// ------------------------------------------------------------ fixtures

let rectSeq = 0;
function rect(x = 1, y = 2, width = 3, height = 4): LocalRectangle {
  rectSeq += 1;
  return { id: `r${rectSeq}`, x, y, width, height };
}

function box(enabled: boolean, rects: LocalRectangle[]) {
  return { enabled, rectangles: rects };
}

/** Minimal structurally-valid rig for cross-checks (cast on purpose). */
function makeRig(): RigConfig {
  return {
    schemaVersion: 2,
    rigId: 'rig-teste',
    displayName: 'Rig Teste',
    animations: { 'atk-a': [15, 16, 17], 'atk-b': [4, 5], 'atk-c': [8] },
    directions: { south: 0, west: 1, east: 2, north: 3 },
    animationConfigs: {
      'atk-a': {
        combat: { enabled: true, damagePerHit: 25, singleHitPerTarget: false },
        directions: {
          south: {
            frames: {
              '0': { hurtbox: box(true, [rect()]), hitbox: box(true, [rect(), rect()]) },
              // disabled group that still carries a rect — must be copied too
              '2': { hurtbox: box(false, []), hitbox: box(false, [rect()]) },
            },
          },
        },
      },
      'atk-b': {
        // no combat block (legacy rigs may miss it) → migration uses a default
        directions: {
          west: { frames: { '1': { hurtbox: box(false, []), hitbox: box(true, [rect()]) } } },
        },
      },
      'atk-c': {
        hitboxesMigratedTo: 'ja-migrado',
        directions: {
          east: { frames: { '0': { hurtbox: box(false, []), hitbox: box(true, [rect()]) } } },
        },
      },
    },
    origin: { x: 0.5, y: 0.5 },
  } as unknown as RigConfig;
}

// ------------------------------------------------------------ parsing rules

describe('parseWeaponFileName (the _cN rule, spec §4)', () => {
  it('treats a plain PNG as the default variant of its own family', () => {
    expect(parseWeaponFileName('fam.png')).toEqual({ familyId: 'fam', variantId: 'default' });
  });

  it('strips exactly one trailing _cN', () => {
    expect(parseWeaponFileName('fam_c2.png')).toEqual({ familyId: 'fam', variantId: 'c2' });
  });

  it('is greedy: only the LAST _cN is the variant', () => {
    expect(parseWeaponFileName('a_c2_c3.png')).toEqual({ familyId: 'a_c2', variantId: 'c3' });
  });

  it('normalizes zero-padded variant numbers', () => {
    expect(parseWeaponFileName('fam_c07.png')).toEqual({ familyId: 'fam', variantId: 'c7' });
  });

  it('matches case-insensitively and preserves family case', () => {
    expect(parseWeaponFileName('FamL_C4.PNG')).toEqual({ familyId: 'FamL', variantId: 'c4' });
  });

  it('returns null for non-PNG files', () => {
    expect(parseWeaponFileName('fam.txt')).toBeNull();
    expect(parseWeaponFileName('fam')).toBeNull();
  });
});

describe('weaponAssetId / parseWeaponAssetId', () => {
  it('roundtrips default and variant ids', () => {
    expect(weaponAssetId('fam', 'default')).toBe('fam');
    expect(weaponAssetId('fam', 'c2')).toBe('fam_c2');
    expect(parseWeaponAssetId('fam')).toEqual({ familyId: 'fam', variantId: 'default' });
    expect(parseWeaponAssetId('fam_c2')).toEqual({ familyId: 'fam', variantId: 'c2' });
  });

  it('keeps families whose NAME contains _cN intact (variant-vs-family swap)', () => {
    const assetId = weaponAssetId('a_c2', 'c3');
    expect(parseWeaponAssetId(assetId)).toEqual({ familyId: 'a_c2', variantId: 'c3' });
  });

  it('groups any variant of a family under the same familyId', () => {
    const files = ['x.png', 'x_c2.png', 'x_c9.png', 'y_c1.png'];
    const families = new Set(files.map((f) => parseWeaponFileName(f)?.familyId));
    expect([...families].sort()).toEqual(['x', 'y']);
  });
});

// ------------------------------------------------------------ resolution

describe('resolveWeaponProfileId (fallback chain, spec §18)', () => {
  const rigWithDefault = { defaultWeaponHitboxProfileId: 'perfil-padrao' };
  const rigWithout = { defaultWeaponHitboxProfileId: null };

  it('prefers the family association', () => {
    const fam: WeaponFamilyConfig = { familyId: 'f1', weaponHitboxProfileId: 'perfil-f1' };
    expect(resolveWeaponProfileId(fam, rigWithDefault)).toBe('perfil-f1');
  });

  it('falls back to the rig default when the family has no profile', () => {
    const fam: WeaponFamilyConfig = { familyId: 'f1', weaponHitboxProfileId: null };
    expect(resolveWeaponProfileId(fam, rigWithDefault)).toBe('perfil-padrao');
    expect(resolveWeaponProfileId(null, rigWithDefault)).toBe('perfil-padrao');
  });

  it('returns null when nothing applies (never a random profile)', () => {
    expect(resolveWeaponProfileId(null, rigWithout)).toBeNull();
    expect(resolveWeaponProfileId(undefined, undefined)).toBeNull();
    const fam: WeaponFamilyConfig = { familyId: 'f1', weaponHitboxProfileId: null };
    expect(resolveWeaponProfileId(fam, null)).toBeNull();
  });

  it('resolves every variant of a family to the same profile', () => {
    const families: Record<string, WeaponFamilyConfig> = {
      fam: { familyId: 'fam', weaponHitboxProfileId: 'perfil-fam' },
    };
    for (const assetId of ['fam', 'fam_c2', 'fam_c9']) {
      const familyId = parseWeaponAssetId(assetId).familyId;
      expect(resolveWeaponProfileId(families[familyId], rigWithout)).toBe('perfil-fam');
    }
  });
});

// ------------------------------------------------------------ validation

describe('validateWeaponHitboxProfile (spec §27)', () => {
  it('accepts a fresh template (with rig cross-check)', () => {
    const rig = makeRig();
    const p = newWeaponProfileTemplate('p-1', 'Perfil 1', rig.rigId, 'atk-a');
    const res = validateWeaponHitboxProfile(JSON.parse(JSON.stringify(p)), rig);
    expect(res.ok).toBe(true);
  });

  it('rejects structural problems', () => {
    const rig = makeRig();
    const good = () => JSON.parse(JSON.stringify(newWeaponProfileTemplate('p-1', 'P', rig.rigId, 'atk-a')));

    const badId = good();
    badId.id = 'Maiusculas!';
    expect(validateWeaponHitboxProfile(badId).ok).toBe(false);

    const noCombat = good();
    delete noCombat.combat;
    expect(validateWeaponHitboxProfile(noCombat).ok).toBe(false);

    const badDamage = good();
    badDamage.combat.damagePerHit = -5;
    expect(validateWeaponHitboxProfile(badDamage).ok).toBe(false);

    const badVersion = good();
    badVersion.schemaVersion = 99;
    expect(validateWeaponHitboxProfile(badVersion).ok).toBe(false);
  });

  it('cross-checks animation, frames, directions and rigId against the rig', () => {
    const rig = makeRig();
    const base = newWeaponProfileTemplate('p-1', 'P', rig.rigId, 'atk-b');

    const wrongAnim = { ...JSON.parse(JSON.stringify(base)), animationId: 'nao-existe' };
    const r1 = validateWeaponHitboxProfile(wrongAnim, rig);
    expect(r1.ok).toBe(false);

    const outOfRange = JSON.parse(JSON.stringify(base));
    outOfRange.directions = { west: { frames: { '5': { hitbox: box(true, [rect()]) } } } }; // atk-b has 2 frames
    const r2 = validateWeaponHitboxProfile(outOfRange, rig);
    expect(r2.ok).toBe(false);

    const unknownDir = JSON.parse(JSON.stringify(base));
    unknownDir.directions = { diagonal: { frames: {} } };
    expect(validateWeaponHitboxProfile(unknownDir, rig).ok).toBe(false);

    const wrongRig = { ...JSON.parse(JSON.stringify(base)), rigId: 'outro-rig' };
    expect(validateWeaponHitboxProfile(wrongRig, rig).ok).toBe(false);
  });
});

describe('validateWeaponFamilyConfig', () => {
  it('accepts a minimal association', () => {
    expect(validateWeaponFamilyConfig({ familyId: 'famX_2', weaponHitboxProfileId: null }).ok).toBe(true);
    expect(validateWeaponFamilyConfig({ familyId: 'famX', weaponHitboxProfileId: 'p-1' }).ok).toBe(true);
  });

  it('rejects invalid ids', () => {
    expect(validateWeaponFamilyConfig({ familyId: 'com espaço', weaponHitboxProfileId: null }).ok).toBe(false);
    expect(validateWeaponFamilyConfig({ familyId: 'ok', weaponHitboxProfileId: 'Inválido!' }).ok).toBe(false);
  });
});

// ------------------------------------------------------------ helpers

describe('profile helpers', () => {
  it('getWeaponProfileFrame returns an empty frame for missing entries', () => {
    const p = newWeaponProfileTemplate('p-1', 'P', 'rig-teste', 'atk-a');
    expect(getWeaponProfileFrame(p, 'south', 0)).toEqual({ hitbox: { enabled: false, rectangles: [] } });
  });

  it('countWeaponProfileRects sums across directions and frames', () => {
    const p = newWeaponProfileTemplate('p-1', 'P', 'rig-teste', 'atk-a');
    p.directions.south = { frames: { '0': { hitbox: box(true, [rect(), rect()]) } } };
    p.directions.west = { frames: { '1': { hitbox: box(false, [rect()]) } } };
    expect(countWeaponProfileRects(p)).toBe(3);
  });

  it('weaponFamiliesUsingProfile lists (sorted) only the families pointing at the profile', () => {
    const families: Record<string, WeaponFamilyConfig> = {
      c: { familyId: 'c', weaponHitboxProfileId: 'p-1' },
      a: { familyId: 'a', weaponHitboxProfileId: 'p-1' },
      b: { familyId: 'b', weaponHitboxProfileId: null },
      d: { familyId: 'd', weaponHitboxProfileId: 'p-2' },
    };
    expect(weaponFamiliesUsingProfile(families, 'p-1')).toEqual(['a', 'c']);
    expect(weaponFamiliesUsingProfile(families, 'p-9')).toEqual([]);
  });

  it('mirrorWeaponFrameConfig mirrors x across the origin and is an involution', () => {
    const r = rect(10, 5, 20, 8);
    const frame = { hitbox: box(true, [r]) };
    const mirrored = mirrorWeaponFrameConfig(frame);
    expect(mirrored.hitbox.enabled).toBe(true);
    expect(mirrored.hitbox.rectangles[0]).toEqual({ ...r, x: -(r.x + r.width) });
    // mirroring twice restores the original geometry
    expect(mirrorWeaponFrameConfig(mirrored).hitbox.rectangles[0]).toEqual(r);
  });
});

// ------------------------------------------------------------ migration §17

describe('buildWeaponMigration', () => {
  it('detects only animations that still carry legacy hitbox rects', () => {
    expect(rigAnimationsWithLegacyHitboxes(makeRig())).toEqual(['atk-a', 'atk-b', 'atk-c']);
  });

  it('builds one profile per unmigrated animation, with full rect parity', () => {
    const rig = makeRig();
    const before = JSON.stringify(rig);
    const res = buildWeaponMigration(rig, []);

    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    // atk-c is already marked → skipped
    expect(Object.keys(res.animationProfileIds).sort()).toEqual(['atk-a', 'atk-b']);
    expect(res.profiles).toHaveLength(2);
    expect(res.rectanglesFound).toBe(4);
    expect(res.rectanglesCopied).toBe(4);

    const byAnim = Object.fromEntries(res.profiles.map((p) => [p.animationId, p]));
    // combat copied verbatim when the legacy block exists…
    expect(byAnim['atk-a'].combat).toEqual({ enabled: true, damagePerHit: 25, singleHitPerTarget: false });
    // …and defaulted when it does not.
    expect(byAnim['atk-b'].combat.damagePerHit).toBe(10);

    // geometry copied — including the disabled group that still had a rect
    expect(byAnim['atk-a'].directions.south?.frames['0'].hitbox.rectangles).toHaveLength(2);
    expect(byAnim['atk-a'].directions.south?.frames['2'].hitbox.enabled).toBe(false);
    expect(byAnim['atk-a'].directions.south?.frames['2'].hitbox.rectangles).toHaveLength(1);

    // profiles carry ONLY hitboxes — hurtboxes stay in the rig (spec §12)
    expect('hurtbox' in byAnim['atk-a'].directions.south!.frames['0']).toBe(false);

    // deterministic ids derived from rig + animation
    expect(res.animationProfileIds['atk-a']).toBe('migrated-rig-teste-atk-a');

    // pure function: the rig object was not mutated
    expect(JSON.stringify(rig)).toBe(before);
  });

  it('dedupes ids against existing profiles', () => {
    const res = buildWeaponMigration(makeRig(), ['migrated-rig-teste-atk-a']);
    expect(res.ok).toBe(true);
    expect(res.animationProfileIds['atk-a']).toBe('migrated-rig-teste-atk-a-2');
    expect(res.animationProfileIds['atk-b']).toBe('migrated-rig-teste-atk-b');
  });

  it('produces profiles that pass validation against the source rig', () => {
    const rig = makeRig();
    for (const p of buildWeaponMigration(rig, []).profiles) {
      expect(validateWeaponHitboxProfile(JSON.parse(JSON.stringify(p)), rig).ok).toBe(true);
    }
  });
});

// ------------------------------------------------------------ item levels (variants)

function familyWith(variants?: WeaponFamilyConfig['variants']): WeaponFamilyConfig {
  return { familyId: 'fam-a', weaponHitboxProfileId: null, ...(variants ? { variants } : {}) };
}

describe('validateWeaponFamilyConfig — variants/levels', () => {
  const base = { familyId: 'fam-a', weaponHitboxProfileId: null };

  it('aceita config sem variants (retrocompatível — linhas antigas intactas)', () => {
    expect(validateWeaponFamilyConfig(base).ok).toBe(true);
  });

  it('aceita variants válidos ("default" e "cN") com levels contíguos', () => {
    const res = validateWeaponFamilyConfig({
      ...base,
      variants: {
        default: { levels: [{ level: 1, damage: 10, speed: 1 }] },
        c2: {
          levels: [
            { level: 1, damage: 12, speed: 1 },
            { level: 2, damage: 20, speed: 1.5 },
          ],
        },
      },
    });
    expect(res.ok).toBe(true);
  });

  it('rejeita id de item fora do padrão default/cN', () => {
    for (const key of ['x9', 'c0', 'C2', 'default2']) {
      const res = validateWeaponFamilyConfig({
        ...base,
        variants: { [key]: { levels: [{ level: 1, damage: 1, speed: 1 }] } },
      });
      expect(res.ok).toBe(false);
    }
  });

  it('rejeita levels não contíguos ou que não começam em 1', () => {
    for (const levels of [
      [{ level: 2, damage: 1, speed: 1 }],
      [
        { level: 1, damage: 1, speed: 1 },
        { level: 3, damage: 2, speed: 1 },
      ],
    ]) {
      expect(validateWeaponFamilyConfig({ ...base, variants: { default: { levels } } }).ok).toBe(false);
    }
  });

  it('rejeita damage não inteiro ou fora de 0..1000', () => {
    for (const damage of [-1, 2.5, 1001]) {
      const res = validateWeaponFamilyConfig({
        ...base,
        variants: { default: { levels: [{ level: 1, damage, speed: 1 }] } },
      });
      expect(res.ok).toBe(false);
    }
  });

  it('rejeita speed fora de 0.1..10 (1 = padrão do jogo)', () => {
    for (const speed of [0, 0.05, 11, Number.NaN]) {
      const res = validateWeaponFamilyConfig({
        ...base,
        variants: { default: { levels: [{ level: 1, damage: 1, speed }] } },
      });
      expect(res.ok).toBe(false);
    }
  });

  it('rejeita lista de levels vazia', () => {
    expect(validateWeaponFamilyConfig({ ...base, variants: { default: { levels: [] } } }).ok).toBe(false);
  });
});

describe('getWeaponVariantLevels / resolveWeaponLevelStats', () => {
  it('sem variants salvos: level 1 implícito com dano padrão (10) e speed 1', () => {
    const levels = getWeaponVariantLevels(familyWith(), 'default');
    expect(levels).toEqual([{ level: 1, damage: DEFAULT_WEAPON_DAMAGE, speed: DEFAULT_WEAPON_SPEED }]);
  });

  it('fallbackDamage preserva o dano do perfil para item não configurado', () => {
    expect(getWeaponVariantLevels(familyWith(), 'c3', 25)[0].damage).toBe(25);
    expect(defaultWeaponLevels(25)[0].damage).toBe(25);
    expect(getWeaponVariantLevels(null, 'default', 7)[0].damage).toBe(7);
  });

  it('cada item da MESMA família tem seus próprios levels', () => {
    const fam = familyWith({
      default: { levels: [{ level: 1, damage: 10, speed: 1 }] },
      c2: { levels: [{ level: 1, damage: 30, speed: 2 }] },
    });
    expect(getWeaponVariantLevels(fam, 'default')[0].damage).toBe(10);
    expect(getWeaponVariantLevels(fam, 'c2')[0].damage).toBe(30);
    expect(getWeaponVariantLevels(fam, 'c3')[0].damage).toBe(DEFAULT_WEAPON_DAMAGE);
  });

  it('resolve level exato; acima do salvo degrada para o maior ≤ pedido; abaixo vai ao level 1', () => {
    const fam = familyWith({
      default: {
        levels: [
          { level: 1, damage: 10, speed: 1 },
          { level: 2, damage: 18, speed: 1.3 },
          { level: 3, damage: 28, speed: 1.6 },
        ],
      },
    });
    expect(resolveWeaponLevelStats(fam, 'default', 2).damage).toBe(18);
    expect(resolveWeaponLevelStats(fam, 'default', 99)).toEqual({ level: 3, damage: 28, speed: 1.6 });
    expect(resolveWeaponLevelStats(fam, 'default', 0).level).toBe(1);
  });
});
