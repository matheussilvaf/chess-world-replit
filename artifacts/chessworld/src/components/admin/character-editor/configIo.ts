/**
 * Supabase persistence for the character editor.
 *
 * Storage strategy: the FULL config JSON lives in the `config` jsonb column of
 * `character_configs`; the legacy columns (origin_x/y, body_offset_x/y,
 * body_radius) are kept in sync because the game and older rows still read
 * them. When the jsonb column doesn't exist yet (error 42703) we fall back to
 * legacy-only saves and the UI shows the SQL the user must run.
 */
import { supabase } from '../../../lib/supabase';
import {
  defaultCharacterConfig,
  detectGrid,
  directionRowsFor,
  validateCharacterConfig,
  type CharacterConfigV1,
  type Direction8,
} from '../../../shared/combat/CharacterCombatShapes';
import type { CharacterManifestEntry } from '../../../game/characters/manifest';

export const CONFIG_COLUMN_SQL =
  'ALTER TABLE character_configs ADD COLUMN IF NOT EXISTS config jsonb;';
export const SWITCH_FLAG_SQL =
  'ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS character_switch_enabled boolean NOT NULL DEFAULT false;';

export interface ConfigRow {
  character_id: string;
  origin_x: number | null;
  origin_y: number | null;
  body_offset_x: number | null;
  body_offset_y: number | null;
  body_radius: number | null;
  config?: unknown;
}

export interface LoadedConfigs {
  rows: Map<string, ConfigRow>;
  configColumnMissing: boolean;
  loadError: string | null;
}

/** Loads every saved row + detects whether the jsonb `config` column exists. */
export async function loadAllConfigRows(): Promise<LoadedConfigs> {
  const probe = await supabase.from('character_configs').select('config').limit(1);
  const configColumnMissing = probe.error?.code === '42703';

  const { data, error } = await supabase.from('character_configs').select('*');
  const rows = new Map<string, ConfigRow>();
  if (data) {
    for (const row of data as ConfigRow[]) rows.set(row.character_id, row);
  }
  return { rows, configColumnMissing, loadError: error ? error.message : null };
}

export interface WorkingConfigResult {
  config: CharacterConfigV1;
  issues: string[];
}

/**
 * Builds the editable config for a character: the saved jsonb config when it
 * validates, otherwise defaults seeded with the legacy columns. Manifest facts
 * (id / folder / directions) always win over whatever is stored.
 */
export function buildWorkingConfig(
  entry: CharacterManifestEntry,
  row: ConfigRow | undefined,
): WorkingConfigResult {
  const issues: string[] = [];
  let config: CharacterConfigV1 | null = null;

  if (row && row.config != null) {
    const validated = validateCharacterConfig(row.config);
    if (validated.ok) {
      config = validated.config;
    } else {
      issues.push(
        `Config salva estava inválida e foi ignorada (${validated.errors.length} erro(s)): ` +
          `${validated.errors.slice(0, 3).join('; ')}${validated.errors.length > 3 ? '…' : ''}`,
      );
    }
  }

  if (!config) {
    config = defaultCharacterConfig(entry.id, entry.folderName, entry.directions);
    if (row) {
      if (typeof row.origin_x === 'number') config.spriteOrigin.x = row.origin_x;
      if (typeof row.origin_y === 'number') config.spriteOrigin.y = row.origin_y;
      if (typeof row.body_offset_x === 'number') config.collisionBody.offsetX = row.body_offset_x;
      if (typeof row.body_offset_y === 'number') config.collisionBody.offsetY = row.body_offset_y;
      if (typeof row.body_radius === 'number') config.collisionBody.radius = row.body_radius;
    }
  }

  // Manifest is the source of truth for identity/structure.
  config.characterId = entry.id;
  config.sourceFolder = entry.folderName;
  if (config.directions !== entry.directions) {
    if (Object.keys(config.assets).length > 0) {
      issues.push(
        `As direções mudaram de ${config.directions} para ${entry.directions} — revise as caixas salvas.`,
      );
    }
    config.directions = entry.directions;
  }
  return { config, issues };
}

/**
 * Creates the per-asset grid entry (frame size / columns) when missing, using
 * the square-frame auto-detection. Returns the SAME object when nothing to do.
 */
export function ensureAssetConfig(
  config: CharacterConfigV1,
  assetKey: string,
  imageWidth: number,
  imageHeight: number,
): { config: CharacterConfigV1; problems: string[] } {
  if (config.assets[assetKey]) return { config, problems: [] };
  const detection = detectGrid(imageWidth, imageHeight, config.directions);
  const next: CharacterConfigV1 = {
    ...config,
    assets: {
      ...config.assets,
      [assetKey]: {
        frameSize: { width: detection.frameWidth, height: detection.frameHeight },
        columns: detection.columns,
        manualGrid: !detection.ok,
        directionOrder: [...directionRowsFor(config.directions)] as Direction8[],
        directions: {},
      },
    },
  };
  return { config: next, problems: detection.problems };
}

export interface SaveResult {
  ok: boolean;
  configColumnMissing: boolean;
  error: string | null;
}

/** Persists config jsonb + legacy columns (legacy-only fallback on 42703). */
export async function saveCharacterConfig(config: CharacterConfigV1): Promise<SaveResult> {
  const legacy = {
    character_id: config.characterId,
    origin_x: config.spriteOrigin.x,
    origin_y: config.spriteOrigin.y,
    body_offset_x: config.collisionBody.offsetX,
    body_offset_y: config.collisionBody.offsetY,
    body_radius: config.collisionBody.radius,
    updated_at: new Date().toISOString(),
  };

  const full = await supabase
    .from('character_configs')
    .upsert({ ...legacy, config }, { onConflict: 'character_id' });

  if (!full.error) return { ok: true, configColumnMissing: false, error: null };

  if (full.error.code === '42703') {
    const legacyOnly = await supabase
      .from('character_configs')
      .upsert(legacy, { onConflict: 'character_id' });
    return {
      ok: !legacyOnly.error,
      configColumnMissing: true,
      error: legacyOnly.error ? legacyOnly.error.message : null,
    };
  }
  return { ok: false, configColumnMissing: false, error: full.error.message };
}

/**
 * Durable one-time migration: the old hardcoded `test-character-01` row seeds
 * `character02` (same spritesheet, new folder layout) when the latter has no
 * row yet. Returns true when a row was written.
 */
export async function migrateLegacyRowIfNeeded(
  rows: Map<string, ConfigRow>,
  manifestIds: string[],
): Promise<boolean> {
  const legacy = rows.get('test-character-01');
  if (!legacy || !manifestIds.includes('character02') || rows.has('character02')) return false;
  const { error } = await supabase.from('character_configs').upsert(
    {
      character_id: 'character02',
      origin_x: legacy.origin_x,
      origin_y: legacy.origin_y,
      body_offset_x: legacy.body_offset_x,
      body_offset_y: legacy.body_offset_y,
      body_radius: legacy.body_radius,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'character_id' },
  );
  if (error) {
    console.warn('[CharacterEditor] Migração test-character-01 → character02 falhou:', error.message);
  }
  return !error;
}
