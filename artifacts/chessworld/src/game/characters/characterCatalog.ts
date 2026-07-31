/**
 * Character catalog — manifest + config driven (no hardcoded characters).
 *
 * `initCharacterSystem()` MUST be awaited before the Phaser game is created:
 * it fetches the generated manifest (backend Node scanner) and the saved
 * configs from Supabase, then builds runtime definitions for every valid
 * character. WorldScene reads everything through the helpers below.
 */
import { supabase } from '../../lib/supabase';
import {
  fetchCharacterManifest,
  assetUrl,
  type CharacterManifest,
  type CharacterManifestEntry,
  type CharacterManifestAsset,
} from './manifest';
import {
  type CharacterConfigV1,
  type Direction4,
  type Direction8,
  directionRowsFor,
  detectGrid,
  validateCharacterConfig,
  directionForVector,
} from '../../shared/combat/CharacterCombatShapes';

export type { Direction4, Direction8, CharacterConfigV1 };
export { directionForVector };

/** One selected spritesheet for a movement (walk, run, attack, ...). */
export interface MovementDef {
  movement: string;
  fileName: string;
  /** `<movement>/<fileName>` — the key used in the combat config. */
  assetKey: string;
  url: string;
  textureKey: string;
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
}

export interface WorldCharacterDef {
  id: string;
  displayName: string;
  folderName: string;
  directions: 4 | 8;
  directionRows: readonly Direction8[];
  movements: Map<string, MovementDef>;
  /** Sprite origin (0..1 of the frame). */
  originX: number;
  originY: number;
  /** Collision circle relative to the origin, in sprite pixels. */
  bodyOffsetX: number;
  bodyOffsetY: number;
  bodyRadius: number;
  /** Full combat config (null when none saved / combat disabled). */
  combat: CharacterConfigV1 | null;
  warnings: string[];
}

export interface CharacterSystemStatus {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

interface LegacyConfigRow {
  character_id: string;
  origin_x: number | null;
  origin_y: number | null;
  body_offset_x: number | null;
  body_offset_y: number | null;
  body_radius: number | null;
  config?: unknown;
}

const LS_SELECTED_KEY = 'chessworld.selectedCharacterId';
const LEGACY_CHARACTER_ID = 'test-character-01';
const LEGACY_MIGRATION_TARGET = 'character02';

const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };
const DEFAULT_BODY = { offsetX: 0, offsetY: 21, radius: 10 };

const defs = new Map<string, WorldCharacterDef>();
let manifestCache: CharacterManifest | null = null;
let status: CharacterSystemStatus = { ready: false, errors: [], warnings: [] };
let defaultCharacterId: string | null = null;
let selectedCharacterId: string | null = null;

export function textureKeyFor(charId: string, assetKey: string): string {
  return `charTex:${charId}:${assetKey}`;
}

export function animKeyFor(charId: string, movement: string, direction: string): string {
  return `char:${charId}:${movement}:${direction}`;
}

function readSelectedFromStorage(): string | null {
  try {
    return window.localStorage.getItem(LS_SELECTED_KEY);
  } catch {
    return null;
  }
}

function writeSelectedToStorage(id: string): void {
  try {
    window.localStorage.setItem(LS_SELECTED_KEY, id);
  } catch {
    /* private mode etc. — non-fatal */
  }
}

function buildMovementDef(
  charId: string,
  directions: 4 | 8,
  movement: string,
  asset: CharacterManifestAsset,
  combat: CharacterConfigV1 | null,
  warnings: string[],
): MovementDef | null {
  const assetKey = `${movement}/${asset.fileName}`;
  const override = combat?.assets[assetKey];
  let frameWidth: number;
  let frameHeight: number;
  let columns: number;

  if (override && override.manualGrid) {
    frameWidth = override.frameSize.width;
    frameHeight = override.frameSize.height;
    columns = override.columns;
  } else {
    const grid = detectGrid(asset.width, asset.height, directions);
    if (!grid.ok) {
      warnings.push(
        `Movement "${movement}" (${asset.fileName}) skipped: ${grid.problems.join('; ')} — set a manual grid override in /admin/characters`,
      );
      return null;
    }
    frameWidth = grid.frameWidth;
    frameHeight = grid.frameHeight;
    columns = grid.columns;
  }

  if (frameWidth <= 0 || frameHeight <= 0 || columns < 1) {
    warnings.push(`Movement "${movement}" (${asset.fileName}) skipped: invalid grid values`);
    return null;
  }

  return {
    movement,
    fileName: asset.fileName,
    assetKey,
    url: assetUrl(asset),
    textureKey: textureKeyFor(charId, assetKey),
    imageWidth: asset.width,
    imageHeight: asset.height,
    frameWidth,
    frameHeight,
    columns,
  };
}

