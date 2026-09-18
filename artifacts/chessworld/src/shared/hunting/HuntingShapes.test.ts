import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEED_BY_LEVEL,
  defaultVariantConfig,
  parseHuntingConfig,
  parseVariantId,
  reservedAnchorCount,
  rigIdForAnimal,
  rollSpawnCount,
} from './HuntingShapes.js';
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
    expect(cfg.contracts[0]).toMatchObject({ id: 'c-1', quantity: 1, cooldownHours: 1.5, enabled: true });
  });

  it('anchor budget counts random as one reserved anchor and ignores the monster tree', () => {
    const v = {
      'hunts/bear/a': { ...defaultVariantConfig(), spawnCount: 3 },
      'hunts/bear/b': { ...defaultVariantConfig(), spawnMode: 'random' as const, spawnCount: 5 },
      'residents/tree/t': { ...defaultVariantConfig(), spawnCount: 9 },
      'residents/fox/f': { ...defaultVariantConfig(), spawnCount: 2 },
    };
    expect(reservedAnchorCount(v, 'hunts')).toBe(4);
    expect(reservedAnchorCount(v, 'residents')).toBe(2);
    expect(rollSpawnCount(v['hunts/bear/b'], () => 0.999)).toBe(5);
    expect(rollSpawnCount(v['hunts/bear/a'], () => 0.999)).toBe(3);
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
});
