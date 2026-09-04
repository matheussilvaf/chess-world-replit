/**
 * Barra fina de durabilidade na base de um slot (inventário, hotbar e ghost).
 * Verde → âmbar → vermelho conforme a ferramenta gasta; a largura anima para
 * a barra "descer" suavemente a cada golpe.
 */
import type { ToolDurabilityView } from '../../../lib/inventory/toolDurability';

const FILL: Record<ToolDurabilityView['tone'], string> = {
  good: 'bg-emerald-400',
  worn: 'bg-amber-400',
  critical: 'bg-red-500',
};

export function durabilityLabel(view: ToolDurabilityView): string {
  return `Durabilidade ${view.remaining}/${view.max}`;
}

export function DurabilityBar({ view, className = '' }: { view: ToolDurabilityView; className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="Durabilidade"
      aria-valuemin={0}
      aria-valuemax={view.max}
      aria-valuenow={view.remaining}
      data-testid="durability-bar"
      data-tone={view.tone}
      className={`pointer-events-none absolute inset-x-1 bottom-1 h-[3px] overflow-hidden rounded-full bg-black/75 shadow-[0_0_0_1px_rgba(0,0,0,.5)] ${className}`}
    >
      <span
        className={`block h-full rounded-full transition-[width,background-color] duration-200 ease-out ${FILL[view.tone]} ${view.tone === 'critical' ? 'animate-pulse' : ''}`}
        style={{ width: `${Math.max(0, Math.min(100, view.ratio * 100))}%` }}
      />
    </span>
  );
}