function pickAssetForMovement(
  entry: CharacterManifestEntry,
  movement: string,
  combat: CharacterConfigV1 | null,
): CharacterManifestAsset | null {
  const assets = entry.movements[movement] ?? [];
  if (assets.length === 0) return null;
  if (combat) {
    // Prefer the PNG that has saved combat/grid data for this movement.
    for (const key of Object.keys(combat.assets)) {
      if (!key.startsWith(`${movement}/`)) continue;
      const fileName = key.slice(movement.length + 1);
      const match = assets.find((a) => a.fileName === fileName);
      if (match) return match;
    }
  }
  return assets[0];
}

function buildDef(
  entry: CharacterManifestEntry,
  row: LegacyConfigRow | null,
  combat: CharacterConfigV1 | null,
): WorldCharacterDef {
  const warnings: string[] = [...entry.warnings];
  const movements = new Map<string, MovementDef>();

  for (const movement of Object.keys(entry.movements).sort()) {
    const asset = pickAssetForMovement(entry, movement, combat);
    if (!asset) {
      warnings.push(`Movement folder "${movement}" is empty`);
      continue;
    }
    const def = buildMovementDef(entry.id, entry.directions, movement, asset, combat, warnings);
    if (def) movements.set(movement, def);
  }

  const originX = combat?.spriteOrigin.x ?? (row?.origin_x != null ? Number(row.origin_x) : DEFAULT_ORIGIN.x);
  const originY = combat?.spriteOrigin.y ?? (row?.origin_y != null ? Number(row.origin_y) : DEFAULT_ORIGIN.y);
  const bodyOffsetX =
    combat?.collisionBody.offsetX ?? (row?.body_offset_x != null ? Number(row.body_offset_x) : DEFAULT_BODY.offsetX);
  const bodyOffsetY =
    combat?.collisionBody.offsetY ?? (row?.body_offset_y != null ? Number(row.body_offset_y) : DEFAULT_BODY.offsetY);
  const bodyRadius =
    combat?.collisionBody.radius ?? (row?.body_radius != null ? Number(row.body_radius) : DEFAULT_BODY.radius);

  return {
    id: entry.id,
    displayName: entry.displayName,
    folderName: entry.folderName,
    directions: entry.directions,
    directionRows: directionRowsFor(entry.directions),
    movements,
    originX,
    originY,
    bodyOffsetX,
    bodyOffsetY,
    bodyRadius,
    combat,
    warnings,
  };
}

/**
 * Loads manifest + Supabase configs and builds every character definition.
 * Await this BEFORE creating the Phaser game.
 */
