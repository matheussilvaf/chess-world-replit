/**
 * Ícone que acompanha o ponteiro durante um arrasto (não captura eventos).
 *
 * O wrapper externo é posicionado DIRETO no DOM pelo useSlotDrag (`ghostRef`
 * → translate3d a cada pointermove, sem re-render); o interno centraliza no
 * ponteiro e faz a animação de "levantar". Fica acima de tudo (a janela do
 * inventário é z-500) — por isso o z-[1000].
 */
import type { Ref } from 'react';
import type { CraftCatalog } from '../../../lib/craft/craftCatalog';
import type { ToolDurabilityView } from '../../../lib/inventory/toolDurability';
import { InventoryItemThumb } from '../InventoryItemVisual';
import { DurabilityBar } from './DurabilityBar';

/** Escala visual do ghost — a animação de soltar começa deste tamanho. */
export const GHOST_SCALE = 1.1;

export function SlotDragGhost({
  ghostRef,
  itemKey,
  catalog,
  qty,
  durability,
  size = 48,
}: {
  ghostRef: Ref<HTMLDivElement>;
  itemKey: string;
  catalog: CraftCatalog | null;
  qty?: number;
  durability?: ToolDurabilityView | null;
  size?: number;
}) {
  return (
    <div ref={ghostRef} className="pointer-events-none fixed left-0 top-0 z-[1000] will-change-transform" aria-hidden data-testid="slot-drag-ghost">
      <div
        className="slot-ghost-inner relative flex items-center justify-center rounded-md border-2 border-amber-300 bg-[#19100a] shadow-[0_10px_24px_rgba(0,0,0,.65),0_0_0_1px_rgba(252,211,77,.35)]"
        style={{ width: size, height: size }}
      >
        <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={Math.round(size * 0.8)} />
        {typeof qty === 'number' && (
          <span
            className={`absolute right-0.5 rounded-sm bg-black/85 px-1 text-[10px] font-bold leading-4 text-amber-50 ${durability ? 'bottom-[7px]' : 'bottom-0.5'}`}
          >
            {qty > 999 ? '999+' : qty}
          </span>
        )}
        {durability && <DurabilityBar view={durability} />}
      </div>
    </div>
  );
}
