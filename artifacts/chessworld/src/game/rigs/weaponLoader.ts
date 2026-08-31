/**
 * Game-side weapon profile loader (spec §18/§20) — the seam between the
 * weapon hitbox profiles (/admin/rigs) and the game runtime.
 *
 * Nothing in the game consumes profiles yet: players have no persisted
 * equipment, and the Colyseus server still resolves combat from its own
 * config. When equipment lands, the client uses this loader for PREVIEW
 * (drawing hitboxes) while the server resolves damage authoritatively from
 * its own repositories — a client-sent profileId is never trusted (spec §23).
 *
 * Resolution chain (shared `resolveWeaponProfileId`, spec §18):
 *   family profile → rig's defaultWeaponHitboxProfileId → null (no hitbox).
 */
import { getColyseusHttpUrl, isColyseusConfigured } from '../../config/colyseus';
import type { RigConfig } from '../../shared/combat/RigShapes';
import {
  parseWeaponAssetId,
  resolveWeaponLevelStats,
  resolveWeaponProfileId,
  validateWeaponHitboxProfile,
  type WeaponFamilyConfig,
  type WeaponHitboxProfile,
  type WeaponLevelStats,
} from '../../shared/combat/WeaponShapes';

type FamilyAssociationMap = Record<
  string,
  Pick<WeaponFamilyConfig, 'weaponHitboxProfileId' | 'variants'>
>;

// `null` em cache = referência pendurada (perfil excluído no servidor): a arma
// simplesmente fica sem hitboxes até clearWeaponCache()/nova associação.
const profileCache = new Map<string, WeaponHitboxProfile | null>();
const profileInflight = new Map<string, Promise<WeaponHitboxProfile | null>>();
let familiesCache: FamilyAssociationMap | null = null;
let familiesInflight: Promise<FamilyAssociationMap> | null = null;

function publicUrl(path: string): string {
  // getColyseusHttpUrl() ends in /api (same convention as rigLoader.ts)
  const base = getColyseusHttpUrl().replace(/\/api$/, '');
  return `${base}${path}`;
}

function ensureConfigured(): void {
  if (!isColyseusConfigured()) {
    throw new Error(
      'Servidor Colyseus não configurado (VITE_COLYSEUS_URL) — perfis de arma não podem ser carregados.',
    );
  }
}

/** Fetches (and caches) the public familyId → association map. */
export async function loadWeaponFamiliesMap(): Promise<FamilyAssociationMap> {
  ensureConfigured();
  if (familiesCache) return familiesCache;
  if (familiesInflight) return familiesInflight;

  familiesInflight = (async () => {
    const res = await fetch(publicUrl('/api/weapon-families'));
    if (!res.ok) throw new Error(`Falha ao carregar famílias de arma: HTTP ${res.status}`);
    const data = (await res.json()) as { families?: FamilyAssociationMap };
    const map = data.families ?? {};
    familiesCache = map;
    return map;
  })();

  try {
    return await familiesInflight;
  } finally {
    familiesInflight = null;
  }
}

/**
 * Fetches (and caches) one profile from the public read-only endpoint.
 * Throws on network/validation failure; callers decide the fallback — there
 * is no silent default here.
 */
export async function loadWeaponProfile(profileId: string): Promise<WeaponHitboxProfile | null> {
  ensureConfigured();
  const cached = profileCache.get(profileId);
  if (cached !== undefined) return cached;
  const pending = profileInflight.get(profileId);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(publicUrl(`/api/weapon-hitbox-profiles/${encodeURIComponent(profileId)}`));
    if (res.status === 404) {
      // Perfil excluído com associação restante: degrade para "sem hitboxes"
      // em vez de quebrar o runtime (erros ≠404 continuam explícitos).
      profileCache.set(profileId, null);
      return null;
    }
    if (!res.ok) throw new Error(`Falha ao carregar perfil de arma "${profileId}": HTTP ${res.status}`);
    // The endpoint returns the validated profile directly (no envelope).
    const data: unknown = await res.json();
    const validated = validateWeaponHitboxProfile(data);
    if (!validated.ok) {
      throw new Error(`Perfil "${profileId}" inválido: ${validated.errors[0] ?? 'erro desconhecido'}`);
    }
    profileCache.set(profileId, validated.config);
    return validated.config;
  })();

  profileInflight.set(profileId, promise);
  try {
    return await promise;
  } finally {
    profileInflight.delete(profileId);
  }
}

/**
 * Full resolution for an equipped weapon asset id (e.g. "axe1_c2" — variants
 * share the family's profile). Returns null when no profile applies (no
 * hitbox, no damage): that is a legitimate state, never an error.
 */
export async function resolveWeaponProfileForAsset(
  weaponAssetId: string | null,
  rig: RigConfig,
): Promise<WeaponHitboxProfile | null> {
  return resolveWeaponProfileForFamily(
    weaponAssetId ? parseWeaponAssetId(weaponAssetId).familyId : null,
    rig,
  );
}

/**
 * Resolução por FAMÍLIA (variantes compartilham o perfil da família). É o
 * caminho certo para refs persistidas `gen:weapon/<família>/<variante>`, onde
 * a família já vem explícita — nada de reconstruir asset id do gerador.
 * familyId null → segue a cadeia normal (rig default → null).
 */
export async function resolveWeaponProfileForFamily(
  familyId: string | null,
  rig: RigConfig,
): Promise<WeaponHitboxProfile | null> {
  const families = familyId ? await loadWeaponFamiliesMap() : {};
  const family = familyId ? (families[familyId] ?? null) : null;
  const familyConfig: WeaponFamilyConfig | null =
    family && familyId ? { familyId, weaponHitboxProfileId: family.weaponHitboxProfileId } : null;
  const profileId = resolveWeaponProfileId(familyConfig, rig);
  if (!profileId) return null;
  return loadWeaponProfile(profileId);
}

/** Drops all cached weapon data (e.g. after editing in /admin/rigs). */
/**
 * Stats (dano + velocidade) de um item de arma em um level — resolvidos do
 * catálogo público de famílias. Level sem entrada salva degrada para o maior
 * level ≤ pedido (nunca quebra). O dano aqui é para PREVIEW/UI; em combate o
 * servidor continua sendo a autoridade (spec §23). A velocidade alimenta o
 * timeScale da animação de ataque quando o sistema de equipamento ligar.
 */
export async function resolveWeaponItemStats(
  weaponAssetId: string,
  level: number = 1,
  fallbackDamage?: number,
): Promise<WeaponLevelStats> {
  const { familyId, variantId } = parseWeaponAssetId(weaponAssetId);
  const families = await loadWeaponFamiliesMap();
  return resolveWeaponLevelStats(families[familyId] ?? null, variantId, level, fallbackDamage);
}

export function clearWeaponCache(): void {
  profileCache.clear();
  profileInflight.clear();
  familiesCache = null;
  familiesInflight = null;
}