export async function initCharacterSystem(): Promise<CharacterSystemStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];
  defs.clear();

  let manifest: CharacterManifest | null = null;
  try {
    manifest = await fetchCharacterManifest();
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Failed to load character manifest');
  }
  manifestCache = manifest;

  const rows = new Map<string, LegacyConfigRow>();
  try {
    const { data, error } = await supabase.from('character_configs').select('*');
    if (error) {
      warnings.push(`character_configs load failed: ${error.message}`);
    } else {
      for (const row of (data ?? []) as LegacyConfigRow[]) {
        rows.set(row.character_id, row);
      }
    }
  } catch (err) {
    warnings.push(`character_configs load failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (manifest) {
    warnings.push(...manifest.warnings);
    for (const e of manifest.errors) {
      errors.push(e.message + (e.paths ? ` (${e.paths.join(', ')})` : ''));
    }

    for (const entry of manifest.characters) {
      let row = rows.get(entry.id) ?? null;
      // Safe legacy migration (in-memory): the old test-character-01 sheet now
      // lives under character02 — reuse its saved origin/body when character02
      // has no row of its own. Never overwrites anything.
      if (!row && entry.id === LEGACY_MIGRATION_TARGET) {
        const legacy = rows.get(LEGACY_CHARACTER_ID);
        if (legacy) {
          row = { ...legacy, character_id: entry.id };
          warnings.push(`Using legacy "${LEGACY_CHARACTER_ID}" origin/body values for ${entry.id} (in-memory)`);
        }
      }

      let combat: CharacterConfigV1 | null = null;
      const rawConfig = row?.config;
      if (rawConfig != null) {
        const parsed = typeof rawConfig === 'string' ? safeJsonParse(rawConfig) : rawConfig;
        const result = validateCharacterConfig(parsed);
        if (result.ok) {
          combat = result.config;
        } else {
          warnings.push(`Saved config for ${entry.id} is invalid and was ignored: ${result.errors[0]}`);
        }
      }

      const def = buildDef(entry, row, combat);
      if (def.movements.size === 0) {
        warnings.push(`Character ${entry.id} has no usable movements and was skipped`);
        continue;
      }
      defs.set(entry.id, def);
      warnings.push(...def.warnings.map((w) => `${entry.id}: ${w}`));
    }
  }

  // Default character: character02 (the migrated original) when available,
  // otherwise the first valid character.
  const ids = [...defs.keys()].sort();
  defaultCharacterId = defs.has(LEGACY_MIGRATION_TARGET) ? LEGACY_MIGRATION_TARGET : (ids[0] ?? null);

  const stored = readSelectedFromStorage();
  selectedCharacterId = stored && defs.has(stored) ? stored : defaultCharacterId;

  if (defs.size === 0) {
    errors.push('No valid characters found in assets/characters');
  }

  status = { ready: defs.size > 0, errors, warnings };
  if (errors.length > 0) console.error('[characters] init errors:', errors);
  if (warnings.length > 0) console.warn('[characters] init warnings:', warnings);
  return status;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getCharacterSystemStatus(): CharacterSystemStatus {
  return status;
}

export function getCharacterManifestCache(): CharacterManifest | null {
  return manifestCache;
}

export function listWorldCharacters(): WorldCharacterDef[] {
  return [...defs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getWorldCharacter(id: string | null | undefined): WorldCharacterDef | null {
  if (id && defs.has(id)) return defs.get(id)!;
  return defaultCharacterId ? (defs.get(defaultCharacterId) ?? null) : null;
}

export function getDefaultCharacterId(): string | null {
  return defaultCharacterId;
}

export function getSelectedCharacterId(): string | null {
  return selectedCharacterId ?? defaultCharacterId;
}

export function setSelectedCharacterId(id: string): boolean {
  if (!defs.has(id)) return false;
  selectedCharacterId = id;
  writeSelectedToStorage(id);
  return true;
}

export function getSelectedCharacter(): WorldCharacterDef | null {
  return getWorldCharacter(getSelectedCharacterId());
}

/** Next valid character in the sorted cycle (for the dev switch button). */
export function nextCharacterId(currentId: string | null): string | null {
  const ids = [...defs.keys()].sort();
  if (ids.length === 0) return null;
  if (!currentId) return ids[0];
  const idx = ids.indexOf(currentId);
  return ids[(idx + 1) % ids.length];
}

/** Movement lookup with the spec fallback chain: requested → walk → idle → first. */
export function movementOrFallback(def: WorldCharacterDef, requested: string): MovementDef | null {
  return (
    def.movements.get(requested) ??
    def.movements.get('walk') ??
    def.movements.get('idle') ??
    def.movements.values().next().value ??
    null
  );
}

/** Row index of a direction inside the character's sheet (with graceful fallback). */
export function rowIndexFor(def: WorldCharacterDef, direction: string): number {
  const idx = def.directionRows.indexOf(direction as Direction8);
  if (idx >= 0) return idx;
  // A diagonal direction arriving for a 4-direction character (or bad data):
  // collapse to the nearest cardinal, else row 0.
  const fallback: Record<string, Direction4> = {
    'down-right': 'right',
    'down-left': 'left',
    'up-right': 'right',
    'up-left': 'left',
  };
  const mapped = fallback[direction];
  const mappedIdx = mapped ? def.directionRows.indexOf(mapped) : -1;
  return mappedIdx >= 0 ? mappedIdx : 0;
}

/** First frame (global sheet index) of a movement row — used as the idle/frozen pose. */
export function firstFrameIndexFor(def: WorldCharacterDef, movementDef: MovementDef, direction: string): number {
  return rowIndexFor(def, direction) * movementDef.columns;
}
