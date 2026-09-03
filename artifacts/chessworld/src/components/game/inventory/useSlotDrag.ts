/**
 * Arrastar-e-soltar por pointer events entre células de inventário (funciona
 * com mouse e toque — o HTML5 drag nativo não existe no toque).
 *
 * - pointerdown numa célula com item inicia o rastreio; após mover alguns px
 *   vira arrasto (ghost desenhado pelo componente com `drag.x/y`).
 * - soltar sobre outra célula (`data-slot-index`) → `onMove(from, to)`.
 * - sair da caixa do container por mais que `outMargin` px → `onDragOut`
 *   (o inventário usa isso para fechar e entrar no modo de soltar no chão).
 *
 * Um clique (sem movimento) NÃO é consumido: o `onClick` da célula segue
 * funcionando; depois de um arrasto o clique fantasma é ignorado via
 * `consumeClick()`.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export interface SlotDragState {
  from: number;
  itemKey: string;
  /** Posição atual do ponteiro (clientX/Y). */
  x: number;
  y: number;
  /** Já passou do limiar de movimento (está arrastando de fato). */
  active: boolean;
  /** Célula sob o ponteiro (alvo de soltura) ou null. */
  over: number | null;
}

interface Options {
  containerRef: RefObject<HTMLElement | null>;
  onMove: (from: number, to: number) => void;
  onDragOut?: (from: number, itemKey: string) => void;
  /** Distância (px) além da borda do container que dispara `onDragOut`. */
  outMargin?: number;
  canDropAt?: (index: number) => boolean;
}

const THRESHOLD_PX = 6;

export function slotIndexAt(clientX: number, clientY: number): number | null {
  const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-slot-index]');
  if (!el) return null;
  const index = Number(el.dataset.slotIndex);
  return Number.isInteger(index) ? index : null;
}

export function useSlotDrag({ containerRef, onMove, onDragOut, outMargin = 28, canDropAt }: Options) {
  const [drag, setDrag] = useState<SlotDragState | null>(null);
  const dragRef = useRef<SlotDragState | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const draggedRef = useRef(false);
  const callbacksRef = useRef({ onMove, onDragOut, canDropAt });
  callbacksRef.current = { onMove, onDragOut, canDropAt };

  const update = useCallback((next: SlotDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const finish = useCallback(() => {
    startRef.current = null;
    update(null);
  }, [update]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const start = startRef.current;
      const current = dragRef.current;
      if (!start || !current || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const active = current.active || Math.hypot(dx, dy) > THRESHOLD_PX;
      if (!active) return;
      if (event.cancelable) event.preventDefault();
      draggedRef.current = true;
      const container = containerRef.current;
      if (container && callbacksRef.current.onDragOut) {
        const rect = container.getBoundingClientRect();
        const outside =
          event.clientX < rect.left - outMargin || event.clientX > rect.right + outMargin ||
          event.clientY < rect.top - outMargin || event.clientY > rect.bottom + outMargin;
        if (outside) {
          const { from, itemKey } = current;
          finish();
          callbacksRef.current.onDragOut(from, itemKey);
          return;
        }
      }
      const over = slotIndexAt(event.clientX, event.clientY);
      const droppable = over !== null && over !== current.from && (callbacksRef.current.canDropAt?.(over) ?? true);
      update({ ...current, active: true, x: event.clientX, y: event.clientY, over: droppable ? over : null });
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = startRef.current;
      const current = dragRef.current;
      if (!start || !current || event.pointerId !== start.pointerId) return;
      if (current.active) {
        const over = slotIndexAt(event.clientX, event.clientY);
        if (over !== null && over !== current.from && (callbacksRef.current.canDropAt?.(over) ?? true)) {
          callbacksRef.current.onMove(current.from, over);
        }
      }
      finish();
    };
    const onCancel = () => finish();
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
    };
  }, [containerRef, finish, outMargin, update]);

  const handlePointerDown = useCallback((index: number, itemKey: string, event: ReactPointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    draggedRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    update({ from: index, itemKey, x: event.clientX, y: event.clientY, active: false, over: null });
  }, [update]);

  /** true se o último gesto foi um arrasto — o clique que o encerra deve ser ignorado. */
  const consumeClick = useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return { drag, handlePointerDown, consumeClick };
}
