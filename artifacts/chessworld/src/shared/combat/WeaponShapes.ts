/**
 * WeaponShapes — shared contract for weapon hitbox profiles (schemaVersion 1).
 *
 * Splits combat geometry ownership (spec §2):
 *   - Rig owns: sprite origin, collision body, HURTBOXES (per anim/dir/frame).
 *   - WeaponHitboxProfile owns: HITBOXES + damage, per animation/dir/frame,
 *     associated to weapon FAMILIES via a persistent catalog.
 *
 * Weapon discovery is DYNAMIC (spec §3): families/variants come from scanning
 * `public/character-generator/assets/weapon` (the generator manifest). This
 * file must never contain weapon names — only the parsing RULE (`_cN` suffix).
 *
 * Mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/combat/WeaponShapes.ts   (client)
 *   - server/src/shared/combat/WeaponShapes.ts                 (Colyseus server)
 *   - artifacts/api-server/src/src/shared/combat/WeaponShapes.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 */
import {
  RIG_ANIMATION_NAME_RE,
  RIG_DIRECTION_NAMES,
  RIG_ID_RE,
  defaultRigCombat,
  emptyRigBoxGroup,
  mirrorRectAcrossOrigin,
  validateBoxGroup,
  type RigBoxGroupConfig,
  type RigCombatConfig,
  type RigConfig,
  type RigDirection,
} from './RigShapes.js';

// ---------------------------------------------------------------- constants

export const WEAPON_PROFILE_SCHEMA_VERSION = 1 as const;

/** Asset category (folder name) that carries weapons in the generator. */
export const WEAPON_CATEGORY = 'weapon';

/** Profile ids follow the same convention as rig ids. */
export const WEAPON_PROFILE_ID_RE = RIG_ID_RE;

/**
 * Family ids are file base names (case preserved, e.g. "daggerL"). No list of
 * valid names exists on purpose — only the charset is constrained.
 */
export const WEAPON_FAMILY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * THE variant rule (spec §4): strip a single trailing `_cN` before ".png".
 * Same semantics as the generator scanner (vite-plugins/…-manifest.ts) —
 * greedy base, so "a_c2_c3.png" → family "a_c2", variant "c3".
 */
const WEAPON_FILE_VARIANT_RE = /^(.*)_c(\d+)\.png$/i;
const WEAPON_FILE_PNG_RE = /\.png$/i;
const WEAPON_ASSET_VARIANT_RE = /^(.*)_c(\d+)$/;

// ---------------------------------------------------------------- types

/** One concrete PNG (spec §30: WeaponVariant). */
export interface WeaponVariant {
  /** "default" | "c1" | "c2" | … */
  id: string;
  file: string;
  /** URL relative to the app base path. */
  url: string;
}

/** One discovered asset, flattened (spec §30: WeaponAssetManifestEntry). */
export interface WeaponAssetManifestEntry {
  /** Canonical id: familyId for default, `${familyId}_${variantId}` otherwise. */
  assetId: string;
  familyId: string;
  variantId: string;
  file: string;
  url: string;
}

/** Discovery + persisted association merged (spec §26/§30). */
export interface WeaponFamilyManifestEntry {
  familyId: string;
  displayName: string;
  defaultAssetId: string;
  variants: WeaponAssetManifestEntry[];
  weaponHitboxProfileId: string | null;
  /** true when a persisted WeaponFamilyConfig row exists. */
  configured: boolean;
}

/**
 * Persisted catalog row (spec §7). Discovery data (variants, urls) is NOT
 * persisted — it always comes fresh from the manifest scan; only explicit
 * admin choices live here.
 */
export interface WeaponFamilyConfig {
  familyId: string;
  displayName?: string;
  weaponHitboxProfileId: string | null;
  /**
   * Stats por ITEM da família (variante `default`, `c2`, …): levels dinâmicos
   * com dano e velocidade de animação. Ausente = o item usa o padrão implícito
   * (level 1, dano do perfil da família ou 10, velocidade 1×).
   */
  variants?: Record<string, WeaponVariantConfig>;
}

