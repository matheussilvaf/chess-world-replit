import { useEffect, useRef } from 'react';
import {
  ANIM_FRAME_MS,
  getAnimation,
  getDirection,
  type AnimationId,
  type DirectionId,
} from '../../../lib/character-generator/constants';
import { drawCompositeFrame, type LoadedLayer } from '../../../lib/character-generator/compositor';

interface AnimatedPreviewProps {
  layers: LoadedLayer[];
  animId: AnimationId;
  dirId: DirectionId;
  /** Canvas size in px (square, one 96x96 frame scaled up). */
  size?: number;
}

/** Center stage: the composed character playing the selected animation. */
export function AnimatedPreview({ layers, animId, dirId, size = 384 }: AnimatedPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const anim = getAnimation(animId);
    const row = getDirection(dirId).row;
    let frame = 0;
    drawCompositeFrame(ctx, layers, row, anim.frames[0], size);
    if (anim.frames.length <= 1) return; // static pose — nothing to animate

    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      if (now - last >= ANIM_FRAME_MS) {
        frame = (frame + 1) % anim.frames.length;
        last = now;
        drawCompositeFrame(ctx, layers, row, anim.frames[frame], size);
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [layers, animId, dirId, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      className="max-w-full rounded-lg border border-slate-700 bg-slate-900"
    />
  );
}
