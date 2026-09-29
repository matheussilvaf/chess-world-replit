import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const bin = join(dirname(require.resolve('stockfish/package.json')), 'bin');
const target = new URL('../public/engine/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  await copyFile(join(bin, name), new URL(name, target));
}