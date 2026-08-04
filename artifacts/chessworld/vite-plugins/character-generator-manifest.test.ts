/**
 * Scanner tests (spec §33) — name-independent: every family here is synthetic,
 * created in a temp dir with minimal fake PNG headers (24 bytes is enough for
 * the scanner's signature + IHDR width/height check).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanGeneratorAssets } from './character-generator-manifest';

const SHEET_W = 2208;
const SHEET_H = 384;

function fakePng(width = SHEET_W, height = SHEET_H): Buffer {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0); // PNG signature
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

let tmp: string;
let weaponDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-scan-'));
  weaponDir = path.join(tmp, 'character-generator', 'assets', 'weapon');
  fs.mkdirSync(weaponDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scanGeneratorAssets', () => {
  it('groups base + _cN files into one family with numerically ordered variants', () => {
    fs.writeFileSync(path.join(weaponDir, 'fam1.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'fam1_c3.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'fam1_c2.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'fam1_c10.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    const fams = m.categories.weapon;
    expect(fams).toHaveLength(1);
    expect(fams[0].id).toBe('fam1');
    expect(fams[0].default.id).toBe('default');
    expect(fams[0].variants.map((v) => v.id)).toEqual(['default', 'c2', 'c3', 'c10']);
    expect(m.warnings).toEqual([]);
  });

  it('applies the greedy _cN rule: a_c2_c3.png belongs to family "a_c2"', () => {
    fs.writeFileSync(path.join(weaponDir, 'a_c2.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'a_c2_c3.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    const fams = m.categories.weapon;
    expect(fams.map((f) => f.id)).toEqual(['a', 'a_c2']);
    // "a_c2.png" is itself a variant of family "a"…
    expect(fams[0].variants.map((v) => v.file)).toEqual(['a_c2.png']);
    // …and simultaneously the (promoted) base of family "a_c2".
    expect(fams[1].variants.map((v) => v.file)).toEqual(['a_c2_c3.png']);
  });

  it('promotes the lowest variant when a family has no base file (with warning)', () => {
    fs.writeFileSync(path.join(weaponDir, 'fam2_c5.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'fam2_c2.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    const fams = m.categories.weapon;
    expect(fams).toHaveLength(1);
    expect(fams[0].id).toBe('fam2');
    expect(fams[0].default.file).toBe('fam2_c2.png');
    expect(fams[0].variants.map((v) => v.file)).toEqual(['fam2_c2.png', 'fam2_c5.png']);
    expect(m.warnings.some((w) => w.includes('no base file'))).toBe(true);
  });

  it('ignores non-PNG files', () => {
    fs.writeFileSync(path.join(weaponDir, 'notes.txt'), 'not a png');
    fs.writeFileSync(path.join(weaponDir, 'fam3.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['fam3']);
  });

  it('skips PNGs with unreadable headers and records a warning', () => {
    fs.writeFileSync(path.join(weaponDir, 'broken.png'), Buffer.from('definitely-not-a-png'));
    fs.writeFileSync(path.join(weaponDir, 'fam4.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['fam4']);
    expect(m.warnings.some((w) => w.includes('Invalid PNG') && w.includes('broken.png'))).toBe(true);
  });

  it('keeps files with unexpected sheet size but warns about them', () => {
    fs.writeFileSync(path.join(weaponDir, 'fam5.png'), fakePng(100, 100));
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['fam5']);
    expect(m.warnings.some((w) => w.includes('Unexpected size 100x100'))).toBe(true);
  });

  it('sorts families with numeric awareness (fam2 before fam10)', () => {
    fs.writeFileSync(path.join(weaponDir, 'fam10.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'fam2.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['fam2', 'fam10']);
  });

  it('scans every category directory independently', () => {
    const hairDir = path.join(tmp, 'character-generator', 'assets', 'hair');
    fs.mkdirSync(hairDir, { recursive: true });
    fs.writeFileSync(path.join(hairDir, 'h1.png'), fakePng());
    fs.writeFileSync(path.join(weaponDir, 'w1.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(Object.keys(m.categories).sort()).toEqual(['hair', 'weapon']);
    expect(m.categories.hair.map((f) => f.id)).toEqual(['h1']);
  });

  it('reports a missing assets root as a warning with empty categories', () => {
    const m = scanGeneratorAssets(path.join(tmp, 'does-not-exist'));
    expect(m.categories).toEqual({});
    expect(m.warnings).toHaveLength(1);
  });
});
