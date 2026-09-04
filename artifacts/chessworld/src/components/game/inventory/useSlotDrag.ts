/**
 * Arrastar-e-soltar por pointer events entre células de inventário (funciona
 * com mouse e toque — o HTML5 drag nativo não existe no toque).
 *
 * - pointerdown numa célula com item inicia o rastreio; após mover alguns px
 *   vira arrasto: o componente renderiza um ghost e o registra em `ghostRef`;
 *   o hook move o ghost DIRETO no DOM a cada pointermove (sem re-render por
 *   frame — a grade só re-renderiza quando a célula sob o ponteiro muda).
 * - soltar sobre outra célula (`data-slot-index`) → `onMove(from, to, ponto)`.
 * - sair da caixa do container por mais que `outMargin` px → `onDragOut`
 *   (o inventário usa isso para fechar e entrar no modo de soltar no chão).
 *
 * Um clique (sem movimento) NÃO é consumido: o `onClick` da célula segue
 * funcionando; depois de um arrasto o clique fantasma é ignorado via
 * `consumeClick()`.
 *
 * A célula de origem captura o ponteiro (`setPointerCapture`): soltar fora da
 * janela do navegador ainda entrega o `pointerup`, e se a captura se perder
 * (`lostpointercapture`, ex.: alerta do sistema) o arrasto é cancelado em vez de
 * ficar "preso" engolindo o próximo clique.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export interface SlotDragState {
  from: number;
  itemKey: string;
  /** Já passou do limiar de movimento (está arrastando de fato). */
  active: boolean;
  /** Célula sob o ponteiro (alvo de soltura) ou null. */
  over: number | null;
}

export interface DragPoint {
  x: number;
  y: number;
}

interface Options {
  containerRef: RefObject<HTMLElement | null>;
  onMove: (from: number, to: number, at: DragPoint) => void;
  onDragOut?: (from: number, itemKey: string) => void;
  /** Distância (px) além da borda do container que dispara `onDragOut`. */
  outMargin?: number;
  canDropAt?: (index: number) => boolean;
}

const THRESHOLD_PX = 6;
/** Classe no <html> enquanto se arrasta (cursor "segurando" em toda a página). */
const DRAGGING_CLASS = 'slot-dragging';

export function slotIndexAt(clientX: number, clientY: number): number | null {
  const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-slot-index]');
  if (!el) return null;
  const index = Number(el.dataset.slotIndex);
  return Number.isInteger(index) ? index : null;
}

function positionGhost(el: HTMLElement, point: DragPoint): void {
  el.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
}

export function useSlotDrag({ containerRef, onMove, onDragOut, outMargin = 28, canDropAt }: Options) {
  const [drag, setDrag] = useState<SlotDragState | null>(null);
  const dragRef = useRef<SlotDragState | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number; target: HTMLElement | null } | null>(null);
  const pointerRef = useRef<DragPoint>({ x: 0, y: 0 });
  const ghostElRef = useRef<HTMLElement | null>(null);
  const draggedRef = useRef(false);
  const callbacksRef = useRef({ onMove, onDragOut, canDropAt });
  callbacksRef.current = { onMove, onDragOut, canDropAt };

  const update = useCallback((next: SlotDragState | null) => {
    const previous = dragRef.current;
    dragRef.current = next;
    // Só re-renderiza quando algo visível mudou (origem, alvo ou ativação).
    if (
      previous?.from !== next?.from ||
      previous?.itemKey !== next?.itemKey ||
      previous?.active !== next?.active ||
      previous?.over !== next?.over
    ) {
      setDrag(next);
    }
  }, []);

  const finish = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    if (start?.target) {
      try {
        if (start.target.hasPointerCapture(start.pointerId)) start.target.releasePointerCapture(start.pointerId);
      } catch {
        // ponteiro já liberado/inválido: nada a fazer
      }
    }
    document.documentElement.classList.remove(DRAGGING_CLASS);
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
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (ghostElRef.current) positionGhost(ghostElRef.current, pointerRef.current);
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
      if (!current.active) document.documentElement.classList.add(DRAGGING_CLASS);
      const over = slotIndexAt(event.clientX, event.clientY);
      const droppable = over !== null && over !== current.from && (callbacksRef.current.canDropAt?.(over) ?? true);
      update({ ...current, active: true, over: droppable ? over : null });
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = startRef.current;
      const current = dragRef.current;
      if (!start || !current || event.pointerId !== start.pointerId) return;
      if (current.active) {
        const over = slotIndexAt(event.clientX, event.clientY);
        if (over !== null && over !== current.from && (callbacksRef.current.canDropAt?.(over) ?? true)) {
          callbacksRef.current.onMove(current.from, over, { x: event.clientX, y: event.clientY });
        }
      }
      finish();
    };
    const onCancel = () => finish();
    // Captura perdida (fora do pointerup normal): o arrasto não pode continuar.
    const onLostCapture = (event: PointerEvent) => {
      if (startRef.current && startRef.current.pointerId === event.pointerId) finish();
    };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onLostCapture);
    window.addEventListener('blur', onCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onLostCapture);
      window.removeEventListener('blur', onCancel);
      document.documentElement.classList.remove(DRAGGING_CLASS);
    };
  }, [containerRef, finish, outMargin, update]);

  const handlePointerDown = useCallback((index: number, itemKey: string, event: ReactPointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    draggedRef.current = false;
    const target = event.currentTarget as HTMLElement;
    let captured: HTMLElement | null = null;
    try {
      target.setPointerCapture(event.pointerId);
      captured = target;
    } catch {
      // sem captura (ponteiro já inativo): segue só com os listeners globais
    }
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, target: captured };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    update({ from: index, itemKey, active: false, over: null });
  }, [update]);

  /** true se o último gesto foi um arrasto — o clique que o encerra deve ser ignorado. */
  const consumeClick = useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  /** Ref de callback para o elemento do ghost: posicionado na montagem e a cada movimento. */
  const ghostRef = useCallback((el: HTMLElement | null) => {
    ghostElRef.current = el;
    if (el) positionGhost(el, pointerRef.current);
  }, []);

  return { drag, handlePointerDown, consumeClick, ghostRef };
}
