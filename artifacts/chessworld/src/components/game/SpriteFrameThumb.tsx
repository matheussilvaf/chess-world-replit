/**
 * Miniatura de UM frame de uma folha de sprites do gerador (96×96 por frame).
 * Usada nos chips de peças (criação) e no slot de arma (equipamento).
 * Imagens são cacheadas por URL no módulo (uma carga por folha).
 */
import { useEffect, useRef } from 'react';
import { FRAME_HEIGHT, FRAME_WIDTH } from '../../lib/character-generator/constants';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadSheetImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        imageCache.delete(url); // permite retry depois
        reject(new Error(`Falha ao carregar ${url}`));
      };
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

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

  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, size, size);
    loadSheetImage(url)
      .then((img) => {
        if (cancelled || !ref.current) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, col * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT, 0, 0, size, size);
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