/** Um level de um item de arma: dano por hit + multiplicador de velocidade. */
export interface WeaponLevelStats {
  /** 1..N, contíguo (o level 1 sempre existe). */
  level: number;
  /** Dano por hit (inteiro, 0..1000). Padrão: 10. */
  damage: number;
  /** Multiplicador da velocidade da animação de ataque (0.1..10; 1 = padrão do jogo). */
  speed: number;
}

/** Levels de um item (variante) específico de uma família. */
export interface WeaponVariantConfig {
  levels: WeaponLevelStats[];
}

/** PUT payload for an association change (spec §30: ProfileAssociation). */
export interface ProfileAssociation {
  familyId: string;
  weaponHitboxProfileId: string | null;
}

/** Combat metadata reused from the rig contract (spec §19/§30: CombatConfig). */
export type CombatConfig = RigCombatConfig;

/** Hitbox-only frame entry (hurtboxes never live in a profile — spec §12). */
export interface WeaponHitboxFrameConfig {
  hitbox: RigBoxGroupConfig;
}

export interface WeaponProfileDirectionFrames {
  /** Keyed by LOCAL frame index inside the animation ("0", "1", …). */
  frames: Record<string, WeaponHitboxFrameConfig>;
}

/** Offensive geometry of one animation, shareable across families (spec §6). */
export interface WeaponHitboxProfile {
  schemaVersion: typeof WEAPON_PROFILE_SCHEMA_VERSION;
  id: string;
  displayName: string;
  rigId: string;
  animationId: string;
  combat: CombatConfig;
  directions: Partial<Record<RigDirection, WeaponProfileDirectionFrames>>;
}

/** Result of migrating legacy rig-level hitboxes (spec §17/§30). */
export interface ProfileMigrationResult {
  ok: boolean;
  errors: string[];
  /** Profiles to create (one per animation that carried hitboxes). */
  profiles: WeaponHitboxProfile[];
  /** animationId → new profile id (also the rig markers to set). */
  animationProfileIds: Record<string, string>;
  rectanglesFound: number;
  rectanglesCopied: number;
}

// ---------------------------------------------------------------- parsing

/**
 * Applies the `_cN` rule to a PNG file name (spec §4). Returns null for
 * non-PNG names. Never inspects the name for meaning (spec §5).
 */
export function parseWeaponFileName(
  file: string,
): { familyId: string; variantId: string } | null {
  if (!WEAPON_FILE_PNG_RE.test(file)) return null;
  const m = WEAPON_FILE_VARIANT_RE.exec(file);
  if (m) return { familyId: m[1], variantId: `c${parseInt(m[2], 10)}` };
  return { familyId: file.replace(WEAPON_FILE_PNG_RE, ''), variantId: 'default' };
}

/** Canonical asset id (same convention as the preview recipe). */
export function weaponAssetId(familyId: string, variantId: string): string {
  return variantId === 'default' ? familyId : `${familyId}_${variantId}`;
}

/** Inverse of weaponAssetId — resolves the family of any asset id. */
export function parseWeaponAssetId(assetId: string): { familyId: string; variantId: string } {
  const m = WEAPON_ASSET_VARIANT_RE.exec(assetId);
  if (m) return { familyId: m[1], variantId: `c${parseInt(m[2], 10)}` };
  return { familyId: assetId, variantId: 'default' };
}

// ---------------------------------------------------------------- defaults

export function emptyWeaponFrame(): WeaponHitboxFrameConfig {
  return { hitbox: emptyRigBoxGroup() };
}

/** Profiles exist to attack — combat starts enabled (rig hurt-only default differs). */
export function defaultWeaponCombat(): CombatConfig {
  return { enabled: true, damagePerHit: 10, singleHitPerTarget: true };
}

export function newWeaponProfileTemplate(
  id: string,
  displayName: string,
  rigId: string,
  animationId: string,
): WeaponHitboxProfile {
  return {
    schemaVersion: WEAPON_PROFILE_SCHEMA_VERSION,
    id,
    displayName,
    rigId,
    animationId,
    combat: defaultWeaponCombat(),
    directions: {},
  };
}

