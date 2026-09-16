import { applyInventoryDeltas, getInventory, type InventoryItem } from '../collection/inventoryRepository.js';
import { mergeStationsWithDefaults, isStationId } from '../shared/craft/StationShapes.js';
import { PLACEABLE_STACK_LIMIT, placeableStationFor } from '../shared/craft/PlaceableStations.js';
import { recipeGambitsCost, resolveRecipeChoices, type CraftChoices } from '../shared/craft/CraftShapes.js';
import { getCraftItemsCached, listCraftRecipes } from './craftRepository.js';
import { listStationMembers, listStations } from './stationRepository.js';
import { progressService } from '../progress/progressService.js';
import { changeGambits } from '../rating/ratingRepository.js';

export type PlayerCraftResult =
  /** `gambits` = saldo após o débito (presente só quando a receita cobra gambits). */
  | { ok: true; items: InventoryItem[]; gambits?: number }
  | { ok: false; message: string };

/**
 * `choices` (opcional): item escolhido em cada card com alternativas ("ou"),
 * indexado pelo id PRINCIPAL do card. Inválido/ausente para um card = principal.
 */
export function parseCraftChoices(raw: unknown): { ok: true; choices: CraftChoices | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, choices: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'choices: objeto { itemPrincipal: itemEscolhido } esperado' };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 32) return { ok: false, message: 'choices: excesso de entradas' };
  const choices: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 200) return { ok: false, message: `choices["${key}"]: id de item esperado` };
    choices[key] = value;
  }
  return { ok: true, choices };
}

/** Runs every server-side recipe and inventory check; callers supply only identity and selection. */
export async function executePlayerCraft(
  userId: string, stationId: unknown, targetId: unknown, quantity: unknown, rawChoices?: unknown,
): Promise<PlayerCraftResult> {
  if (!isStationId(stationId) || typeof targetId !== 'string' || typeof quantity !== 'number' ||
    !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { ok: false, message: 'stationId, targetId e quantity inteiro 1..999 são obrigatórios' };
  }
  const parsedChoices = parseCraftChoices(rawChoices);
  if (!parsedChoices.ok) return { ok: false, message: parsedChoices.message };
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
  // Alternativas ("ou"): a escolha do jogador precisa ser uma opção do card.
  const resolved = resolveRecipeChoices(recipe, parsedChoices.choices);
  if (!resolved.ok) return { ok: false, message: resolved.message };
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
  // Gambits: debitados ANTES do inventário (CAS no saldo; nunca fica negativo).
  // Se o inventário falhar depois, estorna (best-effort) para não sumir saldo.
  const gambitsCost = recipeGambitsCost(recipe) * quantity;
  let gambitsBalance: number | undefined;
  if (gambitsCost > 0) {
    const debit = await changeGambits(userId, -gambitsCost);
    if (!debit.ok) {
      if (debit.insufficient) return { ok: false, message: `Gambits insuficientes: precisa de ${gambitsCost}, você tem ${debit.balance}` };
      if (debit.schemaMissing) return { ok: false, message: 'Gambits indisponíveis (migração do rating pendente)' };
      return { ok: false, message: debit.error ?? 'Falha ao debitar gambits' };
    }
    gambitsBalance = debit.balance;
  }
  const deltas = resolved.ingredients.map((ingredient) => ({ itemKey: ingredient.itemId, qty: -ingredient.quantity * quantity }));
  deltas.push({ itemKey: targetId, qty: produced });
  const changed = await applyInventoryDeltas(userId, deltas);
  if (!changed.ok) {
    if (gambitsCost > 0) {
      const refund = await changeGambits(userId, gambitsCost);
      if (!refund.ok) console.error(`[craft] estorno de ${gambitsCost} gambits falhou para ${userId}: ${refund.error}`);
    }
    return { ok: false, message: changed.error ?? 'Falha no inventário' };
  }
  const snapshot = await getInventory(userId);
  if (snapshot.error || snapshot.tableMissing) return { ok: false, message: snapshot.error ?? 'Inventário indisponível após craft' };
  // Energia (por estação + construir estação portátil) e XP (forja/fundição/
  // culinária/alquimia) — depois do inventário confirmar; nunca bloqueia o craft.
  progressService.recordCraft(userId, { stationId, targetId, quantity }).catch((error: unknown) => {
    console.warn(`[craft] progresso do craft não registrado: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { ok: true, items: snapshot.items, ...(gambitsBalance !== undefined ? { gambits: gambitsBalance } : {}) };
}