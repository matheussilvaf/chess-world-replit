import { useEffect, useState } from 'react';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { getGeneratorManifest } from '../../game/characters/appearanceRuntime';
import { buildCraftCatalog, type CraftCatalog, type CraftCatalogEntry } from '../craft/craftCatalog';
import type { CraftItemConfig } from '../../shared/craft/CraftShapes';
import type { CraftBadgeMap } from '../../shared/craft/CraftBadges';

interface CraftData {
  items: Record<string, CraftItemConfig>;
  badges: CraftBadgeMap;
}

let catalogPromise: Promise<CraftCatalog> | null = null;
let craftDataPromise: Promise<CraftData> | null = null;
/** Última resposta boa — leitura síncrona para o runtime (hotbar, comer). */
let craftDataCache: CraftData | null = null;

/** GET /api/craft-data (itens + badges), cacheado por sessão de página. */
function loadCraftData(): Promise<CraftData> {
  if (craftDataPromise) return craftDataPromise;
  craftDataPromise = (async () => {
    const base = getColyseusHttpUrl();
    if (!base) throw new Error('Catálogo indisponível');
    const response = await fetch(`${base.replace(/\/api$/, '')}/api/craft-data`);
    if (!response.ok) throw new Error('Catálogo indisponível');
    const data = (await response.json()) as { items?: Record<string, CraftItemConfig>; badges?: CraftBadgeMap };
    craftDataCache = { items: data.items ?? {}, badges: data.badges ?? {} };
    return craftDataCache;
  })().catch((error) => {
    craftDataPromise = null;
    throw error;
  });
  return craftDataPromise;
}

/**
 * Bancada DEV: injeta itens + badges SEM rede (chamar antes do 1º load; um
 * catálogo já montado é descartado para incluir os itens injetados).
 */
export function primeCraftData(data: CraftData): void {
  craftDataCache = { items: { ...data.items }, badges: { ...data.badges } };
  craftDataPromise = Promise.resolve(craftDataCache);
  catalogPromise = null;
}

/** Craft items configurados no admin (nome, imagem, durabilidade das estações portáteis), cacheados. */
export function loadCraftItems(): Promise<Record<string, CraftItemConfig>> {
  return loadCraftData().then((data) => data.items);
}

/** Badges (`food`, `forging`…) por item, cacheadas junto com os itens. */
export function loadCraftBadges(): Promise<CraftBadgeMap> {
  return loadCraftData().then((data) => data.badges);
}

/** Badges já carregadas (null antes do 1º load) — para checagens síncronas no jogo. */
export function cachedCraftBadges(): CraftBadgeMap | null {
  return craftDataCache?.badges ?? null;
}

export function loadInventoryVisualCatalog(): Promise<CraftCatalog> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const [items, manifest] = await Promise.all([loadCraftItems(), getGeneratorManifest()]);
    return buildCraftCatalog(manifest, items);
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