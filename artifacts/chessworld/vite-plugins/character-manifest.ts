/**
 * Character manifest scanner + Vite plugin.
 *
 * Scans `public/assets/characters` (backend Node.js — never the browser) and
 * produces a manifest of every valid character folder and its movement
 * spritesheets. The browser always fetches `assets/characters/manifest.json`:
 *  - dev:   a middleware intercepts that URL and serves a FRESH scan
 *  - build: `buildStart` writes the real file into public/ so the static
 *           production build ships it.
 *
 * Folder contract (case/spacing tolerant):  `character 01 - 4-directions`
 * The `action/` folder is completely ignored (legacy sitting sprites).
 */
import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const FOLDER_RE = /^character\s*0*(\d+)\s*-\s*([48])\s*[-\s]+directions$/i;
const IGNORED_FOLDERS = new Set(['action']);
const MANIFEST_REL = 'assets/characters/manifest.json';

export interface ManifestAsset {
  fileName: string;
  /** URL relative to the app base path, e.g. `assets/characters/.../Walk.png` */
  publicUrl: string;
  width: number;
  height: number;
}

export interface ManifestCharacter {
  id: string;
  displayName: string;
  folderName: string;
  directions: 4 | 8;
  movements: Record<string, ManifestAsset[]>;
  warnings: string[];
}

export interface CharacterManifestFile {
  generatedAt: string;
  characters: ManifestCharacter[];
  /** Fatal problems — duplicate IDs block the admin editor. */
  errors: { code: string; message: string; characterId?: string; paths?: string[] }[];
  /** Non-fatal problems — invalid folder names, empty movement folders. */
  warnings: string[];
}

function pngSize(file: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    const read = fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (read < 24) return null;
    // PNG signature + IHDR
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function encodeSegments(...segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join('/');
}

export function scanCharacters(publicDir: string): CharacterManifestFile {
  const root = path.join(publicDir, 'assets', 'characters');
  const manifest: CharacterManifestFile = {
    generatedAt: new Date().toISOString(),
    characters: [],
    errors: [],
    warnings: [],
  };

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    manifest.errors.push({ code: 'missing_root', message: `Characters folder not found: ${root}` });
    return manifest;
  }

  const byId = new Map<string, ManifestCharacter[]>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    if (IGNORED_FOLDERS.has(folderName.trim().toLowerCase())) continue;

    const m = folderName.trim().match(FOLDER_RE);
    if (!m) {
      manifest.warnings.push(
        `Invalid character folder name (expected "character NN - 4|8-directions"): "${folderName}"`,
      );
      continue;
    }

    const num = parseInt(m[1], 10);
    const directions = parseInt(m[2], 10) as 4 | 8;
    const id = `character${String(num).padStart(2, '0')}`;
    const displayName = `Character ${String(num).padStart(2, '0')}`;

    const character: ManifestCharacter = {
      id,
      displayName,
      folderName,
      directions,
      movements: {},
      warnings: [],
    };

    const charDir = path.join(root, folderName);
    let movementDirs: fs.Dirent[] = [];
    try {
      movementDirs = fs.readdirSync(charDir, { withFileTypes: true });
    } catch {
      character.warnings.push(`Cannot read folder: ${folderName}`);
    }

    for (const mv of movementDirs) {
      if (!mv.isDirectory()) continue;
      const movement = mv.name;
      const mvDir = path.join(charDir, movement);
      const assets: ManifestAsset[] = [];
      let files: string[] = [];
      try {
        files = fs.readdirSync(mvDir);
      } catch {
        character.warnings.push(`Cannot read movement folder: ${movement}`);
      }
      for (const f of files.sort()) {
        if (!f.toLowerCase().endsWith('.png')) continue;
        const size = pngSize(path.join(mvDir, f));
        if (!size) {
          character.warnings.push(`Invalid PNG (unreadable header): ${movement}/${f}`);
          continue;
        }
        assets.push({
          fileName: f,
          publicUrl: `assets/characters/${encodeSegments(folderName, movement, f)}`,
          width: size.width,
          height: size.height,
        });
      }
      if (assets.length === 0) {
        character.warnings.push(`Movement folder "${movement}" has no PNG files`);
      }
      character.movements[movement] = assets;
    }

    if (Object.keys(character.movements).length === 0) {
      character.warnings.push('Character has no movement folders');
    }

    const list = byId.get(id) ?? [];
    list.push(character);
    byId.set(id, list);
  }

  for (const [id, list] of byId) {
    if (list.length > 1) {
      manifest.errors.push({
        code: 'duplicate_id',
        characterId: id,
        message: `Duplicate character ID detected: ${id}`,
        paths: list.map((c) => `public/assets/characters/${c.folderName}`),
      });
      // Do NOT silently pick one — exclude all conflicting folders.
      continue;
    }
    manifest.characters.push(list[0]);
  }

  manifest.characters.sort((a, b) => a.id.localeCompare(b.id));
  return manifest;
}

export function characterManifestPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'chessworld-character-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server: ViteDevServer) {
      // Registered before Vite's static middleware: always serves a fresh scan.
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.endsWith('/' + MANIFEST_REL)) return next();
        const manifest = scanCharacters(publicDir);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(manifest));
      });
    },
    buildStart() {
      if (!publicDir) return;
      const manifest = scanCharacters(publicDir);
      const out = path.join(publicDir, MANIFEST_REL);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
    },
  };
}
