import { describe, expect, it } from 'vitest';
import {
  PLACEABLE_STATIONS,
  clampStationRemaining,
  distanceToRect,
  isPlaceableStationItemKey,
  isValidPlaceableDurability,
  joinAllowedIds,
  mergeStationRemaining,
  parseAllowedIds,
  placeableStationFor,
  placedStationRect,
  placedStationSpriteOffset,
  pointInRect,
  rectsOverlap,
  stationRemainingForStorage,
} from './PlaceableStations';

describe('estações portáteis — definições', () => {
  it('cada estação tem id único, estação de destino e corpo dentro do frame', () => {
    const ids = new Set(PLACEABLE_STATIONS.map((def) => def.itemId));
    expect(ids.size).toBe(PLACEABLE_STATIONS.length);
    for (const def of PLACEABLE_STATIONS) {
      expect(def.stationId.length).toBeGreaterThan(0);
      expect(def.body.x).toBeGreaterThanOrEqual(0);
      expect(def.body.y).toBeGreaterThanOrEqual(0);
      expect(def.body.x + def.body.width).toBeLessThanOrEqual(def.sprite.frameWidth);
      expect(def.body.y + def.body.height).toBeLessThanOrEqual(def.sprite.frameHeight);
      expect(isValidPlaceableDurability(def.defaultDurability)).toBe(true);
    }
  });

  it('reconhece só as chaves das estações portáteis', () => {
    expect(isPlaceableStationItemKey('bigorna-portatil')).toBe(true);
    expect(isPlaceableStationItemKey('mesa-de-crafting-portatil')).toBe(true);
    expect(isPlaceableStationItemKey('madeira')).toBe(false);
    expect(isPlaceableStationItemKey(undefined)).toBe(false);
    expect(placeableStationFor('fornalha-portatil')?.stationId).toBe('fornalha');
    expect(placeableStationFor('picareta')).toBeNull();
  });
});

describe('estações portáteis — geometria', () => {
  const anvil = placeableStationFor('bigorna-portatil')!;

  it('o corpo é ancorado pelo centro da base', () => {
    const rect = placedStationRect(anvil, 100, 200);
    expect(rect.x + rect.width / 2).toBe(100);
    expect(rect.y + rect.height).toBe(200);
    expect(rect.width).toBe(anvil.body.width);
    expect(rect.height).toBe(anvil.body.height);
  });

  it('o deslocamento do sprite faz o corpo do frame cair sobre o retângulo do mundo', () => {
    const offset = placedStationSpriteOffset(anvil);
    // Sprite com origem (0.5, 1) em (x + offset.x, y + offset.y): canto superior esquerdo do frame.
    const frameLeft = 100 + offset.x - anvil.sprite.frameWidth / 2;
    const frameTop = 200 + offset.y - anvil.sprite.frameHeight;
    const rect = placedStationRect(anvil, 100, 200);
    expect(frameLeft + anvil.body.x).toBeCloseTo(rect.x);
    expect(frameTop + anvil.body.y).toBeCloseTo(rect.y);
  });

  it('distância ao retângulo: 0 dentro, euclidiana fora', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(distanceToRect(5, 5, rect)).toBe(0);
    expect(distanceToRect(13, 14, rect)).toBe(5);
    expect(pointInRect(10, 10, rect)).toBe(true);
    expect(pointInRect(11, 5, rect)).toBe(false);
  });

  it('sobreposição respeita a folga', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 12, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, b)).toBe(false);
    expect(rectsOverlap(a, b, 4)).toBe(true);
  });
});

describe('estações portáteis — durabilidade', () => {
  it('valida o máximo configurável', () => {
    expect(isValidPlaceableDurability(1)).toBe(true);
    expect(isValidPlaceableDurability(9999)).toBe(true);
    expect(isValidPlaceableDurability(0)).toBe(false);
    expect(isValidPlaceableDurability(10000)).toBe(false);
    expect(isValidPlaceableDurability(2.5)).toBe(false);
    expect(isValidPlaceableDurability('5')).toBe(false);
  });

  it('null = cheia, 0 é estado legítimo, lixo vira cheia, excesso satura', () => {
    expect(clampStationRemaining(null, 50)).toBe(50);
    expect(clampStationRemaining(undefined, 50)).toBe(50);
    expect(clampStationRemaining(0, 50)).toBe(0);
    expect(clampStationRemaining(-3, 50)).toBe(0);
    expect(clampStationRemaining(80, 50)).toBe(50);
    expect(clampStationRemaining(Number.NaN, 50)).toBe(50);
  });

  it('merge fica com a pior das duas cópias', () => {
    expect(mergeStationRemaining(null, 10, 50)).toBe(10);
    expect(mergeStationRemaining(7, null, 50)).toBe(7);
    expect(mergeStationRemaining(7, 0, 50)).toBe(0);
  });

  it('cheia grava null; gasta grava o valor', () => {
    expect(stationRemainingForStorage(50, 50)).toBeNull();
    expect(stationRemainingForStorage(70, 50)).toBeNull();
    expect(stationRemainingForStorage(12, 50)).toBe(12);
    expect(stationRemainingForStorage(0, 50)).toBe(0);
  });
});

describe('estações portáteis — permissões', () => {
  it('lista de autorizados vai e volta sem duplicar', () => {
    expect(parseAllowedIds('')).toEqual([]);
    expect(parseAllowedIds('a, b,,c ')).toEqual(['a', 'b', 'c']);
    expect(joinAllowedIds(['a', 'b', 'a'])).toBe('a,b');
    expect(parseAllowedIds(joinAllowedIds(['x', 'y']))).toEqual(['x', 'y']);
  });
});
