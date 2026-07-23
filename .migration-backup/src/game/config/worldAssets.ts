export interface TilesetEntry {
  tiledName: string;
  textureKey: string;
  image: string;
  firstgid: number;
  isSingleImage: boolean;
}

export const WORLD_TILESETS: TilesetEntry[] = [
  { tiledName: 'plains-modified', textureKey: 'wv2-plains-modified', image: 'sprites/tilesets/plains-modified.png', firstgid: 1, isSingleImage: false },
  { tiledName: 'Modern_Outside_B_Sheet', textureKey: 'wv2-modern-outside-b', image: 'sprites/tilesets/Modern_Outside_B_Sheet.png', firstgid: 3578, isSingleImage: false },
  { tiledName: 'Modern_Outside_C_Sheet', textureKey: 'wv2-modern-outside-c', image: 'sprites/tilesets/Modern_Outside_C_Sheet.png', firstgid: 3834, isSingleImage: false },
  { tiledName: 'non-rm-a4-square', textureKey: 'wv2-non-rm-a4-square', image: 'sprites/tilesets/non-rm-a4-square.png', firstgid: 4090, isSingleImage: false },
  { tiledName: 'tournament-arena', textureKey: 'wv2-tournament-arena', image: 'sprites/tilesets/tournament-arena.png', firstgid: 7667, isSingleImage: false },
  { tiledName: 'arena2', textureKey: 'wv2-arena2', image: 'sprites/tilesets/arena2.png', firstgid: 8189, isSingleImage: false },
  { tiledName: 'trees', textureKey: 'wv2-trees', image: 'sprites/tilesets/trees.png', firstgid: 8765, isSingleImage: false },
  { tiledName: 'paths', textureKey: 'wv2-paths', image: 'sprites/tilesets/paths.png', firstgid: 9021, isSingleImage: false },
  { tiledName: '$fountain', textureKey: 'wv2-dollar-fountain', image: 'sprites/tilesets/$fountain.png', firstgid: 12598, isSingleImage: false },
  { tiledName: 'fountain', textureKey: 'wv2-fountain', image: 'sprites/tilesets/fountain.png', firstgid: 12706, isSingleImage: false },
  { tiledName: 'chesstable', textureKey: 'wv2-chesstable', image: 'sprites/tilesets/chesstable.png', firstgid: 12722, isSingleImage: false },
  { tiledName: 'chessboard2', textureKey: 'wv2-chessboard2', image: 'sprites/tilesets/chessboard2.png', firstgid: 12738, isSingleImage: false },
  { tiledName: 'chesstable3', textureKey: 'wv2-chesstable3', image: 'sprites/tilesets/chesstable3.png', firstgid: 12774, isSingleImage: false },
  { tiledName: 'fountain2', textureKey: 'wv2-fountain2', image: 'sprites/tilesets/fountain2.png', firstgid: 12838, isSingleImage: false },
  { tiledName: 'floors2', textureKey: 'wv2-floors2', image: 'sprites/tilesets/floors2.png', firstgid: 12982, isSingleImage: false },
  { tiledName: 'plantbox', textureKey: 'wv2-plantbox', image: 'sprites/tilesets/plantbox.png', firstgid: 16559, isSingleImage: false },
  { tiledName: 'Gothic_D', textureKey: 'wv2-gothic-d', image: 'sprites/tilesets/Gothic_D.png', firstgid: 16580, isSingleImage: false },
  { tiledName: 'trees2', textureKey: 'wv2-trees2', image: 'sprites/tilesets/trees2.png', firstgid: 16836, isSingleImage: false },
  { tiledName: 'parktree', textureKey: 'wv2-parktree', image: 'sprites/tilesets/parktree.png', firstgid: 17092, isSingleImage: false },
  { tiledName: 'exterior', textureKey: 'wv2-exterior', image: 'sprites/tilesets/exterior.png', firstgid: 17110, isSingleImage: false },
  { tiledName: 'tactics-academy', textureKey: 'wv2-tactics-academy', image: 'sprites/tilesets/tactics-academy.png', firstgid: 18079, isSingleImage: true },
  { tiledName: 'stairs1', textureKey: 'wv2-stairs1', image: 'sprites/tilesets/stairs1.png', firstgid: 18080, isSingleImage: false },
  { tiledName: 'weeklystats', textureKey: 'wv2-weeklystats', image: 'sprites/tilesets/weeklystats.png', firstgid: 18208, isSingleImage: false },
  { tiledName: 'stones', textureKey: 'wv2-stones', image: 'sprites/tilesets/stones.png', firstgid: 18288, isSingleImage: false },
  { tiledName: 'seats', textureKey: 'wv2-seats', image: 'sprites/tilesets/seats.png', firstgid: 18480, isSingleImage: false },
  { tiledName: 'portal', textureKey: 'wv2-portal', image: 'sprites/tilesets/portal.png', firstgid: 18736, isSingleImage: true },
  { tiledName: 'water', textureKey: 'wv2-water', image: 'sprites/tilesets/water.png', firstgid: 18737, isSingleImage: false },
  { tiledName: 'house1', textureKey: 'wv2-house1', image: 'sprites/tilesets/houses/house1.png', firstgid: 19169, isSingleImage: true },
  { tiledName: 'house2', textureKey: 'wv2-house2', image: 'sprites/tilesets/houses/house2.png', firstgid: 19170, isSingleImage: true },
  { tiledName: 'house3', textureKey: 'wv2-house3', image: 'sprites/tilesets/houses/house3.png', firstgid: 19171, isSingleImage: true },
  { tiledName: 'house4', textureKey: 'wv2-house4', image: 'sprites/tilesets/houses/house4.png', firstgid: 19172, isSingleImage: true },
  { tiledName: 'mansion1', textureKey: 'wv2-mansion1', image: 'sprites/tilesets/houses/mansion1.png', firstgid: 19173, isSingleImage: true },
  { tiledName: 'shop', textureKey: 'wv2-shop', image: 'sprites/tilesets/shop.png', firstgid: 19174, isSingleImage: true },
  { tiledName: 'analysis-school', textureKey: 'wv2-analysis-school', image: 'sprites/tilesets/analysis-school.png', firstgid: 19175, isSingleImage: true },
  { tiledName: 'mansion2', textureKey: 'wv2-mansion2', image: 'sprites/tilesets/houses/mansion2.png', firstgid: 19176, isSingleImage: true },
  { tiledName: 'mansion3', textureKey: 'wv2-mansion3', image: 'sprites/tilesets/houses/mansion3.png', firstgid: 19177, isSingleImage: true },
  { tiledName: 'mansion4', textureKey: 'wv2-mansion4', image: 'sprites/tilesets/houses/mansion4.png', firstgid: 19178, isSingleImage: true },
  { tiledName: 'mansion5', textureKey: 'wv2-mansion5', image: 'sprites/tilesets/houses/mansion5.png', firstgid: 19179, isSingleImage: true },
  { tiledName: 'mansion6', textureKey: 'wv2-mansion6', image: 'sprites/tilesets/houses/mansion6.png', firstgid: 19180, isSingleImage: true },
  { tiledName: 'mansion7', textureKey: 'wv2-mansion7', image: 'sprites/tilesets/houses/mansion7.png', firstgid: 19181, isSingleImage: true },
  { tiledName: 'mansion8', textureKey: 'wv2-mansion8', image: 'sprites/tilesets/houses/mansion8.png', firstgid: 19182, isSingleImage: true },
  { tiledName: 'house5', textureKey: 'wv2-house5', image: 'sprites/tilesets/houses/house5.png', firstgid: 19183, isSingleImage: true },
  { tiledName: 'house6', textureKey: 'wv2-house6', image: 'sprites/tilesets/houses/house6.png', firstgid: 19184, isSingleImage: true },
  { tiledName: 'house7', textureKey: 'wv2-house7', image: 'sprites/tilesets/houses/house7.png', firstgid: 19185, isSingleImage: true },
  { tiledName: 'house8', textureKey: 'wv2-house8', image: 'sprites/tilesets/houses/house8.png', firstgid: 19186, isSingleImage: true },
  { tiledName: 'village-portal', textureKey: 'wv2-village-portal', image: 'sprites/tilesets/houses/village-portal.png', firstgid: 19187, isSingleImage: false },
  { tiledName: 'chessboard', textureKey: 'wv2-chessboard', image: 'sprites/tilesets/chessboard.png', firstgid: 19223, isSingleImage: true },
  { tiledName: 'analysis-school-bottom', textureKey: 'wv2-analysis-school-bottom', image: 'sprites/tilesets/analysis-school-bottom.png', firstgid: 19224, isSingleImage: true },
  { tiledName: 'analysis-school-top', textureKey: 'wv2-analysis-school-top', image: 'sprites/tilesets/analysis-school-top.png', firstgid: 19225, isSingleImage: true },
  { tiledName: 'shop-bottom', textureKey: 'wv2-shop-bottom', image: 'sprites/tilesets/shop-bottom.png', firstgid: 19226, isSingleImage: true },
  { tiledName: 'shop-top', textureKey: 'wv2-shop-top', image: 'sprites/tilesets/shop-top.png', firstgid: 19227, isSingleImage: true },
  { tiledName: 'tactics-academy-bottom', textureKey: 'wv2-tactics-academy-bottom', image: 'sprites/tilesets/tactics-academy-bottom.png', firstgid: 19228, isSingleImage: true },
  { tiledName: 'tactics-academy-top', textureKey: 'wv2-tactics-academy-top', image: 'sprites/tilesets/tactics-academy-top.png', firstgid: 19230, isSingleImage: true },
  { tiledName: 'portal-top', textureKey: 'wv2-portal-top', image: 'sprites/tilesets/portal-top.png', firstgid: 19231, isSingleImage: true },
  { tiledName: 'potal-bottom', textureKey: 'wv2-portal-bottom', image: 'sprites/tilesets/portal-bottom.png', firstgid: 19233, isSingleImage: true },
];

