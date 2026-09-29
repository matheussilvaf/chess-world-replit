/** Embedded metadata for external Tiled TSX files used by the academy. */
interface ExternalTileset {
  image: string;
  tilewidth: number;
  tileheight: number;
  imagewidth: number;
  imageheight: number;
  columns: number;
  tilecount: number;
  margin: number;
  spacing: number;
}

const sheet = (name: string, columns: number, tilecount: number, imagewidth: number, imageheight: number): ExternalTileset => ({
  image: `sprites/tilesets/${name}.png`, tilewidth: 32, tileheight: 32,
  imagewidth, imageheight, columns, tilecount, margin: 0, spacing: 0,
});
const single = (image: string, size: number): ExternalTileset => ({
  image: `sprites/tilesets/${image}.png`, tilewidth: size, tileheight: size,
  imagewidth: size, imageheight: size, columns: 1, tilecount: 1, margin: 0, spacing: 0,
});

export const EXTERNAL_TILESETS: Record<string, ExternalTileset> = {
  'Gothic_C': sheet('Gothic_C', 16, 256, 512, 512),
  'paths': sheet('paths', 49, 3577, 1568, 2336),
  'non-rm-a3': sheet('non-rm-a3', 49, 1225, 1568, 800),
  'carpet-and-stuff': sheet('carpet-and-stuff', 8, 1064, 256, 4256),
  'floors': sheet('floors', 32, 2048, 1024, 2048),
  'chessboard': single('chessboard', 256),
  'puzzle_icon': single('puzzle-icon', 67),
  'puzzle_icon_2': single('puzzle_icon_2', 67),
};

/** Mutate cached TMJ once, before Phaser parses the tileset definitions. */
export function embedExternalTilesets(tmjData: any): void {
  if (tmjData.__externalTilesetsEmbedded) return;
  for (const ts of tmjData.tilesets || []) {
    if (!ts.source) continue;
    const name = ts.source.split('/').pop()?.replace(/\.(tsx|tsj|json)$/i, '') || '';
    const definition = EXTERNAL_TILESETS[name];
    if (!definition) {
      console.warn('[WorldScene] Tileset externo desconhecido:', ts.source);
      continue;
    }
    Object.assign(ts, { ...definition, name });
    delete ts.source;
  }
  tmjData.__externalTilesetsEmbedded = true;
}