/**
 * Weapon family catalog — merges DISCOVERY (generator manifest scan, dynamic)
 * with the PERSISTED family catalog (explicit admin associations) into the
 * merged view of spec §26. No weapon names are hardcoded anywhere: families
 * and variants come exclusively from the scanned manifest.
 */
import {
  WEAPON_LIKE_CATEGORIES,
  weaponAssetId,
  type WeaponAssetManifestEntry,
  type WeaponFamilyConfig,
  type WeaponFamilyManifestEntry,
} from '../../shared/combat/WeaponShapes';
import type { GeneratorManifest } from './types';

/**
 * Builds the merged family list. Families discovered in the manifest come
 * first; persisted rows whose PNGs no longer exist are still listed (flagged
 * by `variants.length === 0`) — configuration is never silently dropped.
 */
export function buildWeaponFamilyCatalog(
  manifest: GeneratorManifest | null,
  families: Record<string, WeaponFamilyConfig>,
): WeaponFamilyManifestEntry[] {
  const entries: WeaponFamilyManifestEntry[] = [];
  const seen = new Set<string>();

  // Weapons AND craft tools: both categories share the same family system.
  for (const category of WEAPON_LIKE_CATEGORIES) {
    for (const family of manifest?.categories[category] ?? []) {
      if (seen.has(family.id)) continue; // same family id in two folders — first wins
      const config = families[family.id];
      seen.add(family.id);
      const variants: WeaponAssetManifestEntry[] = family.variants.map((v) => ({
        assetId: weaponAssetId(family.id, v.id),
        familyId: family.id,
        variantId: v.id,
        file: v.file,
        url: v.url,
      }));
      entries.push({
        familyId: family.id,
        displayName: config?.displayName?.trim() ? config.displayName : family.id,
        defaultAssetId: weaponAssetId(family.id, family.default.id),
        variants,
        weaponHitboxProfileId: config?.weaponHitboxProfileId ?? null,
        configured: config !== undefined,
      });
    }
  }

  // Persisted families without matching PNGs (renamed/removed files).
  for (const config of Object.values(families)) {
    if (seen.has(config.familyId)) continue;
    entries.push({
      familyId: config.familyId,
      displayName: config.displayName?.trim() ? config.displayName : config.familyId,
      defaultAssetId: config.familyId,
      variants: [],
      weaponHitboxProfileId: config.weaponHitboxProfileId,
      configured: true,
    });
  }

  entries.sort((a, b) => a.familyId.localeCompare(b.familyId, undefined, { numeric: true, sensitivity: 'base' }));
  return entries;
}
