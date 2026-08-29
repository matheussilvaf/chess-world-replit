/**
 * Loader da config do Mundo de Coleta (quantidades de minérios + hurtboxes).
 *
 * GET público no servidor Colyseus (cache de 30s no lado do servidor). Sem
 * cache local: cada entrada no mundo relê — mudanças feitas no admin valem na
 * próxima visita, sem F5. Falha → null: o mapa usa os defaults do
 * craftingMapConfig (a indisponibilidade é avisada no console, nunca quebra o build).
 */
import { getColyseusHttpUrl, isColyseusConfigured } from '../../config/colyseus';
import {
  validateCollectionWorldConfig,
  type CollectionWorldConfig,
} from '../../shared/collection/CollectionShapes';

let inflight: Promise<CollectionWorldConfig | null> | null = null;

export async function loadCollectionWorldConfig(): Promise<CollectionWorldConfig | null> {
  if (!isColyseusConfigured()) return null;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const base = getColyseusHttpUrl().replace(/\/api$/, '');
      const res = await fetch(`${base}/api/collection-world-config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { config?: unknown };
      if (!data.config) return null; // ainda não configurado no admin
      const validated = validateCollectionWorldConfig(data.config);
      if (!validated.ok) throw new Error(validated.errors[0] ?? 'config inválida');
      return data.config as CollectionWorldConfig;
    } catch (err) {
      console.warn('[CraftingMap] config do admin indisponível — usando defaults:', err);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
