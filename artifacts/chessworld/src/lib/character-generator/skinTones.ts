/**
 * Character Generator — skin tone palettes.
 *
 * Recolouring swaps ONLY these 4 exact base colours; every other pixel is
 * untouched, so it is safe to apply the swap to every layer.
 */

const BASE_COLORS = ['f4d29c', 'dba463', '73172d', 'bb7547'] as const;

export interface SkinTone {
  id: string;
  label: string;
  /** null → keep original colours (no recolouring pass). */
  pixelMap: Map<number, [number, number, number]> | null;
  /** Representative colour for the UI swatch. */
  swatch: string;
}

function hexToInt(hex: string): number {
  return parseInt(hex, 16);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hexToInt(hex);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function tone(id: string, label: string, targets: [string, string, string, string] | null): SkinTone {
  let pixelMap: SkinTone['pixelMap'] = null;
  if (targets) {
    pixelMap = new Map();
    BASE_COLORS.forEach((from, i) => pixelMap!.set(hexToInt(from), hexToRgb(targets[i])));
  }
  return { id, label, pixelMap, swatch: `#${targets ? targets[0] : BASE_COLORS[0]}` };
}

export const SKIN_TONES: SkinTone[] = [
  tone('default', 'Padrão', null),
  tone('green', 'Green', ['afe356', '6cb328', '184e3a', '3d8a3e']),
  tone('red', 'Red', ['e96564', 'c74934', '4e2218', '8f2416']),
  tone('tone1', 'Tone 1', ['d49149', 'b4723c', '561f2d', '9d5534']),
  tone('tone2', 'Tone 2', ['b97e50', '955123', '481c0e', '774128']),
  tone('tone3', 'Tone 3', ['986743', '7b4c2d', '36150c', '583322']),
  tone('bone', 'Bone', ['e6e1e1', 'b6acaa', '51393f', '89786c']),
];

export function getSkinTone(id: string): SkinTone {
  return SKIN_TONES.find((t) => t.id === id) ?? SKIN_TONES[0];
}