export function cloneWeaponProfile(profile: WeaponHitboxProfile): WeaponHitboxProfile {
  return JSON.parse(JSON.stringify(profile)) as WeaponHitboxProfile;
}

// ---------------------------------------------------------------- accessors

/** Frame entry of a profile; missing entries mean "no hitbox" (spec §18). */
export function getWeaponProfileFrame(
  profile: WeaponHitboxProfile,
  direction: RigDirection,
  localFrame: number,
): WeaponHitboxFrameConfig {
  const frame = profile.directions[direction]?.frames[String(localFrame)];
  return frame ?? emptyWeaponFrame();
}

export function getActiveWeaponHitboxRects(
  profile: WeaponHitboxProfile,
  direction: RigDirection,
  localFrame: number,
) {
  const frame = getWeaponProfileFrame(profile, direction, localFrame);
  return frame.hitbox.enabled ? frame.hitbox.rectangles : [];
}

/** Fills missing groups so consumers can rely on their presence (spec §24). */
export function normalizeWeaponFrameConfig(
  frame: Partial<WeaponHitboxFrameConfig> | undefined,
): WeaponHitboxFrameConfig {
  return { hitbox: frame?.hitbox ?? emptyRigBoxGroup() };
}

export function countWeaponProfileRects(profile: WeaponHitboxProfile): number {
  let count = 0;
  for (const dir of Object.values(profile.directions)) {
    if (!dir) continue;
    for (const frame of Object.values(dir.frames)) count += frame.hitbox.rectangles.length;
  }
  return count;
}

/** Family ids referencing a profile (for shared warnings, spec §15/§28). */
export function weaponFamiliesUsingProfile(
  families: Record<string, WeaponFamilyConfig>,
  profileId: string,
): string[] {
  return Object.values(families)
    .filter((f) => f.weaponHitboxProfileId === profileId)
    .map((f) => f.familyId)
    .sort();
}

// ---------------------------------------------------------------- resolution

/**
 * THE fallback chain (spec §18) — used by editor, Phaser and Colyseus alike:
 *   1. profile associated to the equipped weapon's family;
 *   2. rig's explicitly configured default profile;
 *   3. null (no hitbox, no damage — never "last weapon" or a random profile).
 */
export function resolveWeaponProfileId(
  family: WeaponFamilyConfig | null | undefined,
  rig: Pick<RigConfig, 'defaultWeaponHitboxProfileId'> | null | undefined,
): string | null {
  if (family && typeof family.weaponHitboxProfileId === 'string' && family.weaponHitboxProfileId.length > 0) {
    return family.weaponHitboxProfileId;
  }
  const rigDefault = rig?.defaultWeaponHitboxProfileId;
  return typeof rigDefault === 'string' && rigDefault.length > 0 ? rigDefault : null;
}

// ---------------------------------------------------------------- validation

export type WeaponProfileValidationResult =
  | { ok: true; config: WeaponHitboxProfile }
  | { ok: false; errors: string[] };

export type WeaponFamilyValidationResult =
  | { ok: true; config: WeaponFamilyConfig }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

const MAX_DAMAGE = 1000;

/**
 * Strict structural validation (spec §27). When `rig` is provided, also
 * cross-checks animation existence, direction compatibility and frame bounds.
 */
