/**
 * Durabilidade das ferramentas no cliente — helpers de leitura.
 *
 * O máximo vem da config da variação (admin → Editor de rigs → Ferramenta →
 * "Durabilidade"), lida do mesmo mapa de famílias que o Mundo de Coleta usa
 * para poder/nível (cache do weaponLoader). O restante vem do servidor (linha
 * da pilha em `collection_inventory.durability`) e é decrementado de forma
 * otimista a cada golpe até o próximo snapshot.
 */
import { parseWeaponRef } from '../../shared/characters/PlayerCharacterShapes';
import { DEFAULT_TOOL_DURABILITY, getWeaponVariantTool } from '../../shared/combat/WeaponShapes';
import { clampToolRemaining, isToolItemKey, toolDurabilityRatio } from '../../shared/collection/ToolWear';
import { clampStationRemaining, isPlaceableStationItemKey, placeableStationFor } from '../../shared/craft/PlaceableStations';
import { loadWeaponFamiliesMap } from '../../game/rigs/weaponLoader';
import { loadCraftItems } from './inventoryVisualCatalog';

export { isToolItemKey };

/** Itens cuja pilha tem barra de durabilidade: ferramentas e estações portáteis. */
export function hasDurabilityBar(itemKey: string): boolean {
  return isToolItemKey(itemKey) || isPlaceableStationItemKey(itemKey);
}

const maxCache = new Map<string, Promise<number>>();

/**
 * Durabilidade máxima configurada para a ferramenta (padrão 100; cacheado por
 * ref) ou para a estação portátil (campo "durabilidade" em /admin/craft).
 */
export function loadToolMaxDurability(itemKey: string): Promise<number> {
  let pending = maxCache.get(itemKey);
  if (!pending) {
    pending = (async () => {
      const placeable = placeableStationFor(itemKey);
      if (placeable) {
        const configured = (await loadCraftItems())[itemKey]?.durability;
        return typeof configured === 'number' && Number.isFinite(configured) && configured >= 1
          ? Math.floor(configured)
          : placeable.defaultDurability;
      }
      const parsed = parseWeaponRef(itemKey);
      if (!parsed || parsed.category !== 'crafttools') return DEFAULT_TOOL_DURABILITY;
      const families = await loadWeaponFamiliesMap();
      const durability = getWeaponVariantTool(families[parsed.familyId] ?? null, parsed.variantId ?? 'default')?.durability;
      return typeof durability === 'number' && Number.isFinite(durability) && durability >= 1
        ? Math.floor(durability)
        : DEFAULT_TOOL_DURABILITY;
    })().catch(() => {
      maxCache.delete(itemKey); // permite nova tentativa (rede)
      return placeableStationFor(itemKey)?.defaultDurability ?? DEFAULT_TOOL_DURABILITY;
    });
    maxCache.set(itemKey, pending);
  }
  return pending;
}

export interface ToolDurabilityView {
  remaining: number;
  max: number;
  /** 0..1 */
  ratio: number;
  /** Cor da barra: verde → âmbar → vermelho conforme gasta. */
  tone: 'good' | 'worn' | 'critical';
}

/** Estado da barra para a UI (null = não tem durabilidade ou máximo desconhecido). */
export function toolDurabilityView(
  itemKey: string | null,
  remaining: number | null | undefined,
  max: number | undefined,
): ToolDurabilityView | null {
  if (!itemKey || !hasDurabilityBar(itemKey) || typeof max !== 'number' || max < 1) return null;
  if (isPlaceableStationItemKey(itemKey)) {
    // Estações portáteis: 0 é um estado real ("sem durabilidade") — barra vazia e vermelha.
    const left = clampStationRemaining(remaining, max);
    const ratio = left / max;
    return { remaining: left, max, ratio, tone: ratio > 0.5 ? 'good' : ratio > 0.2 ? 'worn' : 'critical' };
  }
  // 0 só existe de forma otimista (último golpe dado, quebra ainda não
  // confirmada pelo servidor): barra vazia, não "cheia".
  const zeroed = remaining === 0;
  const ratio = zeroed ? 0 : toolDurabilityRatio(remaining, max);
  return {
    remaining: zeroed ? 0 : clampToolRemaining(remaining, max),
    max,
    ratio,
    tone: ratio > 0.5 ? 'good' : ratio > 0.2 ? 'worn' : 'critical',
  };
}
