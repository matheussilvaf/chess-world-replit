import { useEffect, useState } from 'react';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import { buildCraftCatalog, type CraftCatalog, type CraftCatalogEntry } from '../craft/craftCatalog';

let catalogPromise: Promise<CraftCatalog> | null = null;

export function loadInventoryVisualCatalog(): Promise<CraftCatalog> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const base = getColyseusHttpUrl();
    if (!base) throw new Error('Catálogo indisponível');
    const response = await fetch(`${base.replace(/\/api$/, '')}/api/craft-data`);
    if (!response.ok) throw new Error('Catálogo indisponível');
    const data = (await response.json()) as { items?: Record<string, any> };
    const manifest = await getGeneratorManifest();
    return buildCraftCatalog(manifest, data.items ?? {});
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

export function useInventoryVisualCatalog() {
  const [catalog, setCatalog] = useState<CraftCatalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadInventoryVisualCatalog().then((value) => !cancelled && setCatalog(value)).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return catalog;
}

/**
 * Entrada visual de um item. Refs só de família (`gen:weapon/sword`, sem
 * variante — formato aceito pelo servidor para a arma da classe) usam a
 * primeira variante catalogada da família para ter ícone/nome.
 */
export function inventoryEntry(catalog: CraftCatalog | null, itemKey: string): CraftCatalogEntry | null {
  if (!catalog) return null;
  const direct = catalog.byId.get(itemKey);
  if (direct) return direct;
  if (!itemKey.startsWith('gen:') || itemKey.split('/').length !== 2) return null;
  const prefix = `${itemKey}/`;
  for (const [id, entry] of catalog.byId) {
    if (id.startsWith(prefix)) return entry;
  }
  return null;
}

export function inventoryFallbackName(itemKey: string) {
  if (itemKey.startsWith('gen:crafttools/')) return 'Ferramenta';
  if (itemKey.startsWith('gen:weapon/')) return 'Arma';
  return 'Item';
}