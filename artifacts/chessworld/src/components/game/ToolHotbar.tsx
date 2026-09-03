import { useEffect, useState } from 'react';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { DEFAULT_INVENTORY_SLOT_COUNT, INVENTORY_COLUMNS } from '../../config/inventoryConfig';
import { fetchPublicAssetCategories } from '../../lib/playerCharacterApi';
import { findClassWeaponRef } from '../../shared/characters/PlayerCharacterShapes';
import { useInventoryVisualCatalog } from '../../lib/inventory/inventoryVisualCatalog';
import { InventoryItemThumb } from './InventoryItemVisual';

export function ToolHotbar() {
  const character = usePlayerCharacterStore(s => s.character); const ready = usePlayerCharacterStore(s => s.worldReady);
  const sender = usePlayerCharacterStore(s => s.equipSender); const live = usePlayerCharacterStore(s => s.liveWeapon);
  const { slots, items, selectedItemKey, selectItem, moveSlot } = useCollectionInventoryStore();
  const [weapon, setWeapon] = useState<string | null>(null); const [drag, setDrag] = useState<number | null>(null);
  const catalog = useInventoryVisualCatalog();
  useEffect(() => { if (character) void fetchPublicAssetCategories().then(c => setWeapon(findClassWeaponRef(c, character.classId))).catch(() => setWeapon(null)); }, [character]);
  if (!character || !ready) return null;
  const start = DEFAULT_INVENTORY_SLOT_COUNT - INVENTORY_COLUMNS; const quick = slots.slice(start);
  const chooseWeapon = () => { selectItem(null); if (weapon) sender?.(live !== weapon, weapon); };
  return <div className="pointer-events-auto fixed bottom-2 left-1/2 z-[110] -translate-x-1/2"><div className="flex gap-1 rounded-md border-2 border-[#8a5a2b] bg-[#2b1c10]/95 p-1">
    <button type="button" onClick={chooseWeapon} title="Arma padrão da classe" className={`relative h-11 w-11 rounded border-2 text-[9px] text-amber-100 ${live === weapon && weapon ? 'border-emerald-500' : 'border-[#6b4a26]'}`}>Arma</button>
    {quick.map((key, i) => <button key={i} draggable={!!key} onDragStart={() => setDrag(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag !== null) moveSlot(start + drag, start + i); setDrag(null); }} onDragEnd={() => setDrag(null)} onClick={() => { if (!key) return; selectItem(key); if (key.startsWith('gen:crafttools/')) sender?.(true, key); else sender?.(false); }} className={`relative h-11 w-11 overflow-hidden rounded border-2 ${(key && ((key.startsWith('gen:crafttools/') && live === key) || (!key.startsWith('gen:crafttools/') && selectedItemKey === key))) ? 'border-emerald-500' : 'border-[#6b4a26]'}`}>
      {key && <><InventoryItemThumb itemKey={key} catalog={catalog} size={40} /><span className="absolute bottom-0 right-0 bg-black/80 px-1 text-[10px] text-white">{items[key]}</span></>}
    </button>)}
  </div></div>;
}