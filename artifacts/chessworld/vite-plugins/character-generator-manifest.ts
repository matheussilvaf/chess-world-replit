/**
 * Character GENERATOR asset manifest — scanner + Vite plugin.
 *
 * Scans `public/character-generator/assets/<category>/*.png` (Node.js only)
 * and groups files into families + variants:
 *   - `backhair1.png`      → family "backhair1", variant "default"
 *   - `backhair1_c2.png`   → family "backhair1", variant "c2"
 *
 * Categories may contain ONE level of subfolders (e.g. `weapons/sword/`).
 * Files inside a subfolder additionally support MATERIAL variants:
 *   - `sword_wood.png`     → family "sword", variant "wood" (group "sword")
 *   - `arrow_gold.png`     → family "arrow", variant "gold" (group "bowandarrow")
 * Material families have no base file by design: the first material in
 * MATERIAL_VARIANT_ORDER (wood) becomes the default, without a warning.
 * The subfolder name is recorded as `family.group` — families that share a
 * group belong together (e.g. "bowandarrow" + "arrow" = bow + projectile).
 *
 * Folder aliases: the on-disk folder `weapons/` is published as the canonical
 * category `weapon` (all refs, layers and configs use the singular id).
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

/** On-disk folder name → canonical category id in the manifest. */
const CATEGORY_ALIASES: Record<string, string> = { weapons: 'weapon' };

/** Expected spritesheet geometry — files that differ produce a warning. */
const SHEET = { width: 2208, height: 384, rows: 4, cols: 23 };
const FRAME = { width: 96, height: 96 };

const VARIANT_RE = /^(.*)_c(\d+)\.png$/i;
const PNG_RE = /\.png$/i;
const MATERIAL_RE = /^(.+)_([a-z0-9]+)\.png$/i;

/**
 * Canonical material progression — variant ids and their display order.
 * NOTE: kept in sync with WEAPON_MATERIAL_IDS in src/shared/combat/WeaponShapes.ts.
 */
export const MATERIAL_VARIANT_ORDER = [
  'wood',
  'stone',
  'copper',
  'iron',
  'gold',
  'diamond',
  'lunar',
  'cristalreal',
] as const;

const MATERIAL_INDEX = new Map<string, number>(MATERIAL_VARIANT_ORDER.map((m, i) => [m, i]));

// NOTE: kept in sync with src/lib/character-generator/types.ts (client copy).
export interface GenVariant {
  id: string; // "default" | "c1" | "c2" | ... | "wood" | "stone" | ...
  file: string;
  /** URL relative to the app base path (client prepends import.meta.env.BASE_URL). */
  url: string;
}

export interface GenFamily {
  id: string;
  default: GenVariant;
  variants: GenVariant[]; // default first, then materials (canonical order), then c1, c2, ...
  /** Subfolder the family came from (families sharing a group belong together). */
  group?: string;
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

/** URL from real path segments under the assets root (folder names, not aliases). */
function assetUrl(segments: string[]): string {
  return [...ASSETS_DIR_SEGMENTS, ...segments.map((s) => encodeURIComponent(s))].join('/');
}

interface FamilyAccumulator {
  def: GenVariant | null;
  /** sortKey: materials first in canonical order, then _cN numerically. */
  variants: { sortKey: number; v: GenVariant }[];
  group?: string;
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
    const folder = dir.name;
    const category = CATEGORY_ALIASES[folder] ?? folder;
    const catDir = path.join(root, folder);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(catDir, { withFileTypes: true });
    } catch {
      manifest.warnings.push(`Cannot read category folder: ${folder}`);
      manifest.categories[category] ??= [];
      continue;
    }

    // Group PNGs by family base name.
    const families = new Map<string, FamilyAccumulator>();

    const addFile = (file: string, absPath: string, urlSegments: string[], group: string | null) => {
      if (!PNG_RE.test(file)) return;
      const label = group ? `${folder}/${group}/${file}` : `${folder}/${file}`;

      const size = pngSize(absPath);
      if (!size) {
        manifest.warnings.push(`Invalid PNG (unreadable header): ${label}`);
        return;
      }
      if (size.width !== SHEET.width || size.height !== SHEET.height) {
        manifest.warnings.push(
          `Unexpected size ${size.width}x${size.height} (expected ${SHEET.width}x${SHEET.height}): ${label}`,
        );
      }

      const url = assetUrl([...urlSegments, file]);
      let baseName: string;
      let variant: { sortKey: number; v: GenVariant } | null = null;

      const cnMatch = file.match(VARIANT_RE);
      const matMatch = group ? file.match(MATERIAL_RE) : null;
      const matIdx = matMatch ? MATERIAL_INDEX.get(matMatch[2].toLowerCase()) : undefined;

      if (cnMatch) {
        baseName = cnMatch[1];
        const n = parseInt(cnMatch[2], 10);
        variant = { sortKey: 1000 + n, v: { id: `c${n}`, file, url } };
      } else if (matMatch && matIdx !== undefined) {
        // Material variants only exist inside subfolders — flat categories
        // (crafttools etc.) keep the historical _cN-only rule untouched.
        baseName = matMatch[1];
        variant = { sortKey: matIdx, v: { id: matMatch[2].toLowerCase(), file, url } };
      } else {
        baseName = file.replace(PNG_RE, '');
      }

      const entry = families.get(baseName) ?? { def: null, variants: [] };
      if (variant) entry.variants.push(variant);
      else entry.def = { id: 'default', file, url };
      if (group && entry.group === undefined) entry.group = group;
      families.set(baseName, entry);
    };

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // One level of subfolders (e.g. weapons/sword/).
        let subFiles: string[] = [];
        try {
          subFiles = fs.readdirSync(path.join(catDir, entry.name));
        } catch {
          manifest.warnings.push(`Cannot read subfolder: ${folder}/${entry.name}`);
          continue;
        }
        for (const file of subFiles) {
          addFile(file, path.join(catDir, entry.name, file), [folder, entry.name], entry.name);
        }
        continue;
      }
      addFile(entry.name, path.join(catDir, entry.name), [folder], null);
    }

    const list: GenFamily[] = [];
    for (const [id, entry] of families) {
      entry.variants.sort((a, b) => a.sortKey - b.sortKey);
      let def = entry.def;
      if (!def) {
        // Family only has suffixed files — promote the first variant so the
        // item is still usable. Material families (subfolders) have no base
        // file BY DESIGN, so only the flat _cN case is flagged.
        const first = entry.variants.shift();
        if (!first) continue;
        def = first.v;
        if (first.sortKey >= 1000) {
          manifest.warnings.push(`Family "${category}/${id}" has no base file — using ${def.file} as default`);
        }
      }
      const fam: GenFamily = { id, default: def, variants: [def, ...entry.variants.map((x) => x.v)] };
      if (entry.group !== undefined) fam.group = entry.group;
      list.push(fam);
    }

    list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));

    const existing = manifest.categories[category];
    if (existing) {
      // Alias folder + plain folder can both feed one category (e.g. weapon +
      // weapons). Keep the first family on id collision and warn.
      for (const fam of list) {
        if (existing.some((f) => f.id === fam.id)) {
          manifest.warnings.push(`Duplicate family "${category}/${fam.id}" (folder ${folder}) — keeping the first one`);
          continue;
        }
        existing.push(fam);
      }
      existing.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
    } else {
      manifest.categories[category] = list;
    }
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
