/**
 * Miniatura universal do manual de receitas — desenha qualquer CraftThumb:
 *   - sheet96: UM frame de folha 96×96 do gerador (coluna configurável —
 *     arcos usam a pose de tiro porque o frame parado é vazio);
 *   - frame: frame 0 (topo-esquerda) de sheets de recurso com dimensões
 *     variadas (minerais 128², árvores 357×270, animais, pedra de mão 32²);
 *   - image: imagem única (ícone de drop ou upload de craft item);
 *   - none: caixinha tracejada (item ainda sem imagem).
 */
import { useEffect, useRef } from 'react';
import { SpriteFrameThumb } from '../../game/SpriteFrameThumb';
import type { CraftThumb } from '../../../lib/craft/craftCatalog';

function FrameCrop({
  url,
  frameWidth,
  frameHeight,
  size,
}: {
  url: string;
  frameWidth: number;
  frameHeight: number;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled || !ref.current) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      const scale = Math.min(size / frameWidth, size / frameHeight);
      const w = frameWidth * scale;
      const h = frameHeight * scale;
      ctx.drawImage(img, 0, 0, frameWidth, frameHeight, (size - w) / 2, (size - h) / 2, w, h);
    };
    img.onerror = () => {
      /* thumb vazia é aceitável */
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, frameWidth, frameHeight, size]);

  return (
    <canvas ref={ref} width={size} height={size} style={{ imageRendering: 'pixelated' }} />
  );
}

export function CatalogThumb({ thumb, size = 44 }: { thumb: CraftThumb; size?: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-md bg-slate-800/60 border border-slate-700/50 shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {thumb.kind === 'sheet96' && (
        <SpriteFrameThumb url={thumb.url} col={thumb.col} size={size} />
      )}
      {thumb.kind === 'frame' && (
        <FrameCrop
          url={thumb.url}
          frameWidth={thumb.frameWidth}
          frameHeight={thumb.frameHeight}
          size={size}
        />
      )}
      {thumb.kind === 'image' && (
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          className="w-full h-full object-contain select-none pointer-events-none"
          style={{ imageRendering: 'pixelated' }}
        />
      )}
      {thumb.kind === 'none' && (
        <div className="w-2/3 h-2/3 rounded border border-dashed border-slate-600/70" />
      )}
    </div>
  );
}
