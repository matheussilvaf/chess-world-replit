import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import {
  ANIMAL_SHEET_COLUMNS,
  ANIMAL_SHEET_ROWS,
  HUNTING_ASSET_ROOT,
  HUNTING_CATEGORIES,
  HUNTING_MANIFEST_PATH,
  rigIdForAnimal,
  type HuntingCategory,
  type HuntingManifest,
  type HuntingManifestAnimal,
} from '../src/shared/hunting/HuntingShapes';

function pngSize(file: string): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(24);
    if (fs.readSync(fd, header, 0, 24, 0) < 24 || header.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const directories = (folder: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
};

function baseAssetUrl(base: string, variantId: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${HUNTING_ASSET_ROOT}/${variantId.split('/').map(encodeURIComponent).join('/')}.png`;
}

export function scanHuntingManifest(publicDir: string, base = '/'): HuntingManifest {
  const root = path.join(publicDir, ...HUNTING_ASSET_ROOT.split('/'));
  const animals: HuntingManifestAnimal[] = [];
  for (const category of HUNTING_CATEGORIES) {
    const categoryDir = path.join(root, category);
    for (const animalEntry of directories(categoryDir)) {
      if (!animalEntry.isDirectory()) continue;
      const animal = animalEntry.name;
      const variants = directories(path.join(categoryDir, animal))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((entry) => {
          const size = pngSize(path.join(categoryDir, animal, entry.name));
          if (!size) return [];
          const file = entry.name.slice(0, -4);
          const variantId = `${category}/${animal}/${file}`;
          return [{
            variantId,
            file: entry.name,
            url: baseAssetUrl(base, variantId),
            width: size.width,
            height: size.height,
            frameWidth: size.width / ANIMAL_SHEET_COLUMNS,
            frameHeight: size.height / ANIMAL_SHEET_ROWS,
          }];
        });
      if (variants.length) {
        animals.push({
          animalKey: `${category}/${animal}`,
          category: category as HuntingCategory,
          animal,
          rigId: rigIdForAnimal(category, animal),
          variants,
        });
      }
    }
  }
  animals.sort((a, b) => a.animal.localeCompare(b.animal) || a.category.localeCompare(b.category));
  return { generatedAt: new Date().toISOString(), animals };
}

export function huntingManifestPlugin(): Plugin {
  let config: ResolvedConfig;
  const manifest = () => scanHuntingManifest(config.publicDir, config.base);
  return {
    name: 'chessworld-hunting-manifest',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.endsWith(`/${HUNTING_MANIFEST_PATH}`)) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(manifest()));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: HUNTING_MANIFEST_PATH,
        source: JSON.stringify(manifest(), null, 2),
      });
    },
  };
}