import { CatalogThumb } from '../admin/craft/CatalogThumb';
import type { CraftCatalog } from '../../lib/craft/craftCatalog';
import { inventoryEntry, inventoryFallbackName } from '../../lib/inventory/inventoryVisualCatalog';

export function InventoryItemName({ itemKey, catalog }: { itemKey: string; catalog: CraftCatalog | null }) {
  return <>{inventoryEntry(catalog, itemKey)?.name ?? inventoryFallbackName(itemKey)}</>;
}

export function InventoryItemThumb({ itemKey, catalog, size = 40 }: { itemKey: string; catalog: CraftCatalog | null; size?: number }) {
  const entry = inventoryEntry(catalog, itemKey);
  if (entry) return <CatalogThumb thumb={entry.thumb} size={size} bare />;
  return <span title={inventoryFallbackName(itemKey)} className="flex h-full w-full items-center justify-center text-center text-[10px] font-bold text-amber-100">Item</span>;
}