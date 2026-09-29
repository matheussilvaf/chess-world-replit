import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenRect } from '../chess/TableBoardOverlay';

/**
 * "Mesa" das bancadas: um quadrado centralizado cujo retângulo de tela é medido
 * e passado ao tabuleiro HTML como `rectOverride` (sem Phaser).
 */
export function BenchTableFrame({ children }: { children: (rect: ScreenRect | null) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<ScreenRect | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, []);
  return <>
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
      <div ref={ref} data-testid="bench-table" className="aspect-square w-[min(72vmin,560px)] rounded-2xl border-4 border-amber-900/60 bg-amber-950/40" />
    </div>
    {children(rect)}
  </>;
}
