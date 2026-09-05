/**
 * O jogo força `overflow: hidden` em html/body/#root (index.css) para o canvas
 * não rolar. Páginas comuns (admin, bancadas) chamam este hook para liberar o
 * scroll do documento enquanto estão montadas — e devolvem o estado anterior
 * ao desmontar.
 */
import { useEffect } from 'react';

export function useDocumentScrollUnlock(): void {
  useEffect(() => {
    const elements = [document.documentElement, document.body, document.getElementById('root')].filter(
      (el): el is HTMLElement => el !== null,
    );
    const previous = elements.map((el) => el.style.overflow);
    for (const el of elements) el.style.overflow = 'auto';
    return () => {
      elements.forEach((el, i) => {
        el.style.overflow = previous[i];
      });
    };
  }, []);
}
