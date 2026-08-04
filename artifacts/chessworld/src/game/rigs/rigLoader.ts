/**
 * Game-side rig loader (spec §22) — the seam between the Character Rig
 * Controller (/admin/rigs) and the game runtime.
 *
 * Nothing in the game consumes rigs yet: no entity carries a rigId and the
 * server still resolves combat from its own config. When a feature needs rig
 * data (hurt/hitboxes, origin, collision body), load it here and use the
 * geometry helpers in src/shared/combat/RigShapes.ts (localRectToWorldRect
 * etc.) — the same math the editor and the server use.
 */
import { getColyseusHttpUrl, isColyseusConfigured } from '../../config/colyseus';
import {
  DEFAULT_RIG_ID,
  validateRigConfig,
  type RigConfig,
} from '../../shared/combat/RigShapes';

const cache = new Map<string, RigConfig>();
const inflight = new Map<string, Promise<RigConfig>>();

function publicRigUrl(rigId: string): string {
  // getColyseusHttpUrl() ends in /api (same convention as rigApi.ts)
  const base = getColyseusHttpUrl().replace(/\/api$/, '');
  return `${base}/api/rigs/${encodeURIComponent(rigId)}`;
}

/**
 * Fetches (and caches) a rig config from the public read-only endpoint
 * (GET /api/rigs/:rigId — no auth). Throws on network/validation failure;
 * callers decide the fallback. There is no silent default here.
 */
export async function loadRigConfig(rigId: string = DEFAULT_RIG_ID): Promise<RigConfig> {
  if (!isColyseusConfigured()) {
    throw new Error(
      'Servidor Colyseus não configurado (VITE_COLYSEUS_URL) — rig não pode ser carregado.',
    );
  }
  const cached = cache.get(rigId);
  if (cached) return cached;
  const pending = inflight.get(rigId);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(publicRigUrl(rigId));
    if (!res.ok) {
      throw new Error(`Falha ao carregar rig "${rigId}": HTTP ${res.status}`);
    }
    // The endpoint returns the validated config directly (no envelope).
    const data: unknown = await res.json();
    const validated = validateRigConfig(data);
    if (!validated.ok) {
      throw new Error(`Rig "${rigId}" inválido: ${validated.errors[0] ?? 'erro desconhecido'}`);
    }
    cache.set(rigId, validated.config);
    return validated.config;
  })();

  inflight.set(rigId, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(rigId);
  }
}

/** Sync access to an already-loaded rig (null when not fetched yet). */
export function getCachedRigConfig(rigId: string = DEFAULT_RIG_ID): RigConfig | null {
  return cache.get(rigId) ?? null;
}

/** Drops all cached rigs (e.g. after editing in /admin/rigs). */
export function clearRigCache(): void {
  cache.clear();
  inflight.clear();
}
