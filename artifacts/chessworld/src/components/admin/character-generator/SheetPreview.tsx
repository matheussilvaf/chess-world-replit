import { useEffect, useRef } from 'react';
import { SHEET_WIDTH, SHEET_HEIGHT } from '../../../lib/character-generator/constants';
import type { LoadedLayer } from '../../../lib/character-generator/compositor';

/** The full 2208x384 combined spritesheet, 1:1 pixels, in a scrollable strip. */
export function SheetPreview({ layers }: { layers: LoadedLayer[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    ctx.imageSmoothingEnabled = false;
    for (const layer of layers) {
      ctx.drawImage(layer.canvas, 0, 0);
    }
  }, [layers]);

  return (
    <div className="overflow-auto rounded-lg border border-slate-700 bg-slate-900">
      <canvas
        ref={canvasRef}
        width={SHEET_WIDTH}
        height={SHEET_HEIGHT}
        style={{ imageRendering: 'pixelated' }}
        className="block"
      />
    </div>
  );
}
