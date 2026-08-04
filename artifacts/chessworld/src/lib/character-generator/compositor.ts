/**
 * Character Generator — composition engine.
 *
 * Loads the selected layer sheets (with skin tone applied), then:
 *  - draws single animation frames (animated preview);
 *  - overlays the full sheets into one final 2208x384 spritesheet
 *    (equivalent to combining frame by frame, since every sheet shares the
 *    exact same grid).
 */
import {
  FRAME_WIDTH,
  FRAME_HEIGHT,
  SHEET_WIDTH,
  SHEET_HEIGHT,
  SHEET_ROWS,
  getLayerOrderForRow,
} from './constants';
import { getTonedLayer } from './recolor';
import type { SkinTone } from './skinTones';

export interface LayerSpec {
  category: string;
  /** Absolute (base-prefixed) asset URL. */
  url: string;
}

export interface LoadedLayer extends LayerSpec {
  canvas: CanvasImageSource;
}

export interface LoadLayersResult {
  layers: LoadedLayer[];
  /** URLs that failed to load — surfaced in the UI, never fatal. */
  failed: string[];
}

/** Load all layer sheets in draw order, applying the skin tone. */
export async function loadLayerCanvases(specs: LayerSpec[], tone: SkinTone): Promise<LoadLayersResult> {
  const settled = await Promise.all(
    specs.map(async (spec) => {
      try {
        const canvas = await getTonedLayer(spec.url, tone);
        return { ok: true as const, layer: { ...spec, canvas } };
      } catch {
        return { ok: false as const, url: spec.url };
      }
    }),
  );

  const layers: LoadedLayer[] = [];
  const failed: string[] = [];
  for (const s of settled) {
    if (s.ok) layers.push(s.layer);
    else failed.push(s.url);
  }
  return { layers, failed };
}

/**
 * Sort layers by the draw order of a given row (north renders the weapon
 * below the head). Unknown categories keep their relative order at the end.
 */
function orderLayersForRow(layers: LoadedLayer[], row: number): LoadedLayer[] {
  const order = getLayerOrderForRow(row);
  const rank = new Map<string, number>();
  order.forEach((c, i) => rank.set(c, i));
  return [...layers].sort(
    (a, b) => (rank.get(a.category) ?? order.length) - (rank.get(b.category) ?? order.length),
  );
}

/** Draw one composite frame (row = direction, col = animation column). */
export function drawCompositeFrame(
  ctx: CanvasRenderingContext2D,
  layers: LoadedLayer[],
  row: number,
  col: number,
  destSize: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, destSize, destSize);
  for (const layer of orderLayersForRow(layers, row)) {
    ctx.drawImage(
      layer.canvas,
      col * FRAME_WIDTH,
      row * FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      0,
      0,
      destSize,
      destSize,
    );
  }
}

/** Compose the final full spritesheet (transparent background). */
export function composeSheet(layers: LoadedLayer[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D não suportado neste navegador.');
  ctx.imageSmoothingEnabled = false;
  // Compose row by row: each direction can have its own layer order
  // (north draws the weapon below the head).
  for (let row = 0; row < SHEET_ROWS; row++) {
    const y = row * FRAME_HEIGHT;
    for (const layer of orderLayersForRow(layers, row)) {
      ctx.drawImage(layer.canvas, 0, y, SHEET_WIDTH, FRAME_HEIGHT, 0, y, SHEET_WIDTH, FRAME_HEIGHT);
    }
  }
  return canvas;
}
