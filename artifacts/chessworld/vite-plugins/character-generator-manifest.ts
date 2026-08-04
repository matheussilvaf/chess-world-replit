/**
 * Character GENERATOR asset manifest — scanner + Vite plugin.
 *
 * Scans `public/character-generator/assets/<category>/*.png` (Node.js only)
 * and groups files into families + variants:
 *   - `backhair1.png`      → family "backhair1", variant "default"
 *   - `backhair1_c2.png`   → family "backhair1", variant "c2"
 *
 * How the browser gets it:
 *   - dev:   middleware serves a FRESH scan at `<base>api/character-generator/manifest`
 *            (and also intercepts the static manifest.json URL below)
 *   - build: `buildStart` writes `public/character-generator/manifest.json`, so the
 *            static production build ships it — no game-server changes needed.
 * The client tries the API URL first and falls back to the static JSON.
 */
import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const API_SUFFIX = '/api/character-generator/manifest';
const STATIC_MANIFEST_REL = 'character-generator/manifest.json';
const ASSETS_DIR_SEGMENTS = ['character-generator', 'assets'];

/** Expected spritesheet geometry — files that differ produce a warning. */
const SHEET = { width: 2208, height: 384, rows: 4, cols: 23 };
const FRAME = { width: 96, height: 96 };

const VARIANT_RE = /^(.*)_c(\d+)\.png$/i;
const PNG_RE = /\.png$/i;

// NOTE: kept in sync with src/lib/character-generator/types.ts (client copy).
export interface GenVariant {
  id: string; // "default" | "c1" | "c2" | ...
  file: string;
  /** URL relative to the app base path (client prepends import.meta.env.BASE_URL). */
  url: string;
}

export interface GenFamily {
  id: string;
  default: GenVariant;
  variants: GenVariant[]; // default first, then c1, c2, ... (numeric order)
}

export interface GenManifest {
  generatedAt: string;
  sheet: { width: number; height: number; rows: number; cols: number };
  frame: { width: number; height: number };
  categories: Record<string, GenFamily[]>;
  warnings: string[];
}

function pngSize(file: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    const read = fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (read < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null; // PNG signature
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function assetUrl(category: string, file: string): string {
  return [
    ...ASSETS_DIR_SEGMENTS,
    encodeURIComponent(category),
    encodeURIComponent(file),
  ].join('/');
}

export function scanGeneratorAssets(publicDir: string): GenManifest {
  const root = path.join(publicDir, ...ASSETS_DIR_SEGMENTS);
  const manifest: GenManifest = {
    generatedAt: new Date().toISOString(),
    sheet: { ...SHEET },
    frame: { ...FRAME },
    categories: {},
    warnings: [],
  };

  let categoryDirs: fs.Dirent[] = [];
  try {
    categoryDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    manifest.warnings.push(`Assets folder not found: ${root}`);
    return manifest;
  }

  for (const dir of categoryDirs) {
    if (!dir.isDirectory()) continue;
    const category = dir.name;
    const catDir = path.join(root, category);

    let files: string[] = [];
    try {
      files = fs.readdirSync(catDir);
    } catch {
      manifest.warnings.push(`Cannot read category folder: ${category}`);
      manifest.categories[category] = [];
      continue;
    }

    // Group PNGs by family base name.
    const families = new Map<string, { def: GenVariant | null; variants: { n: number; v: GenVariant }[] }>();

    for (const file of files) {
      if (!PNG_RE.test(file)) continue;

      const size = pngSize(path.join(catDir, file));
      if (!size) {
        manifest.warnings.push(`Invalid PNG (unreadable header): ${category}/${file}`);
        continue;
      }
      if (size.width !== SHEET.width || size.height !== SHEET.height) {
        manifest.warnings.push(
          `Unexpected size ${size.width}x${size.height} (expected ${SHEET.width}x${SHEET.height}): ${category}/${file}`,
        );
      }

      const variantMatch = file.match(VARIANT_RE);
      const baseName = variantMatch ? variantMatch[1] : file.replace(PNG_RE, '');
      const entry = families.get(baseName) ?? { def: null, variants: [] };

      if (variantMatch) {
        const n = parseInt(variantMatch[2], 10);
        entry.variants.push({ n, v: { id: `c${n}`, file, url: assetUrl(category, file) } });
      } else {
        entry.def = { id: 'default', file, url: assetUrl(category, file) };
      }
      families.set(baseName, entry);
    }

    const list: GenFamily[] = [];
    for (const [id, entry] of families) {
      entry.variants.sort((a, b) => a.n - b.n);
      let def = entry.def;
      if (!def) {
        // Family only has _cN files — promote the lowest variant to default
        // so the item is still usable, but flag it.
        const first = entry.variants.shift();
        if (!first) continue;
        def = first.v;
        manifest.warnings.push(`Family "${category}/${id}" has no base file — using ${def.file} as default`);
      }
      list.push({ id, default: def, variants: [def, ...entry.variants.map((x) => x.v)] });
    }

    list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
    manifest.categories[category] = list;
  }

  return manifest;
}

export function characterGeneratorManifestPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'chessworld-character-generator-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server: ViteDevServer) {
      // Registered before Vite's static middleware: always serves a fresh scan,
      // so dropping new PNGs into the folder only requires a page refresh.
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const isApi = url.endsWith(API_SUFFIX);
        const isStatic = url.endsWith('/' + STATIC_MANIFEST_REL);
        if (!isApi && !isStatic) return next();
        const manifest = scanGeneratorAssets(publicDir);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(manifest));
      });
    },
    buildStart() {
      if (!publicDir) return;
      const manifest = scanGeneratorAssets(publicDir);
      const out = path.join(publicDir, STATIC_MANIFEST_REL);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
    },
  };
}
