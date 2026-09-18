import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTRACT_INITIAL_PERCENT,
  DEFAULT_CONTRACT_REFILL_BATCH,
  DEFAULT_SPEED_BY_LEVEL,
  HUNTING_LEVEL_PROFILES,
  HUNTING_LIMITS,
  configuredAnimalCount,
  contractSpawnBatch,
  defaultVariantConfig,
  parseHuntingConfig,
  parseVariantConfig,
  parseVariantId,
  rigIdForAnimal,
  rollSpawnCount,
} from './HuntingShapes.js';
import { DEFAULT_MOTION } from './HuntingMotion.js';
import { HuntingMapGeometry } from './HuntingMapGeometry.js';
import { CRAFTING_WORLD_MAP } from './craftingWorldMapData.js';

describe('HuntingShapes', () => {
  it('parses variant ids and derives rig ids', () => {
    expect(parseVariantId('hunts/bear/forest_bear_black')).toEqual({
      category: 'hunts', animal: 'bear', variant: 'forest_bear_black', animalKey: 'hunts/bear',
    });
    expect(parseVariantId('pets/bear/x')).toBeNull();
    expect(rigIdForAnimal('residents', 'Tree')).toBe('animal-residents-tree');
  });

  it('parseHuntingConfig fills defaults and drops malformed entries', () => {
    const cfg = parseHuntingConfig({
      general: { handDamage: 'abc', enabled: false },
      variants: {
        'hunts/wolf/forest_wolf_gray': { hp: 999999999, level: 'hard', speedByLevel: { hard: 5 }, hpRegenSeconds: 7 },
        'bogus': { hp: 10 },
      },
      contracts: [
        { id: 'c-1', variantId: 'hunts/wolf/forest_wolf_gray', quantity: 0, cooldownHours: 1.5 },
        { id: 'c-1', variantId: 'hunts/wolf/forest_wolf_gray' },
        { id: 'BAD ID', variantId: 'hunts/wolf/forest_wolf_gray' },
      ],
    });
    expect(cfg.general.handDamage).toBe(5);
    expect(cfg.general.enabled).toBe(false);
    const wolf = cfg.variants['hunts/wolf/forest_wolf_gray'];
    expect(wolf.hp).toBe(100000);
    expect(wolf.level).toBe('hard');
    expect(wolf.speedByLevel.hard).toBe(10);
    expect(wolf.speedByLevel.easy).toBe(DEFAULT_SPEED_BY_LEVEL.easy);
    expect(wolf.hpRegenSeconds).toBe(10);
    expect(cfg.variants['bogus']).toBeUndefined();
    expect(cfg.contracts).toHaveLength(1);
    expect(cfg.contracts[0]).toMatchObject({
      id: 'c-1', quantity: 1, cooldownHours: 1.5, enabled: true,
      initialPercent: DEFAULT_CONTRACT_INITIAL_PERCENT, refillBatch: DEFAULT_CONTRACT_REFILL_BATCH,
    });
    expect(cfg.levelProfiles).toEqual(HUNTING_LEVEL_PROFILES);

    const clamped = parseHuntingConfig({ levelProfiles: { easy: { aggression: 5 } } });
    expect(clamped.levelProfiles.easy.aggression).toBe(1);
    // shot tuning lives in the level profile: legacy profiles (saved before it existed) get the level defaults
    const legacyProfile = parseHuntingConfig({ levelProfiles: { hard: { aggression: 0.7 } } });
    expect(legacyProfile.levelProfiles.hard.shootRange).toBe(HUNTING_LEVEL_PROFILES.hard.shootRange);
    expect(legacyProfile.levelProfiles.hard.shootRange).toBeGreaterThan(HUNTING_LEVEL_PROFILES.easy.shootRange);
    expect(parseHuntingConfig({ levelProfiles: { easy: { shootRange: 5000 } } }).levelProfiles.easy.shootRange).toBe(1200);
  });

  it('configured population counts fixed totals and random maxima, and ignores the monster tree', () => {
    const v = {
      'hunts/bear/a': { ...defaultVariantConfig(), spawnCount: 3 },
      'hunts/bear/b': { ...defaultVariantConfig(), spawnMode: 'random' as const, spawnMin: 2, spawnMax: 5 },
      'residents/tree/t': { ...defaultVariantConfig(), spawnCount: 9 },
      'residents/fox/f': { ...defaultVariantConfig(), spawnCount: 2 },
    };
    expect(configuredAnimalCount(v, 'hunts')).toBe(8);
    expect(configuredAnimalCount(v, 'residents')).toBe(2);
    expect(rollSpawnCount(v['hunts/bear/b'], () => 0.999)).toBe(5);
    expect(rollSpawnCount(v['hunts/bear/b'], () => 0)).toBe(2);
    expect(rollSpawnCount(v['hunts/bear/a'], () => 0.999)).toBe(3);
  });

  it('normalizes random spawn bounds; legacy per-variant run knobs (stride, fps) are dropped — the leap is global (motion)', () => {
    const variant = parseVariantConfig({ spawnMin: 12, spawnMax: 3, runStridePx: 40, runFps: 12 });
    expect(variant.spawnMin).toBe(3);
    expect(variant.spawnMax).toBe(12);
    expect(variant).not.toHaveProperty('runFps');
    expect(variant).not.toHaveProperty('runStridePx');
    expect(parseHuntingConfig({}).motion).toEqual(DEFAULT_MOTION);
    expect(parseHuntingConfig({ motion: { leapPx: 130, leapMs: 160 } }).motion).toMatchObject({ ...DEFAULT_MOTION, leapPx: 130, leapMs: 160 });
    // shooters are opt-in per variant; legacy configs (no flag) never shoot
    expect(parseVariantConfig({}).canShoot).toBe(false);
    expect(parseVariantConfig({ canShoot: true }).canShoot).toBe(true);
    expect(parseVariantConfig({ canShoot: 'yes' }).canShoot).toBe(false);
    // saved before the range existed: 'random' meant 0..spawnCount — keep the maximum, never a 0..0 range
    const legacy = parseVariantConfig({ spawnMode: 'random', spawnCount: 7 });
    expect([legacy.spawnMin, legacy.spawnMax]).toEqual([1, 7]);
    const legacyZero = parseVariantConfig({ spawnMode: 'random', spawnCount: 0 });
    expect(legacyZero.spawnMin).toBe(1);
    expect(legacyZero.spawnMax).toBeGreaterThanOrEqual(1);
    expect(rollSpawnCount(legacyZero, () => 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('HuntingMapGeometry', () => {
  const geo = new HuntingMapGeometry();
  it('knows the generated anchors and safe zone', () => {
    expect(CRAFTING_WORLD_MAP.residentAnchors).toHaveLength(11);
    expect(CRAFTING_WORLD_MAP.huntAnchors).toHaveLength(20);
    expect(CRAFTING_WORLD_MAP.monsterTreeAnchors).toHaveLength(16);
    const z = CRAFTING_WORLD_MAP.safeZone;
    expect(geo.inSafeZone(z.x + z.width / 2, z.y + z.height / 2)).toBe(true);
    expect(geo.isWalkableForAnimal(z.x + z.width / 2, z.y + z.height / 2)).toBe(false);
    expect(geo.isWalkableForNpc(z.x + z.width / 2, z.y + z.height / 2) || geo.isBlocked(z.x + z.width / 2, z.y + z.height / 2)).toBe(true);
  });
  it('treats rotated collision rectangles as rotated (not AABB)', () => {
    const rotated = CRAFTING_WORLD_MAP.collisionRects.find((r) => Math.abs(r[4] % 360) > 20 && Math.abs(r[4] % 360) < 160);
    expect(rotated).toBeDefined();
    const [x, y, w, h, deg] = rotated!;
    const rad = (deg * Math.PI) / 180;
    // a point just inside the rectangle along its rotated width axis
    const inside = { x: x + Math.cos(rad) * w * 0.5 - Math.sin(rad) * h * 0.5, y: y + Math.sin(rad) * w * 0.5 + Math.cos(rad) * h * 0.5 };
    expect(geo.isBlocked(inside.x, inside.y)).toBe(true);
    // the far AABB corner opposite the rotation is outside the rotated rect when it is thin
    if (h < w / 3) {
      const corner = { x: x + w, y: y + h };
      expect(geo.isBlocked(corner.x, corner.y)).toBe(false);
    }
  });

  it('contract batches: a share of the quota at acceptance, then N at a time, never past the quota', () => {
    const contract = { initialPercent: 20, refillBatch: 2 };
    expect(contractSpawnBatch(contract, { quantity: 10, killed: 0 })).toBe(2);
    expect(contractSpawnBatch(contract, { quantity: 10, killed: 2 })).toBe(2);
    expect(contractSpawnBatch(contract, { quantity: 10, killed: 9 })).toBe(1);
    expect(contractSpawnBatch(contract, { quantity: 10, killed: 10 })).toBe(0);
    // at least one animal at acceptance, even for tiny quotas / percentages
    expect(contractSpawnBatch({ initialPercent: 1, refillBatch: 3 }, { quantity: 3, killed: 0 })).toBe(1);
    expect(contractSpawnBatch({ initialPercent: 100, refillBatch: 3 }, { quantity: 3, killed: 0 })).toBe(3);
    expect(contractSpawnBatch({ initialPercent: 50, refillBatch: 3 }, { quantity: 1, killed: 0 })).toBe(1);
    // refill batches are capped by what is left to kill
    expect(contractSpawnBatch({ initialPercent: 20, refillBatch: 3 }, { quantity: 5, killed: 1 })).toBe(3);
    expect(contractSpawnBatch({ initialPercent: 20, refillBatch: 3 }, { quantity: 5, killed: 3 })).toBe(2);
    // parser clamps the new fields
    const parsed = parseHuntingConfig({ contracts: [{ id: 'c', variantId: 'hunts/wolf/forest_wolf_gray', initialPercent: 0, refillBatch: 0 }] });
    expect(parsed.contracts[0].initialPercent).toBe(HUNTING_LIMITS.initialPercent.min);
    expect(parsed.contracts[0].refillBatch).toBe(HUNTING_LIMITS.refillBatch.min);
  });
});
