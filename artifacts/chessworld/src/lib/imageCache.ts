/**
 * Cache de imagens decodificadas por URL, compartilhado pelas miniaturas
 * (folhas de sprite do gerador, recortes de frame do catálogo).
 *
 * Além da promessa de carga, guarda a imagem JÁ carregada para acesso
 * SÍNCRONO: uma miniatura que troca de URL (item mudou de slot) consegue
 * redesenhar no mesmo frame do commit, sem piscar em branco — essencial para
 * as animações de troca do inventário, que começam logo após o commit.
 */
const pending = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();

/** Imagem pronta para desenhar, ou null se ainda não carregou (dispare `loadImage`). */
export function getCachedImage(url: string): HTMLImageElement | null {
  return loaded.get(url) ?? null;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const ready = loaded.get(url);
  if (ready) return Promise.resolve(ready);
  let p = pending.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        loaded.set(url, img);
        pending.delete(url);
        resolve(img);
      };
      img.onerror = () => {
        pending.delete(url); // permite nova tentativa depois
        reject(new Error(`Falha ao carregar ${url}`));
      };
      img.src = url;
    });
    pending.set(url, p);
  }
  return p;
}
