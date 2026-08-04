/**
 * Character Generator — image loading + skin recolouring, with LRU caches.
 *
 * Recoloured sheets are 2208x384 RGBA canvases (~3.4MB each), so both caches
 * are capped: least-recently-used entries are evicted when full.
 */
import type { SkinTone } from './skinTones';

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly cap: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

const imageCache = new Lru<Promise<HTMLImageElement>>(90);
const recolorCache = new Lru<HTMLCanvasElement>(48);

/** Load (and cache) an image. Failed loads are evicted so a retry is possible. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => {
      imageCache.delete(url);
      reject(new Error(`Falha ao carregar imagem: ${url}`));
    };
    img.src = url;
  });

  imageCache.set(url, promise);
  return promise;
}

/**
 * Returns a drawable source for `url` with the given skin tone applied.
 * Tone "default" returns the raw image (no pixel pass at all).
 */
export async function getTonedLayer(url: string, tone: SkinTone): Promise<CanvasImageSource> {
  const img = await loadImage(url);
  if (!tone.pixelMap) return img;

  const key = `${tone.id}|${url}`;
  const cached = recolorCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D não suportado neste navegador.');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const map = tone.pixelMap;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // fully transparent
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const target = map.get(rgb);
    if (target) {
      data[i] = target[0];
      data[i + 1] = target[1];
      data[i + 2] = target[2];
    }
  }
  ctx.putImageData(imageData, 0, 0);

  recolorCache.set(key, canvas);
  return canvas;
}
