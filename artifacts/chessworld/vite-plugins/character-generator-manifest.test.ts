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

  // ---- subpastas + materiais (armas finais: weapons/<família>/<família>_<material>.png) ----

  it('groups material variants in subfolders into one family (group = subfolder, no warning)', () => {
    const swordDir = path.join(tmp, 'character-generator', 'assets', 'weapons', 'sword');
    fs.mkdirSync(swordDir, { recursive: true });
    fs.writeFileSync(path.join(swordDir, 'sword_iron.png'), fakePng());
    fs.writeFileSync(path.join(swordDir, 'sword_wood.png'), fakePng());
    fs.writeFileSync(path.join(swordDir, 'sword_stone.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    const sword = m.categories.weapon.find((f) => f.id === 'sword');
    expect(sword).toBeDefined();
    expect(sword!.group).toBe('sword');
    // wood é o primeiro material canônico → vira default SEM warning (by design)
    expect(sword!.default.id).toBe('wood');
    expect(sword!.variants.map((v) => v.id)).toEqual(['wood', 'stone', 'iron']);
    // URL preserva o caminho FÍSICO (pasta plural "weapons")
    expect(sword!.default.url).toBe('character-generator/assets/weapons/sword/sword_wood.png');
    expect(m.warnings).toEqual([]);
  });

  it('publishes the physical "weapons" folder as the canonical "weapon" category', () => {
    const wandDir = path.join(tmp, 'character-generator', 'assets', 'weapons', 'wand');
    fs.mkdirSync(wandDir, { recursive: true });
    fs.writeFileSync(path.join(wandDir, 'wand_wood.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.weapons).toBeUndefined();
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['wand']);
  });

  it('keeps bow and arrow as separate families sharing the subfolder group', () => {
    const bowDir = path.join(tmp, 'character-generator', 'assets', 'weapons', 'bowandarrow');
    fs.mkdirSync(bowDir, { recursive: true });
    fs.writeFileSync(path.join(bowDir, 'bowandarrow_wood.png'), fakePng());
    fs.writeFileSync(path.join(bowDir, 'arrow_wood.png'), fakePng());
    fs.writeFileSync(path.join(bowDir, 'arrow_gold.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    const fams = m.categories.weapon;
    expect(fams.map((f) => f.id)).toEqual(['arrow', 'bowandarrow']);
    expect(fams[0].group).toBe('bowandarrow');
    expect(fams[1].group).toBe('bowandarrow');
    expect(fams[0].variants.map((v) => v.id)).toEqual(['wood', 'gold']);
  });

  it('applies material suffixes to FLAT files in weapon-like categories (weapon/crafttools)', () => {
    fs.writeFileSync(path.join(weaponDir, 'club_wood.png'), fakePng());
    const toolsDir = path.join(tmp, 'character-generator', 'assets', 'crafttools');
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(toolsDir, 'axe_stone.png'), fakePng());
    fs.writeFileSync(path.join(toolsDir, 'axe_iron.png'), fakePng());
    fs.writeFileSync(path.join(toolsDir, 'machete_iron.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    // weapon plano: club_wood.png agrupa na família "club" (variação wood).
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['club']);
    expect(m.categories.weapon[0].default.id).toBe('wood');
    expect(m.categories.weapon[0].group).toBeUndefined();
    // crafttools plano: variações por material na ordem canônica.
    const tools = m.categories.crafttools;
    expect(tools.map((f) => f.id)).toEqual(['axe', 'machete']);
    expect(tools[0].variants.map((v) => v.id)).toEqual(['stone', 'iron']);
    expect(tools[0].default.id).toBe('stone');
    // Família sem arquivo-base (machete só tem iron): promove SEM warning.
    expect(tools[1].default.id).toBe('iron');
    expect(m.warnings).toEqual([]);
  });

  it('keeps the historical _cN-only rule for flat files in NON weapon-like categories', () => {
    const hairDir = path.join(tmp, 'character-generator', 'assets', 'hair');
    fs.mkdirSync(hairDir, { recursive: true });
    fs.writeFileSync(path.join(hairDir, 'bob_wood.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.hair.map((f) => f.id)).toEqual(['bob_wood']);
    expect(m.categories.hair[0].default.id).toBe('default');
  });

  it('keeps _cN precedence inside subfolders and treats unknown materials as own families', () => {
    const swordDir = path.join(tmp, 'character-generator', 'assets', 'weapons', 'sword');
    fs.mkdirSync(swordDir, { recursive: true });
    fs.writeFileSync(path.join(swordDir, 'sword_wood.png'), fakePng());
    fs.writeFileSync(path.join(swordDir, 'sword_c2.png'), fakePng());
    fs.writeFileSync(path.join(swordDir, 'sword_adamantium.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    const fams = m.categories.weapon;
    expect(fams.map((f) => f.id)).toEqual(['sword', 'sword_adamantium']);
    // _cN continua variante da família base; material fora do conjunto vira família própria
    expect(fams[0].variants.map((v) => v.id)).toEqual(['wood', 'c2']);
    expect(fams[1].default.id).toBe('default');
    expect(fams[1].group).toBe('sword');
  });

  it('merges the alias folder and the plain folder into one category', () => {
    fs.writeFileSync(path.join(weaponDir, 'flatfam.png'), fakePng());
    const spearDir = path.join(tmp, 'character-generator', 'assets', 'weapons', 'spear');
    fs.mkdirSync(spearDir, { recursive: true });
    fs.writeFileSync(path.join(spearDir, 'spear_wood.png'), fakePng());
    const m = scanGeneratorAssets(tmp);
    expect(m.categories.weapon.map((f) => f.id)).toEqual(['flatfam', 'spear']);
    expect(m.warnings).toEqual([]);
  });
});