/** Additional tilesets needed by sub-maps (not in the main world). Loaded on demand. */
export const EXTRA_TILESETS: TilesetEntry[] = [
  { tiledName: '!doors', textureKey: 'wv2-doors', image: 'sprites/tilesets/!doors.png', firstgid: 0, isSingleImage: false },
  { tiledName: '!doors2', textureKey: 'wv2-doors2', image: 'sprites/tilesets/!doors2.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'Gothic_A2', textureKey: 'wv2-gothic-a2', image: 'sprites/tilesets/Gothic_A2.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'Gothic_A4', textureKey: 'wv2-gothic-a4', image: 'sprites/tilesets/Gothic_A4.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'Gothic_B', textureKey: 'wv2-gothic-b', image: 'sprites/tilesets/Gothic_B.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'Gothic_C', textureKey: 'wv2-gothic-c', image: 'sprites/tilesets/Gothic_C.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'non-rm-a3', textureKey: 'wv2-non-rm-a3', image: 'sprites/tilesets/non-rm-a3.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'carpet-and-stuff', textureKey: 'wv2-carpet-and-stuff', image: 'sprites/tilesets/carpet-and-stuff.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'floors', textureKey: 'wv2-floors', image: 'sprites/tilesets/floors.png', firstgid: 0, isSingleImage: false },
  { tiledName: 'tournamentinsidedoor', textureKey: 'wv2-tournamentinsidedoor', image: 'sprites/tilesets/tournamentinsidedoor.png', firstgid: 0, isSingleImage: true },
  { tiledName: 'tournamentdoor2', textureKey: 'wv2-tournamentdoor2', image: 'sprites/tilesets/tournamentinsidedoor2.png', firstgid: 0, isSingleImage: true },
  { tiledName: 'tournamentopendoor', textureKey: 'wv2-tournamentopendoor', image: 'sprites/tilesets/tournamentopendoor.png', firstgid: 0, isSingleImage: true },
];

/** All tileset textures (main + extra) for preloading */
export const ALL_TILESETS: TilesetEntry[] = [...WORLD_TILESETS, ...EXTRA_TILESETS];

/** Lookup texture key by tileset name */
export function getTextureKeyForTileset(tiledName: string): string | null {
  const entry = ALL_TILESETS.find(t => t.tiledName === tiledName);
  return entry?.textureKey ?? null;
}

/** Resolve a GID to a tileset entry using the main world's firstgid mapping */
export function findTilesetForGid(rawGid: number): TilesetEntry | null {
  const gid = rawGid & 0x0FFFFFFF;
  let result: TilesetEntry | null = null;
  for (const ts of WORLD_TILESETS) {
    if (gid >= ts.firstgid) result = ts;
    else break;
  }
  return result;
}

/**
 * Resolve a GID to a tileset entry using a custom firstgid mapping (for sub-maps).
 * Takes the TMJ tileset array and resolves to our texture keys.
 */
export function findTilesetForGidInMap(rawGid: number, tmjTilesets: { firstgid: number; name: string }[]): TilesetEntry | null {
  const gid = rawGid & 0x0FFFFFFF;
  let matchedTmjTs: { firstgid: number; name: string } | null = null;
  for (const ts of tmjTilesets) {
    if (gid >= ts.firstgid) matchedTmjTs = ts;
    else break;
  }
  if (!matchedTmjTs) return null;
  const entry = ALL_TILESETS.find(t => t.tiledName === matchedTmjTs!.name);
  if (!entry) return null;
  return { ...entry, firstgid: matchedTmjTs.firstgid };
}
