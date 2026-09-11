import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundsOf, tmjCollisionShape, type TmjCollisionObject, type TmjPoint } from './tmjCollisionShapes';

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

function pointInPolygon(px: number, py: number, vertices: TmjPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('tmjCollisionShape', () => {
  it('retângulo sem rotação continua retângulo; pontos e polilinhas são ignorados', () => {
    expect(tmjCollisionShape({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ kind: 'rect', rect: { x: 10, y: 20, width: 30, height: 40 } });
    expect(tmjCollisionShape({ x: 10, y: 20, width: 0, height: 0, point: true })).toBeNull();
    expect(tmjCollisionShape({ x: 10, y: 20, polyline: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })).toBeNull();
    expect(tmjCollisionShape({ x: 10, y: 20, width: 0, height: 5 })).toBeNull();
  });

  it('retângulo girado 90° vira uma parede horizontal à esquerda da origem (convenção do Tiled)', () => {
    // Tiled gira em torno de (x, y), sentido horário: 90° manda a largura para baixo e a altura para a esquerda.
    const shape = tmjCollisionShape({ x: 100, y: 50, width: 20, height: 200, rotation: 90 });
    expect(shape?.kind).toBe('rect');
    if (shape?.kind !== 'rect') return;
    expect(near(shape.rect.x, -100)).toBe(true);
    expect(near(shape.rect.y, 50)).toBe(true);
    expect(near(shape.rect.width, 200)).toBe(true);
    expect(near(shape.rect.height, 20)).toBe(true);
  });

  it('180° espelha o retângulo para o outro lado da origem', () => {
    const shape = tmjCollisionShape({ x: 100, y: 100, width: 10, height: 40, rotation: 180 });
    expect(shape?.kind).toBe('rect');
    if (shape?.kind !== 'rect') return;
    expect(near(shape.rect.x, 90)).toBe(true);
    expect(near(shape.rect.y, 60)).toBe(true);
    expect(near(shape.rect.width, 10)).toBe(true);
    expect(near(shape.rect.height, 40)).toBe(true);
  });

  it('rotação arbitrária vira polígono com caixa exata para o Matter', () => {
    const shape = tmjCollisionShape({ x: 0, y: 0, width: 100, height: 10, rotation: 45 });
    expect(shape?.kind).toBe('poly');
    if (shape?.kind !== 'poly') return;
    expect(shape.points).toHaveLength(4);
    expect(shape.box).not.toBeNull();
    const c = Math.SQRT1_2;
    expect(near(shape.points[1].x, 100 * c)).toBe(true);
    expect(near(shape.points[1].y, 100 * c)).toBe(true);
    expect(near(shape.box!.cx, 50 * c - 5 * c)).toBe(true);
    expect(near(shape.box!.cy, 50 * c + 5 * c)).toBe(true);
    expect(near(shape.box!.angle, Math.PI / 4, 1e-9)).toBe(true);
    expect(pointInPolygon(50 * c - 5 * c, 50 * c + 5 * c, shape.points)).toBe(true);
  });

  it('polígonos e elipses respeitam a rotação e a origem', () => {
    const poly = tmjCollisionShape({ x: 10, y: 10, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], rotation: 90 });
    expect(poly?.kind).toBe('poly');
    if (poly?.kind !== 'poly') return;
    expect(near(poly.points[1].x, 10)).toBe(true);
    expect(near(poly.points[1].y, 20)).toBe(true);
    const ellipse = tmjCollisionShape({ x: 0, y: 0, width: 40, height: 20, ellipse: true });
    expect(ellipse?.kind).toBe('poly');
    if (ellipse?.kind !== 'poly') return;
    const b = boundsOf(ellipse.points);
    expect(near(b.x, 0, 1)).toBe(true);
    expect(near(b.width, 40, 1)).toBe(true);
    expect(near(b.height, 20, 1)).toBe(true);
  });

  it('crafting-world.tmj: a porta leste da estação de poções fica livre e as paredes giradas caem no lugar certo', () => {
    const tmjPath = resolve(__dirname, '../../../public/assets/CraftingWorld/map/crafting-world.tmj');
    const tmj = JSON.parse(readFileSync(tmjPath, 'utf8')) as { layers: Array<{ name: string; type: string; layers?: unknown[]; objects?: TmjCollisionObject[] }> };
    const findLayer = (layers: typeof tmj.layers, name: string): TmjCollisionObject[] | null => {
      for (const layer of layers) {
        if (layer.type === 'group') {
          const found = findLayer((layer.layers ?? []) as typeof tmj.layers, name);
          if (found) return found;
        } else if (layer.type === 'objectgroup' && layer.name.toLowerCase() === name) {
          return layer.objects ?? [];
        }
      }
      return null;
    };
    const objects = findLayer(tmj.layers, 'collisions');
    expect(objects).not.toBeNull();
    const shapes = objects!.map((o) => ({ obj: o, shape: tmjCollisionShape(o) }));
    // O mapa real tem centenas de retângulos girados — o caso que motivou o helper.
    expect(shapes.filter(({ obj }) => Math.abs(obj.rotation ?? 0) > 1).length).toBeGreaterThan(100);

    // Parede 188: 28×510 girada ~90° em (2826, 1958) = topo da estação de poções (horizontal, para a esquerda).
    const top = shapes.find(({ obj }) => obj.id === 188)?.shape;
    expect(top).not.toBeNull();
    const topBounds = top!.kind === 'rect' ? top!.rect : boundsOf(top!.points);
    expect(topBounds.width).toBeGreaterThan(450);
    expect(topBounds.height).toBeLessThan(40);
    expect(near(topBounds.x, 2316, 3)).toBe(true);
    expect(near(topBounds.y, 1955, 3)).toBe(true);

    // A porta (lado leste, entre as paredes 189 e 182): nenhuma forma pode cobrir este ponto.
    const door = { x: 2832, y: 2212 };
    const blockers = shapes.filter(({ shape }) => {
      if (!shape) return false;
      if (shape.kind === 'rect') {
        const r = shape.rect;
        return door.x >= r.x && door.x <= r.x + r.width && door.y >= r.y && door.y <= r.y + r.height;
      }
      return pointInPolygon(door.x, door.y, shape.points);
    });
    expect(blockers.map(({ obj }) => obj.id)).toEqual([]);
  });
});
