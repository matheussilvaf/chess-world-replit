/**
 * Miniatura de UM frame de uma folha de sprites do gerador (96×96 por frame).
 * Usada nos chips de peças (criação) e no slot de arma (equipamento).
 * Imagens vêm do cache compartilhado (lib/imageCache): quando a folha já está
 * carregada o frame é desenhado de forma SÍNCRONA no commit — uma célula do
 * inventário que troca de item não pisca em branco. Folhas sem a pose pedida
 * (picaretas só têm frames de golpe) caem no primeiro frame visível da linha.
 */
import { useLayoutEffect, useRef } from 'react';
import { FRAME_HEIGHT, FRAME_WIDTH } from '../../lib/character-generator/constants';
import { getCachedImage, loadImage } from '../../lib/imageCache';
import { visibleFrameCol } from '../../lib/spriteSheetFrame';

interface SpriteFrameThumbProps {
  /** URL da folha (23 colunas × 4 linhas de frames de 96px). */
  url: string;
  /** Coluna do frame (padrão 1 = pose parada). */
  col?: number;
  /** Linha do frame (padrão 0 = olhando para baixo/sul). */
  row?: number;
  /** Lado do canvas em px. */
  size?: number;
  className?: string;
}

export function SpriteFrameThumb({ url, col = 1, row = 0, size = 48, className }: SpriteFrameThumbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = (img: HTMLImageElement) => {
      const drawCol = visibleFrameCol(img, url, col, row);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, drawCol * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT, 0, 0, size, size);
    };
    const cached = getCachedImage(url);
    if (cached) {
      draw(cached);
      return;
    }
    ctx.clearRect(0, 0, size, size);
    loadImage(url)
      .then((img) => {
        if (!cancelled && ref.current) draw(img);
      })
      .catch(() => {
        /* thumb vazia é aceitável; o erro real aparece no preview grande */
      });
    return () => {
      cancelled = true;
    };
  }, [url, col, row, size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      className={className}
    />
  );
}
