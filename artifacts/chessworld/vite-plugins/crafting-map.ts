import fs from 'fs';
import path from 'path';
import type { PluginOption } from 'vite';

/**
 * Serve/emite uma versão do crafting-world.tmj com os tilesets externos (.tsx)
 * EMBUTIDOS — o Phaser não resolve tilesets externos do Tiled.
 *
 * - Reaponta .tsx que referenciam a pasta Downloads da máquina do autor para as
 *   cópias de mesmo nome dentro de map/Tilesets/.
 * - Converte caminhos de imagem para URLs absolutas sob /assets/.
 * - Remove tilesets cujo .tsx não existe no repo (e os objetos que os usam),
 *   avisando no console para o arquivo poder ser adicionado depois.
 * - Dev: responde na rota virtual; Build: emite o arquivo em dist.
 */

const MAP_DIR = path.resolve(import.meta.dirname, '../public/assets/CraftingWorld/map');
const ASSETS_DIR = path.resolve(MAP_DIR, '../..'); // public/assets
const SOURCE_TMJ = path.resolve(MAP_DIR, 'crafting-world.tmj');
export const EMBEDDED_ROUTE = '/assets/CraftingWorld/map/crafting-world.embedded.tmj';

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Resolve o caminho real de um .tsx; cai para map/Tilesets/<basename> (cópias do repo). */
function resolveTsxPath(source: string): string | null {
  const direct = path.resolve(MAP_DIR, source);
  if (fs.existsSync(direct)) return direct;
  const fallback = path.resolve(MAP_DIR, 'Tilesets', path.basename(source));
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

/** URL absoluta (servida de public/) para uma imagem referenciada por um .tsx. */
function imageUrl(tsxPath: string, imageSource: string): string {
  const abs = path.resolve(path.dirname(tsxPath), imageSource);
  const rel = path.relative(ASSETS_DIR, abs).split(path.sep).join('/');
  return `/assets/${rel}`;
}

interface EmbeddedTile {
  id: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  animation?: { tileid: number; duration: number }[];
}

function parseTsx(tsxPath: string, firstgid: number) {
  const xml = fs.readFileSync(tsxPath, 'utf8');
  const tsTagMatch = xml.match(/<tileset[^>]*>/);
  if (!tsTagMatch) return null;
  const tsTag = tsTagMatch[0];

  const embedded: Record<string, unknown> = {
    firstgid,
    name: attr(tsTag, 'name') ?? path.basename(tsxPath, '.tsx'),
    tilewidth: Number(attr(tsTag, 'tilewidth') ?? 32),
    tileheight: Number(attr(tsTag, 'tileheight') ?? 32),
    tilecount: Number(attr(tsTag, 'tilecount') ?? 0),
    columns: Number(attr(tsTag, 'columns') ?? 0),
    margin: Number(attr(tsTag, 'margin') ?? 0),
    spacing: Number(attr(tsTag, 'spacing') ?? 0),
  };

  // Imagem no topo (tileset-spritesheet) = <image> antes do primeiro <tile>.
  const topImg = xml.match(/<image[^>]*>/);
  const firstTileIdx = xml.indexOf('<tile ');
  if (topImg && (firstTileIdx === -1 || xml.indexOf(topImg[0]) < firstTileIdx)) {
    embedded.image = imageUrl(tsxPath, attr(topImg[0], 'source') ?? '');
    embedded.imagewidth = Number(attr(topImg[0], 'width') ?? 0);
    embedded.imageheight = Number(attr(topImg[0], 'height') ?? 0);
  }

  // Blocos <tile>: animações e imagens por tile (image collections).
  const tiles: EmbeddedTile[] = [];
  const tileRe = /<tile id="(\d+)"[^>]*>([\s\S]*?)<\/tile>/g;
  let t: RegExpExecArray | null;
  while ((t = tileRe.exec(xml))) {
    const tile: EmbeddedTile = { id: Number(t[1]) };
    const body = t[2];
    const im = body.match(/<image[^>]*>/);
    if (im) {
      tile.image = imageUrl(tsxPath, attr(im[0], 'source') ?? '');
      tile.imagewidth = Number(attr(im[0], 'width') ?? 0);
      tile.imageheight = Number(attr(im[0], 'height') ?? 0);
    }
    const frames = [...body.matchAll(/<frame tileid="(\d+)" duration="(\d+)"/g)];
    if (frames.length) {
      tile.animation = frames.map((f) => ({ tileid: Number(f[1]), duration: Number(f[2]) }));
    }
    if (tile.image || tile.animation) tiles.push(tile);
  }
  if (tiles.length) embedded.tiles = tiles;
  return embedded;
}

/** Lê width/height do IHDR de um PNG (bytes 16-24). */
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    fs.closeSync(fd);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/** .tsx que não vieram no export do Tiled mas cuja imagem foi reposta no repo:
 *  sintetiza um tileset-collection de 1 tile para o objeto voltar ao mapa. */
const RESCUED_TSX: Record<string, string> = {
  'bigchessboard.tsx': 'CraftingWorld/images/bigchessboard.png',
};

function rescueTileset(source: string, firstgid: number) {
  const rel = RESCUED_TSX[path.basename(source)];
  if (!rel) return null;
  const size = pngSize(path.resolve(ASSETS_DIR, rel));
  if (!size) return null;
  return {
    firstgid,
    name: path.basename(source, '.tsx'),
    tilewidth: size.w,
    tileheight: size.h,
    tilecount: 1,
    columns: 0,
    margin: 0,
    spacing: 0,
    tiles: [{ id: 0, image: `/assets/${rel}`, imagewidth: size.w, imageheight: size.h }],
  };
}

function stripObjectsInGidRanges(layers: any[], ranges: [number, number][]) {
  const inRange = (gid: number) => {
    const g = gid & 0x0fffffff;
    return ranges.some(([a, b]) => g >= a && g < b);
  };
  for (const layer of layers) {
    if (layer.layers) stripObjectsInGidRanges(layer.layers, ranges);
    if (layer.type === 'objectgroup' && Array.isArray(layer.objects)) {
      layer.objects = layer.objects.filter((o: any) => !o.gid || !inRange(o.gid));
    }
  }
}

export function buildEmbeddedCraftingMap(): string {
  const tmj = JSON.parse(fs.readFileSync(SOURCE_TMJ, 'utf8'));
  const sorted = [...tmj.tilesets].sort((a: any, b: any) => a.firstgid - b.firstgid);
  const embedded: unknown[] = [];
  const droppedRanges: [number, number][] = [];
  // addTilesetImage do Phaser casa por NOME — cópias duplicadas do mesmo tileset
  // (ex.: refs para a pasta Downloads remapeadas para o repo) precisam de nomes únicos.
  const usedNames = new Set<string>();
  const uniqueName = (name: string) => {
    let n = name;
    let i = 2;
    while (usedNames.has(n)) n = `${name} #${i++}`;
    usedNames.add(n);
    return n;
  };

  for (let i = 0; i < sorted.length; i++) {
    const ts = sorted[i];
    const nextFirst = i + 1 < sorted.length ? sorted[i + 1].firstgid : Number.MAX_SAFE_INTEGER;
    if (!ts.source) {
      embedded.push(ts); // já embutido
      continue;
    }
    const tsxPath = resolveTsxPath(ts.source);
    const parsed = tsxPath ? parseTsx(tsxPath, ts.firstgid) : rescueTileset(ts.source, ts.firstgid);
    if (!parsed) {
      console.warn(`[crafting-map] tileset ausente, descartado: ${ts.source} (gids ${ts.firstgid}..${nextFirst - 1})`);
      droppedRanges.push([ts.firstgid, nextFirst]);
      continue;
    }
    parsed.name = uniqueName(String(parsed.name));
    embedded.push(parsed);
  }

  tmj.tilesets = embedded;
  if (droppedRanges.length) stripObjectsInGidRanges(tmj.layers, droppedRanges);
  return JSON.stringify(tmj);
}

export const craftingMapPlugin = (): PluginOption => ({
  name: 'crafting-world-map',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0];
      if (url !== EMBEDDED_ROUTE) return next();
      try {
        const body = buildEmbeddedCraftingMap();
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      } catch (e) {
        console.error('[crafting-map] falha ao embutir tilesets:', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'crafting map embed failed' }));
      }
    });
  },
  generateBundle() {
    try {
      this.emitFile({
        type: 'asset',
        fileName: EMBEDDED_ROUTE.replace(/^\//, ''),
        source: buildEmbeddedCraftingMap(),
      });
    } catch (e) {
      console.error('[crafting-map] falha ao emitir mapa embutido no build:', e);
    }
  },
});
