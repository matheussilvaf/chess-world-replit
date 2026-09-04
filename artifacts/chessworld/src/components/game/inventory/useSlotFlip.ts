/**
 * Animação FLIP das trocas de slot (inventário e hotbar).
 *
 * Os itens continuam sendo renderizados pelo React dentro das células; este
 * hook só anima a DIFERENÇA entre onde cada item estava (medido no sinal
 * `onBeforeSlotsChange`, antes do DOM mudar) e onde ficou (medido no layout
 * effect, depois do commit). Elementos marcados com `data-flip-key={itemKey}`
 * são os que se movem (a miniatura dentro da célula).
 *
 * - Item arrastado: parte de onde o ponteiro o soltou (`setDropOrigin`), do
 *   tamanho do ghost, até a célula de destino.
 * - Item deslocado: desliza da célula de destino para a de origem.
 * - Item que só apareceu nesta superfície (ex.: entrou no acesso rápido, que
 *   a hotbar espelha): "pop" curto.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { onBeforeSlotsChange } from '../../../lib/inventory/slotChangeSignal';

export interface DropOrigin {
  itemKey: string;
  /** clientX/Y onde o ghost foi solto. */
  x: number;
  y: number;
  /** Escala visual do ghost (a animação começa desse tamanho). */
  scale?: number;
}

const MOVE_MS = 260;
const MOVE_EASING = 'cubic-bezier(.22, 1, .36, 1)';
const POP_MS = 200;

function measure(container: HTMLElement | null): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  if (!container) return rects;
  for (const el of container.querySelectorAll<HTMLElement>('[data-flip-key]')) {
    const key = el.dataset.flipKey;
    if (key) rects.set(key, el.getBoundingClientRect());
  }
  return rects;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Eleva o elemento acima das células vizinhas enquanto a animação roda. */
function runOnTop(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
  if (typeof el.animate !== 'function') return;
  const previousZ = el.style.zIndex;
  const previousPos = el.style.position;
  el.style.position = 'relative';
  el.style.zIndex = '30';
  const animation = el.animate(keyframes, options);
  const restore = () => {
    el.style.zIndex = previousZ;
    el.style.position = previousPos;
  };
  animation.onfinish = restore;
  animation.oncancel = restore;
}

export function useSlotFlip(containerRef: RefObject<HTMLElement | null>, slots: ReadonlyArray<string | null>) {
  const firstRef = useRef<Map<string, DOMRect> | null>(null);
  const originRef = useRef<DropOrigin | null>(null);

  useEffect(
    () =>
      onBeforeSlotsChange(() => {
        firstRef.current = measure(containerRef.current);
      }),
    [containerRef],
  );

  useLayoutEffect(() => {
    const first = firstRef.current;
    const origin = originRef.current;
    firstRef.current = null;
    originRef.current = null;
    const container = containerRef.current;
    if (!container || (!first && !origin) || prefersReducedMotion()) return;
    for (const el of container.querySelectorAll<HTMLElement>('[data-flip-key]')) {
      const key = el.dataset.flipKey;
      if (!key) continue;
      const last = el.getBoundingClientRect();
      if (last.width === 0 || last.height === 0) continue;
      let fromX: number;
      let fromY: number;
      let fromScale = 1;
      if (origin && origin.itemKey === key) {
        fromX = origin.x;
        fromY = origin.y;
        fromScale = origin.scale ?? 1;
      } else {
        const before = first?.get(key);
        if (!before) {
          // Apareceu nesta superfície (espelho do acesso rápido): pop curto.
          runOnTop(el, [{ transform: 'scale(.55)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
            duration: POP_MS,
            easing: 'ease-out',
          });
          continue;
        }
        fromX = before.left + before.width / 2;
        fromY = before.top + before.height / 2;
      }
      const dx = fromX - (last.left + last.width / 2);
      const dy = fromY - (last.top + last.height / 2);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && fromScale === 1) continue;
      runOnTop(
        el,
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${fromScale})` },
          { transform: 'translate(0px, 0px) scale(1)' },
        ],
        { duration: MOVE_MS, easing: MOVE_EASING },
      );
    }
  }, [slots, containerRef]);

  /** Chame antes de `moveSlot` no drop: o item arrastado anima a partir do ponteiro. */
  const setDropOrigin = useCallback((origin: DropOrigin) => {
    originRef.current = origin;
  }, []);

  return { setDropOrigin };
}