export function validateWeaponHitboxProfile(
  value: unknown,
  rig?: RigConfig | null,
): WeaponProfileValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['perfil deve ser um objeto JSON'] };

  if (value.schemaVersion !== WEAPON_PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion: esperado ${WEAPON_PROFILE_SCHEMA_VERSION}`);
  }
  if (typeof value.id !== 'string' || !WEAPON_PROFILE_ID_RE.test(value.id)) {
    errors.push('id: use minúsculas/números/hífens (2–64 caracteres)');
  }
  if (typeof value.displayName !== 'string' || value.displayName.trim().length === 0 || value.displayName.length > 80) {
    errors.push('displayName: obrigatório (até 80 caracteres)');
  }
  if (typeof value.rigId !== 'string' || !RIG_ID_RE.test(value.rigId)) {
    errors.push('rigId: obrigatório (perfil sem rig não é permitido)');
  }
  if (typeof value.animationId !== 'string' || !RIG_ANIMATION_NAME_RE.test(value.animationId)) {
    errors.push('animationId: obrigatório (perfil sem animação não é permitido)');
  }

  const combat = value.combat;
  if (!isRecord(combat)) {
    errors.push('combat: obrigatório ({ enabled, damagePerHit, singleHitPerTarget })');
  } else {
    if (typeof combat.enabled !== 'boolean') errors.push('combat.enabled: boolean obrigatório');
    if (!isInt(combat.damagePerHit) || combat.damagePerHit < 0 || combat.damagePerHit > MAX_DAMAGE) {
      errors.push(`combat.damagePerHit: inteiro 0–${MAX_DAMAGE}`);
    }
    if (typeof combat.singleHitPerTarget !== 'boolean') errors.push('combat.singleHitPerTarget: boolean obrigatório');
  }

  // Cross-checks against the rig (when available).
  let animFrameCount: number | null = null;
  if (rig && typeof value.animationId === 'string') {
    const frames = rig.animations[value.animationId];
    if (!frames) {
      errors.push(`animationId: animação "${value.animationId}" não existe no rig "${rig.rigId}"`);
    } else {
      animFrameCount = frames.length;
    }
    if (typeof value.rigId === 'string' && value.rigId !== rig.rigId) {
      errors.push(`rigId: perfil aponta para "${value.rigId}", mas o rig carregado é "${rig.rigId}"`);
    }
  }

  const directions = value.directions;
  if (!isRecord(directions)) {
    errors.push('directions: obrigatório (pode ser {})');
  } else {
    for (const [dirName, dirCfg] of Object.entries(directions)) {
      const dPath = `directions.${dirName}`;
      if (!(RIG_DIRECTION_NAMES as readonly string[]).includes(dirName)) {
        errors.push(`${dPath}: direção desconhecida (use ${RIG_DIRECTION_NAMES.join('/')})`);
        continue;
      }
      if (rig && !(dirName in rig.directions)) {
        errors.push(`${dPath}: direção incompatível — não existe no rig "${rig.rigId}"`);
      }
      if (!isRecord(dirCfg) || !isRecord(dirCfg.frames)) {
        errors.push(`${dPath}.frames: obrigatório (pode ser {})`);
        continue;
      }
      for (const [frameKey, frameCfg] of Object.entries(dirCfg.frames)) {
        const fPath = `${dPath}.frames.${frameKey}`;
        const idx = Number(frameKey);
        if (!/^\d+$/.test(frameKey) || !Number.isInteger(idx) || idx < 0) {
          errors.push(`${fPath}: índice de frame local inválido`);
        } else if (animFrameCount !== null && idx >= animFrameCount) {
          errors.push(`${fPath}: frame inexistente (animação tem ${animFrameCount} frames)`);
        }
        if (!isRecord(frameCfg)) {
          errors.push(`${fPath}: deve ser um objeto { hitbox }`);
          continue;
        }
        validateBoxGroup(frameCfg.hitbox, `${fPath}.hitbox`, errors);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: value as unknown as WeaponHitboxProfile };
}

// ---------------------------------------------------------------- item levels

export const DEFAULT_WEAPON_DAMAGE = 10;
/** 1 = velocidade padrão da animação de ataque no jogo (12 fps). */
export const DEFAULT_WEAPON_SPEED = 1;
export const WEAPON_VARIANT_ID_RE = /^(default|c[1-9][0-9]*)$/;

/** Level 1 implícito de todo item: dano padrão (ou do perfil) e velocidade 1×. */
export function defaultWeaponLevels(damage: number = DEFAULT_WEAPON_DAMAGE): WeaponLevelStats[] {
  return [{ level: 1, damage, speed: DEFAULT_WEAPON_SPEED }];
}

/**
 * Levels de um item: os salvos, ou o padrão implícito. `fallbackDamage` deixa
 * o chamador preservar o dano do perfil da família para itens não configurados
 * (evita renivelar famílias já ajustadas).
 */
export function getWeaponVariantLevels(
  family: { variants?: Record<string, WeaponVariantConfig> } | null | undefined,
  variantId: string,
  fallbackDamage: number = DEFAULT_WEAPON_DAMAGE,
): WeaponLevelStats[] {
  const levels = family?.variants?.[variantId]?.levels;
  return levels && levels.length > 0 ? levels : defaultWeaponLevels(fallbackDamage);
}

/** Stats de um item em um level: exato; senão o maior level ≤ pedido; senão o level 1. */
export function resolveWeaponLevelStats(
  family: { variants?: Record<string, WeaponVariantConfig> } | null | undefined,
  variantId: string,
  level: number,
  fallbackDamage: number = DEFAULT_WEAPON_DAMAGE,
): WeaponLevelStats {
  const levels = getWeaponVariantLevels(family, variantId, fallbackDamage);
  let best = levels[0];
  for (const entry of levels) {
    if (entry.level === level) return entry;
    if (entry.level < level && entry.level > best.level) best = entry;
  }
  return best;
}

export function validateWeaponFamilyConfig(value: unknown): WeaponFamilyValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config deve ser um objeto JSON'] };
  if (typeof value.familyId !== 'string' || !WEAPON_FAMILY_ID_RE.test(value.familyId)) {
    errors.push('familyId: inválido (letras/números/underscore/hífen, até 64 caracteres)');
  }
  if (value.displayName !== undefined && (typeof value.displayName !== 'string' || value.displayName.length > 80)) {
    errors.push('displayName: até 80 caracteres');
  }
  const profileId = value.weaponHitboxProfileId;
  if (profileId !== null && (typeof profileId !== 'string' || !WEAPON_PROFILE_ID_RE.test(profileId))) {
    errors.push('weaponHitboxProfileId: deve ser null ou um id de perfil válido');
  }
  const variants = value.variants;
  if (variants !== undefined) {
    if (!isRecord(variants)) {
      errors.push('variants: deve ser um objeto { variantId: { levels: [...] } }');
    } else if (Object.keys(variants).length > 64) {
      errors.push('variants: no máximo 64 itens');
    } else {
      for (const [variantId, raw] of Object.entries(variants)) {
        const where = `variants["${variantId}"]`;
        if (!WEAPON_VARIANT_ID_RE.test(variantId)) {
          errors.push(`${where}: id de item inválido (use "default" ou "cN")`);
          continue;
        }
        if (!isRecord(raw) || !Array.isArray(raw.levels)) {
          errors.push(`${where}.levels: deve ser uma lista de levels`);
          continue;
        }
        if (raw.levels.length === 0 || raw.levels.length > 99) {
          errors.push(`${where}.levels: entre 1 e 99 levels`);
          continue;
        }
        raw.levels.forEach((entry, i) => {
          const lw = `${where}.levels[${i}]`;
          if (!isRecord(entry)) {
            errors.push(`${lw}: deve ser um objeto {level, damage, speed}`);
            return;
          }
          if (entry.level !== i + 1) {
            errors.push(`${lw}.level: deve ser ${i + 1} (levels contíguos a partir do 1)`);
          }
          if (typeof entry.damage !== 'number' || !Number.isInteger(entry.damage) || entry.damage < 0 || entry.damage > 1000) {
            errors.push(`${lw}.damage: inteiro entre 0 e 1000`);
          }
          if (typeof entry.speed !== 'number' || !Number.isFinite(entry.speed) || entry.speed < 0.1 || entry.speed > 10) {
            errors.push(`${lw}.speed: número entre 0.1 e 10 (1 = padrão)`);
          }
        });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: value as unknown as WeaponFamilyConfig };
}

// ---------------------------------------------------------------- migration

/** Animations of a rig that still carry legacy (rig-level) hitbox rects. */
export function rigAnimationsWithLegacyHitboxes(rig: RigConfig): string[] {
  const result: string[] = [];
  for (const [animId, cfg] of Object.entries(rig.animationConfigs)) {
    let rects = 0;
    for (const dir of Object.values(cfg.directions)) {
      if (!dir) continue;
      for (const frame of Object.values(dir.frames)) rects += frame.hitbox.rectangles.length;
    }
    if (rects > 0) result.push(animId);
  }
  return result.sort();
}

function migrationProfileId(rigId: string, animationId: string, taken: Set<string>): string {
  let base = `migrated-${rigId}-${animationId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  base = base.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!WEAPON_PROFILE_ID_RE.test(base)) base = `migrated-profile`;
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Builds migration profiles from legacy rig-level hitboxes (spec §17).
 * PURE — does not mutate the rig and does not persist anything. The caller
 * creates the profiles, then marks each animation with `hitboxesMigratedTo`.
 * Legacy data is kept in the rig as backup until explicitly cleaned.
 */
export function buildWeaponMigration(
  rig: RigConfig,
  existingProfileIds: readonly string[],
): ProfileMigrationResult {
  const errors: string[] = [];
  const profiles: WeaponHitboxProfile[] = [];
  const animationProfileIds: Record<string, string> = {};
  const taken = new Set(existingProfileIds);
  let rectanglesFound = 0;
  let rectanglesCopied = 0;

  for (const animId of rigAnimationsWithLegacyHitboxes(rig)) {
    const cfg = rig.animationConfigs[animId];
    if (cfg.hitboxesMigratedTo) continue; // already migrated
    const id = migrationProfileId(rig.rigId, animId, taken);
    taken.add(id);

    const profile = newWeaponProfileTemplate(id, `Migrado — ${rig.displayName} / ${animId}`, rig.rigId, animId);
    profile.combat = cfg.combat
      ? (JSON.parse(JSON.stringify(cfg.combat)) as CombatConfig)
      : defaultRigCombat();

    for (const [dirName, dirCfg] of Object.entries(cfg.directions)) {
      if (!dirCfg) continue;
      const outFrames: Record<string, WeaponHitboxFrameConfig> = {};
      for (const [frameKey, frame] of Object.entries(dirCfg.frames)) {
        rectanglesFound += frame.hitbox.rectangles.length;
        if (frame.hitbox.rectangles.length === 0 && !frame.hitbox.enabled) continue;
        outFrames[frameKey] = {
          hitbox: JSON.parse(JSON.stringify(frame.hitbox)) as RigBoxGroupConfig,
        };
        rectanglesCopied += frame.hitbox.rectangles.length;
      }
      if (Object.keys(outFrames).length > 0) {
        profile.directions[dirName as RigDirection] = { frames: outFrames };
      }
    }

    // Validate the copy against the rig before accepting it (spec §17 step 4).
    const validated = validateWeaponHitboxProfile(JSON.parse(JSON.stringify(profile)), rig);
    if (!validated.ok) {
      errors.push(`Perfil de migração "${id}" inválido: ${validated.errors[0]}`);
      continue;
    }
    profiles.push(validated.config);
    animationProfileIds[animId] = id;
  }

  if (rectanglesFound !== rectanglesCopied) {
    errors.push(`Cópia incompleta: ${rectanglesCopied}/${rectanglesFound} retângulos copiados`);
  }

  return {
    ok: errors.length === 0,
    errors,
    profiles,
    animationProfileIds,
    rectanglesFound,
    rectanglesCopied,
  };
}

// ---------------------------------------------------------------- mirroring

/** West ↔ East mirroring of a profile frame (same math as the rig editor). */
export function mirrorWeaponFrameConfig(frame: WeaponHitboxFrameConfig): WeaponHitboxFrameConfig {
  return {
    hitbox: {
      enabled: frame.hitbox.enabled,
      rectangles: frame.hitbox.rectangles.map(mirrorRectAcrossOrigin),
    },
  };
}
