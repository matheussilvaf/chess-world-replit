/**
 * SpriteThumb — recorta UM frame (stand, virado para o sul) de um spritesheet
 * do gerador (2208×384, frames 96×96) para servir de miniatura em listas.
 */
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SHEET_HEIGHT,
  SHEET_WIDTH,
} from '../../../lib/character-generator/constants';

/** Coluna 1 = frame "stand" (ver ANIMATIONS em constants.ts); linha 0 = sul. */
const STAND_COL = 1;
const SOUTH_ROW = 0;

export function SpriteThumb({ url, size = 56 }: { url: string; size?: number }) {
  const scale = size / FRAME_WIDTH;
  return (
    <div
      className="relative overflow-hidden rounded-md bg-slate-800/60 border border-slate-700/50 shrink-0"
      style={{ width: size, height: size }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute select-none pointer-events-none"
        style={{
          left: -STAND_COL * FRAME_WIDTH * scale,
          top: -SOUTH_ROW * FRAME_HEIGHT * scale,
          width: SHEET_WIDTH * scale,
          height: SHEET_HEIGHT * scale,
          maxWidth: 'none',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}
