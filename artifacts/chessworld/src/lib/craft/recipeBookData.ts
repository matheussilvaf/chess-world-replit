/**
 * Dados do Livro de Receitas: catálogo visual + receitas (do cache de
 * /api/craft-data) e as estações com a filiação item → estação
 * (/api/craft-stations-data), tudo cacheado por sessão de página.
 */
import { useEffect, useState } from 'react';
import { getColyseusHttpUrl } from '../../config/colyseus';
import type { CraftRecipeConfig } from '../../shared/craft/CraftShapes';
import type { CraftBadgeMap } from '../../shared/craft/CraftBadges';
import { mergeStationsWithDefaults, type StationConfig } from '../../shared/craft/StationShapes';
import { loadCraftBadges, loadCraftRecipes, loadInventoryVisualCatalog } from '../inventory/inventoryVisualCatalog';
import type { CraftCatalog } from './craftCatalog';

export interface CraftStationsData {
  /** Estações na ordem oficial (o servidor já mescla com os defaults). */
  stations: StationConfig[];
  /** item → estação que o cria. */
  members: Record<string, string>;
}

export interface RecipeBookData {
  catalog: CraftCatalog;
  recipes: Record<string, CraftRecipeConfig>;
  badges: CraftBadgeMap;
  stations: StationConfig[];
  members: Record<string, string>;
}

let stationsPromise: Promise<CraftStationsData> | null = null;

/** GET /api/craft-stations-data, cacheado por sessão de página. */
export function loadCraftStations(): Promise<CraftStationsData> {
  if (stationsPromise) return stationsPromise;
  stationsPromise = (async () => {
    const base = getColyseusHttpUrl();
    if (!base) throw new Error('Estações indisponíveis');
    const response = await fetch(`${base.replace(/\/api$/, '')}/api/craft-stations-data`);
    if (!response.ok) throw new Error('Estações indisponíveis');
    const data = (await response.json()) as { stations?: StationConfig[]; members?: Record<string, string> };
    return { stations: data.stations ?? mergeStationsWithDefaults({}), members: data.members ?? {} };
  })().catch((error) => {
    stationsPromise = null;
    throw error;
  });
  return stationsPromise;
}

/** Bancada DEV: estações/filiação SEM rede (chamar antes do 1º load). */
export function primeCraftStations(data: Partial<CraftStationsData>): void {
  stationsPromise = Promise.resolve({
    stations: data.stations ?? mergeStationsWithDefaults({}),
    members: { ...(data.members ?? {}) },
  });
}

export function loadRecipeBookData(): Promise<RecipeBookData> {
  return Promise.all([loadInventoryVisualCatalog(), loadCraftRecipes(), loadCraftBadges(), loadCraftStations()]).then(
    ([catalog, recipes, badges, stations]) => ({ catalog, recipes, badges, stations: stations.stations, members: stations.members }),
  );
}

export function useRecipeBookData(): { data: RecipeBookData | null; error: string | null } {
  const [data, setData] = useState<RecipeBookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadRecipeBookData()
      .then((value) => { if (!cancelled) setData(value); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as receitas.');
      });
    return () => { cancelled = true; };
  }, []);
  return { data, error };
}
