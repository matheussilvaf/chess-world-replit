import { useEffect, useState } from 'react';
import { Backpack, Minus, Plus, X } from 'lucide-react';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { DEFAULT_INVENTORY_SLOT_COUNT, INVENTORY_COLUMNS } from '../../config/inventoryConfig';
import { usePanelPlacement } from '../../hooks/usePanelPlacement';
import { getInventoryBridge } from '../../game/inventory/inventoryBridge';
import { inventoryEntry, inventoryFallbackName, useInventoryVisualCatalog } from '../../lib/inventory/inventoryVisualCatalog';
import { InventoryItemName, InventoryItemThumb } from './InventoryItemVisual';

export function CollectionInventoryButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} title="Inventário de Coleta" className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/90 text-slate-300 transition-all hover:bg-slate-800 hover:text-white sm:h-10 sm:w-10"><Backpack className="h-4 w-4" /></button>;
}


type Drag = { from: number; startX: number; startY: number; x: number; y: number; active: boolean } | null;
type Draft = { itemKey: string; max: number; qty: number; x: number; y: number; worldX: number; worldY: number } | null;

export function CollectionInventoryPanel({ onClose }: { onClose: () => void }) {
  const { items, slots, loaded, loading, error, refresh, moveSlot, selectItem } = useCollectionInventoryStore();
  const placement = usePanelPlacement({ storageKey: 'chessworld:collection-inventory-panel', defaultWidth: 400, defaultHeight: 490, minW: 330, minH: 370 });
  const [drag, setDrag] = useState<Drag>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const catalog = useInventoryVisualCatalog();

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape' && !draft) onClose(); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [draft, onClose]);

  const slotAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-inventory-slot]');
    const index = Number(el?.getAttribute('data-inventory-slot'));
    return Number.isInteger(index) && index >= 0 && index < DEFAULT_INVENTORY_SLOT_COUNT ? index : null;
  };
  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>, from: number) => {
    if (!slots[from] || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false });
  };
  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => setDrag((old) => old && ({
    ...old, x: event.clientX, y: event.clientY,
    active: old.active || Math.hypot(event.clientX - old.startX, event.clientY - old.startY) > 5,
  }));
  const endDrag = (event: React.PointerEvent<HTMLButtonElement>, from: number) => {
    const current = drag; setDrag(null);
    if (!current) return;
    if (!current.active) { selectItem(slots[from]); return; }
    const target = slotAt(event.clientX, event.clientY);
    if (target !== null) { moveSlot(current.from, target); return; }
    const rect = placement.panelRef.current?.getBoundingClientRect();
    const key = slots[current.from];
    const bridge = getInventoryBridge();
    if (key && rect && !rectContains(rect, event.clientX, event.clientY) && bridge) {
      const world = bridge.screenToWorld(event.clientX, event.clientY);
      if (world) setDraft({ itemKey: key, max: items[key] ?? 1, qty: 1, x: Math.max(112, Math.min(window.innerWidth - 112, event.clientX)), y: Math.max(92, Math.min(window.innerHeight - 92, event.clientY)), worldX: world.x, worldY: world.y });
    }
  };
  const confirmDrop = () => {
    if (!draft) return;
    const bridge = getInventoryBridge();
    if (!bridge) return;
    bridge.sendDrop({ requestId: crypto.randomUUID(), itemKey: draft.itemKey, qty: draft.qty, x: draft.worldX, y: draft.worldY });
    setDraft(null);
  };
  const hotbarStart = DEFAULT_INVENTORY_SLOT_COUNT - INVENTORY_COLUMNS;
  useEffect(() => { if (draft) setDraft(d => d ? { ...d, max: items[d.itemKey] ?? 1, qty: Math.min(d.qty, items[d.itemKey] ?? 1) } : null); }, [items, draft?.itemKey]);

  return <>
    <div ref={placement.panelRef} style={placement.style} className="fixed bottom-16 right-3 z-[160] flex w-[400px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border-2 border-[#8a5a2b] bg-[#2b1c10]/98 shadow-2xl">
      <div {...placement.dragHandleProps} className="flex cursor-move items-center justify-between border-b-2 border-[#8a5a2b] bg-[#3a2817] px-4 py-2.5">
        <h2 className="text-sm font-bold uppercase tracking-[.2em] text-amber-200">Inventário</h2>
        <button type="button" onClick={() => !draft && onClose()} title={draft ? 'Conclua ou cancele o descarte antes de fechar' : 'Fechar'} className="text-amber-100/80 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="p-4">
        {loading && !loaded ? <p className="py-12 text-center text-amber-100/60">Carregando inventário...</p> : <>
          {error && <p className="mb-3 rounded border border-red-800 bg-red-950/50 p-2 text-xs text-red-200">{error}</p>}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${INVENTORY_COLUMNS}, minmax(0, 1fr))` }}>
            {slots.map((key, index) => <button key={index} type="button" data-inventory-slot={index} onPointerDown={(e) => beginDrag(e, index)} onPointerMove={moveDrag} onPointerUp={(e) => endDrag(e, index)} onPointerCancel={() => setDrag(null)} title={key ? `${inventoryEntry(catalog, key)?.name ?? inventoryFallbackName(key)} (${items[key]})` : 'Vazio'} className={`relative aspect-square touch-none select-none rounded border-2 bg-black/35 ${index >= hotbarStart ? 'border-amber-500/70 bg-[#4b3018]' : 'border-[#6b4a26]'} ${drag?.active && drag.from === index ? 'opacity-30' : ''}`}>
              {key && <><InventoryItemThumb itemKey={key} catalog={catalog} /><span className="absolute bottom-0 right-0 rounded-tl bg-black/80 px-1 text-[10px] font-bold text-white">{items[key]}</span></>}
            </button>)}
          </div>
          <p className="mt-3 border-t border-[#6b4a26] pt-2 text-center text-[10px] font-bold uppercase tracking-[.18em] text-amber-200/70">Acesso rápido</p>
        </>}
      </div>
    </div>
    {drag?.active && slots[drag.from] && <div className="pointer-events-none fixed z-[250] h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-amber-400 bg-[#2b1c10] p-1" style={{ left: drag.x, top: drag.y }}><InventoryItemThumb itemKey={slots[drag.from]!} catalog={catalog} /></div>}
    {draft && <div className="fixed z-[260] w-56 -translate-x-1/2 rounded-lg border-2 border-[#8a5a2b] bg-[#2b1c10] p-3 text-amber-100 shadow-2xl" style={{ left: draft.x, top: draft.y }}>
      <div className="mb-2 flex items-center gap-2"><span className="h-8 w-8"><InventoryItemThumb itemKey={draft.itemKey} catalog={catalog} size={32} /></span><p className="text-xs font-bold">Soltar <InventoryItemName itemKey={draft.itemKey} catalog={catalog} /></p></div>
      <div className="flex items-center gap-2"><button onClick={() => setDraft({ ...draft, qty: Math.max(1, draft.qty - 1) })}><Minus className="h-4 w-4" /></button><input aria-label="Quantidade" type="number" min={1} max={draft.max} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: Math.max(1, Math.min(draft.max, Number(e.target.value) || 1)) })} className="w-12 rounded bg-black/40 text-center" /><button onClick={() => setDraft({ ...draft, qty: Math.min(draft.max, draft.qty + 1) })}><Plus className="h-4 w-4" /></button><button onClick={() => setDraft({ ...draft, qty: draft.max })} className="text-xs underline">Tudo</button></div>
      <div className="mt-3 flex gap-2"><button onClick={confirmDrop} className="rounded bg-amber-600 px-2 py-1 text-xs font-bold">Confirmar</button><button onClick={() => setDraft(null)} className="rounded border border-[#8a5a2b] px-2 py-1 text-xs">Cancelar</button></div>
    </div>}
  </>;
}
function rectContains(rect: DOMRect, x: number, y: number) { return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; }