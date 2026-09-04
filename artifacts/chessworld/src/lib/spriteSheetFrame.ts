/**
 * Escolha do frame VISÍVEL de uma folha 96×96 do gerador.
 *
 * Algumas folhas não têm a pose parada desenhada — as picaretas, por exemplo,
 * só existem nos frames do golpe (colunas 10–14) — e a miniatura pedida na
 * coluna padrão sairia em branco (item "invisível" no inventário/hotbar). Se
 * o frame pedido não tem nenhum pixel opaco, usa-se o primeiro frame com
 * pixels da mesma linha. A leitura de pixels acontece UMA vez por
 * folha+linha+coluna (cache), num canvas de rascunho compartilhado.
 */
import { FRAME_HEIGHT, FRAME_WIDTH } from './character-generator/constants';

const resolved = new Map<string, number>();
let scratch: CanvasRenderingContext2D | null | undefined;

function scratchCtx(): CanvasRenderingContext2D | null {
  if (scratch === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    scratch = canvas.getContext('2d', { willReadFrequently: true });
  }
  return scratch;
}

function frameHasPixels(ctx: CanvasRenderingContext2D, img: HTMLImageElement, col: number, row: number): boolean {
  ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  ctx.drawImage(img, col * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const data = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
  return false;
}

/** Coluna a desenhar para (col,row): a própria se tiver pixels, senão a primeira visível da linha. */
export function visibleFrameCol(img: HTMLImageElement, url: string, col: number, row: number): number {
  const key = `${url}#${row}#${col}`;
  const hit = resolved.get(key);
  if (hit !== undefined) return hit;
  let result = col;
  try {
    const ctx = scratchCtx();
    if (ctx && !frameHasPixels(ctx, img, col, row)) {
      const cols = Math.floor(img.naturalWidth / FRAME_WIDTH);
      for (let c = 0; c < cols; c++) {
        if (c !== col && frameHasPixels(ctx, img, c, row)) {
          result = c;
          break;
        }
      }
    }
  } catch {
    // canvas contaminado (imagem de outra origem) ou sem 2d: fica o frame pedido
  }
  resolved.set(key, result);
  return result;
}
