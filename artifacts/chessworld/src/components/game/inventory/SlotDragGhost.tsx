import type { CraftCatalog } from '../../../lib/craft/craftCatalog';
import { InventoryItemThumb } from '../InventoryItemVisual';

/** Ícone que acompanha o ponteiro durante um arrasto (não captura eventos). */
export function SlotDragGhost({
  itemKey,
  catalog,
  x,
  y,
  qty,
  size = 48,
}: {
  itemKey: string;
  catalog: CraftCatalog | null;
  x: number;
  y: number;
  qty?: number;
  size?: number;
}) {
  return (
    <div
      className="pointer-events-none fixed z-[400] flex items-center justify-center rounded-md border-2 border-amber-300 bg-[#19100a] shadow-[0_6px_18px_rgba(0,0,0,.6)]"
      style={{ left: x, top: y, width: size, height: size, transform: 'translate(-50%, -50%) scale(1.08)' }}
      aria-hidden
    >
      <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={Math.round(size * 0.8)} />
      {typeof qty === 'number' && (
        <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/85 px-1 text-[10px] font-bold text-amber-50">{qty}</span>
      )}
    </div>
  );
}
