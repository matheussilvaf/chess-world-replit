import { applyInventoryDeltas, getInventory, type InventoryItem } from '../collection/inventoryRepository.js';
import { mergeStationsWithDefaults, isStationId } from '../shared/craft/StationShapes.js';
import { PLACEABLE_STACK_LIMIT, placeableStationFor } from '../shared/craft/PlaceableStations.js';
import { getCraftItemsCached, listCraftRecipes } from './craftRepository.js';
import { listStationMembers, listStations } from './stationRepository.js';
import { progressService } from '../progress/progressService.js';

export type PlayerCraftResult = { ok: true; items: InventoryItem[] } | { ok: false; message: string };

/** Runs every server-side recipe and inventory check; callers supply only identity and selection. */
export async function executePlayerCraft(
  userId: string, stationId: unknown, targetId: unknown, quantity: unknown,
): Promise<PlayerCraftResult> {
  if (!isStationId(stationId) || typeof targetId !== 'string' || typeof quantity !== 'number' ||
    !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { ok: false, message: 'stationId, targetId e quantity inteiro 1..999 são obrigatórios' };
  }
  const [recipes, stations, members] = await Promise.all([listCraftRecipes(), listStations(), listStationMembers()]);
  if (recipes.error || stations.error || members.error) {
    return { ok: false, message: recipes.error ?? stations.error ?? members.error ?? 'Configuração de craft indisponível' };
  }
  if (recipes.tableMissing || stations.tableMissing || members.tableMissing) {
    return { ok: false, message: 'Tabelas de craft ausentes no Supabase' };
  }
  const recipe = recipes.records[targetId];
  const station = mergeStationsWithDefaults(stations.records).find((entry) => entry.stationId === stationId);
  const tab = station?.tabs.find((entry) => entry.rows.some((row) => row.includes(targetId)));
  if (!recipe || members.records[targetId] !== stationId || !tab) {
    return { ok: false, message: 'Item não pode ser criado nesta estação' };
  }
  const produced = (recipe.outputQuantity ?? 1) * quantity;
  // Estações portáteis: uma cópia por inventário (a durabilidade é da cópia).
  const placeable = placeableStationFor(targetId);
  if (placeable) {
    const current = await getInventory(userId);
    if (current.error) return { ok: false, message: current.error };
    const owned = current.items.find((item) => item.itemKey === targetId)?.qty ?? 0;
    if (owned + produced > PLACEABLE_STACK_LIMIT) {
      const name = (await getCraftItemsCached())[targetId]?.name ?? placeable.name;
      return { ok: false, message: `Você já carrega uma ${name} — posicione ou solte a atual antes de criar outra` };
    }
  }
  const deltas = recipe.ingredients.map((ingredient) => ({ itemKey: ingredient.itemId, qty: -ingredient.quantity * quantity }));
  deltas.push({ itemKey: targetId, qty: produced });
  const changed = await applyInventoryDeltas(userId, deltas);
  if (!changed.ok) return { ok: false, message: changed.error ?? 'Falha no inventário' };
  const snapshot = await getInventory(userId);
  if (snapshot.error || snapshot.tableMissing) return { ok: false, message: snapshot.error ?? 'Inventário indisponível após craft' };
  // Energia (por estação + construir estação portátil) e XP (forja/fundição/
  // culinária) — depois do inventário confirmar; nunca bloqueia o craft.
  progressService.recordCraft(userId, { stationId, targetId, quantity }).catch((error: unknown) => {
    console.warn(`[craft] progresso do craft não registrado: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { ok: true, items: snapshot.items };
}