import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { craftDepthForY, isBelowPlayerLayer } from './craftingMapConfig';

describe('camadas de piso (isBelowPlayerLayer)', () => {
  it('reconhece o tabuleiro do Big Chess Board, class floor/below_player e "(below)"', () => {
    expect(isBelowPlayerLayer({ name: 'bigchessboard' })).toBe(true);
    expect(isBelowPlayerLayer({ name: 'Big Chess Board' })).toBe(true);
    expect(isBelowPlayerLayer({ name: 'big_chess-board' })).toBe(true);
    expect(isBelowPlayerLayer({ name: 'Ponte (below)' })).toBe(true);
    expect(isBelowPlayerLayer({ name: 'Ponte', class: 'floor' })).toBe(true);
    expect(isBelowPlayerLayer({ name: 'Ponte', class: 'below_player' })).toBe(true);
    expect(isBelowPlayerLayer({ name: 'Portal Top' })).toBe(false);
    expect(isBelowPlayerLayer({ name: 'big_chess_table' })).toBe(false); // casas lógicas, não desenhadas
    expect(isBelowPlayerLayer(null)).toBe(false);
  });

  it('o crafting-world.tmj tem a camada bigchessboard (imagem) depois de "Above Player" — e ela é piso mesmo assim', () => {
    const tmjPath = resolve(__dirname, '../../../public/assets/CraftingWorld/map/crafting-world.tmj');
    const tmj = JSON.parse(readFileSync(tmjPath, 'utf8')) as { layers: Array<{ name: string; type: string; objects?: Array<{ gid?: number }> }> };
    const names = tmj.layers.map((l) => l.name);
    const board = tmj.layers.find((l) => isBelowPlayerLayer(l));
    expect(board?.name).toBe('bigchessboard');
    expect(board?.type).toBe('objectgroup');
    expect(board?.objects?.some((o) => typeof o.gid === 'number')).toBe(true);
    // Situação que causava o bug: a camada vem depois do grupo "Above Player" de topo.
    expect(names.indexOf('bigchessboard')).toBeGreaterThan(names.findIndex((n) => n.toLowerCase() === 'above player'));
  });

  it('a banda de Y-sort fica entre o piso (0) e as camadas acima do jogador (200)', () => {
    expect(craftDepthForY(0, 1000)).toBe(100);
    expect(craftDepthForY(1000, 1000)).toBe(189);
    expect(craftDepthForY(5000, 1000)).toBe(189);
  });
});
