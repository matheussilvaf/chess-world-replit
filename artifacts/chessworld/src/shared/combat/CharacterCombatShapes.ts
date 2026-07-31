/**
 * Shared combat geometry + character config schema.
 *
 * KEEP IN SYNC — 3 byte-identical copies (no Phaser/Colyseus/Supabase deps):
 *   - artifacts/chessworld/src/shared/combat/CharacterCombatShapes.ts  (client)
 *   - server/src/shared/combat/CharacterCombatShapes.ts                (Colyseus Cloud)
 *   - artifacts/api-server/src/src/shared/combat/CharacterCombatShapes.ts (local mirror)
 *
 * All box coordinates are in ORIGINAL sprite pixels, RELATIVE TO THE SPRITE
 * ORIGIN (not the frame's top-left corner and never preview/DOM pixels).
 */

export type Direction4 = 'down' | 'left' | 'right' | 'up';
export type Direction8 =
  | 'down'
  | 'down-right'
  | 'right'
  | 'up-right'
  | 'up'
  | 'up-left'
  | 'left'
  | 'down-left';

/** Mandatory spritesheet row order for 4-direction characters. */
export const DIRECTION_ROWS_4: readonly Direction4[] = ['down', 'left', 'right', 'up'];
/** Mandatory spritesheet row order for 8-direction characters. */
export const DIRECTION_ROWS_8: readonly Direction8[] = [
  'down',
  'down-right',
  'right',
  'up-right',
  'up',
  'up-left',
  'left',
  'down-left',
];

export function directionRowsFor(directions: 4 | 8): readonly Direction8[] {
  return (directions === 4 ? DIRECTION_ROWS_4 : DIRECTION_ROWS_8) as readonly Direction8[];
}

/** Axis-aligned rectangle in local (origin-relative) sprite pixels. */
export interface LocalRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned rectangle in world pixels. */
export interface WorldRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxGroupConfig {
  enabled: boolean;
  rectangles: LocalRectangle[];
}

export interface CombatFrameConfig {
  hurtbox: BoxGroupConfig;
  hitbox: BoxGroupConfig;
}

export interface SpriteOriginConfig {
  x: number; // 0..1 fraction of frame width
  y: number; // 0..1 fraction of frame height
}

export interface CollisionBodyConfig {
  shape: 'circle';
  offsetX: number; // px relative to origin
  offsetY: number; // px relative to origin
  radius: number;  // px
}

export interface AssetDirectionConfig {
  frames: Record<string, CombatFrameConfig>;
}

export interface CharacterAssetConfig {
  frameSize: { width: number; height: number };
  /** Frames per direction row (= column count of the sheet). */
  columns: number;
  /** True when the automatic square-frame detection failed and the values above are a manual override. */
  manualGrid?: boolean;
  directionOrder: Direction8[];
  directions: Record<string, AssetDirectionConfig>;
}

export interface CharacterConfigV1 {
  schemaVersion: 1;
  characterId: string;
  sourceFolder: string;
  directions: 4 | 8;
  spriteOrigin: SpriteOriginConfig;
  collisionBody: CollisionBodyConfig;
  combatBoxesEnabled: boolean;
  /** Keyed by `<movement>/<fileName>`, e.g. `attack/Attack.png`. */
  assets: Record<string, CharacterAssetConfig>;
}

export const EMPTY_FRAME_CONFIG: CombatFrameConfig = {
  hurtbox: { enabled: false, rectangles: [] },
  hitbox: { enabled: false, rectangles: [] },
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function rectanglesIntersect(a: WorldRectangle, b: WorldRectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Converts an origin-relative local rectangle to world coordinates, given the
 * world position of the sprite origin and the sprite scale.
 */
export function localShapeToWorldCoordinates(
  rect: LocalRectangle,
  originWorldX: number,
  originWorldY: number,
  scale = 1,
): WorldRectangle {
  return {
    x: originWorldX + rect.x * scale,
    y: originWorldY + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/**
 * Picks the visual direction for a movement vector.
 * 4 directions: |dx|>|dy| chooses left/right, otherwise up/down (spec rule).
 * 8 directions: 45° angular sectors.
 */
export function directionForVector(directions: 4 | 8, dx: number, dy: number): Direction8 {
  if (directions === 4) {
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle >= -22.5 && angle < 22.5) return 'right';
  if (angle >= 22.5 && angle < 67.5) return 'down-right';
  if (angle >= 67.5 && angle < 112.5) return 'down';
  if (angle >= 112.5 && angle < 157.5) return 'down-left';
  if (angle >= 157.5 || angle < -157.5) return 'left';
  if (angle >= -157.5 && angle < -112.5) return 'up-left';
  if (angle >= -112.5 && angle < -67.5) return 'up';
  return 'up-right';
}

// ---------------------------------------------------------------------------
// Grid detection (square-frame rule)
// ---------------------------------------------------------------------------

export interface GridDetection {
  ok: boolean;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  problems: string[];
}

export function detectGrid(imageWidth: number, imageHeight: number, directions: 4 | 8): GridDetection {
  const problems: string[] = [];
  const rowCount = directions;
  const frameHeight = imageHeight / rowCount;
  if (!Number.isInteger(frameHeight)) {
    problems.push(`imageHeight ${imageHeight} is not divisible by ${rowCount} rows`);
  }
  const frameWidth = frameHeight; // main rule: square frames
  const columns = imageWidth / frameWidth;
  if (!Number.isInteger(columns) || columns < 1) {
    problems.push(`imageWidth ${imageWidth} is not divisible by frame width ${frameWidth}`);
  }
  return {
    ok: problems.length === 0,
    frameWidth: Math.floor(frameWidth),
    frameHeight: Math.floor(frameHeight),
    columns: Math.max(1, Math.floor(columns)),
    problems,
  };
}

// ---------------------------------------------------------------------------
// Config access helpers
// ---------------------------------------------------------------------------

export function getFrameCombat(
  config: CharacterConfigV1 | null | undefined,
  assetKey: string,
  direction: string,
  frameIndex: number,
): CombatFrameConfig {
  if (!config || !config.combatBoxesEnabled) return EMPTY_FRAME_CONFIG;
  const frame = config.assets[assetKey]?.directions[direction]?.frames[String(frameIndex)];
  return frame ?? EMPTY_FRAME_CONFIG;
}

export function getActiveHitboxRects(
  config: CharacterConfigV1 | null | undefined,
  assetKey: string,
  direction: string,
  frameIndex: number,
): LocalRectangle[] {
  const frame = getFrameCombat(config, assetKey, direction, frameIndex);
  return frame.hitbox.enabled ? frame.hitbox.rectangles : [];
}

export function getActiveHurtboxRects(
  config: CharacterConfigV1 | null | undefined,
  assetKey: string,
  direction: string,
  frameIndex: number,
): LocalRectangle[] {
  const frame = getFrameCombat(config, assetKey, direction, frameIndex);
  return frame.hurtbox.enabled ? frame.hurtbox.rectangles : [];
}

/**
 * Union of every enabled hurtbox rectangle across all frames of a
 * movement+direction. The server uses this as the target's damageable area
 * approximation (it cannot know the exact visual frame of a remote client).
 */
export function unionHurtboxRects(
  config: CharacterConfigV1 | null | undefined,
  assetKey: string,
  direction: string,
): LocalRectangle[] {
  if (!config || !config.combatBoxesEnabled) return [];
  const dir = config.assets[assetKey]?.directions[direction];
  if (!dir) return [];
  const rects: LocalRectangle[] = [];
  for (const frame of Object.values(dir.frames)) {
    if (frame.hurtbox.enabled) rects.push(...frame.hurtbox.rectangles);
  }
  return rects;
}

/** Frames-with-hitbox timeline for an attack asset+direction: sorted frame indices. */
export function hitboxFrameIndices(
  config: CharacterConfigV1 | null | undefined,
  assetKey: string,
  direction: string,
): number[] {
  if (!config || !config.combatBoxesEnabled) return [];
  const dir = config.assets[assetKey]?.directions[direction];
  if (!dir) return [];
  return Object.entries(dir.frames)
    .filter(([, f]) => f.hitbox.enabled && f.hitbox.rectangles.length > 0)
    .map(([idx]) => parseInt(idx, 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Strict validation (shared by editor save + server load)
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; config: CharacterConfigV1 }
  | { ok: false; errors: string[] };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateRect(r: unknown, where: string, errors: string[]): void {
  if (typeof r !== 'object' || r === null) {
    errors.push(`${where}: rectangle must be an object`);
    return;
  }
  const rect = r as Record<string, unknown>;
  for (const k of ['x', 'y', 'width', 'height']) {
    if (!isFiniteNumber(rect[k])) errors.push(`${where}: "${k}" must be a finite number`);
  }
  if (isFiniteNumber(rect.width) && rect.width <= 0) errors.push(`${where}: width must be > 0`);
  if (isFiniteNumber(rect.height) && rect.height <= 0) errors.push(`${where}: height must be > 0`);
}

function validateBoxGroup(g: unknown, where: string, errors: string[]): void {
  if (typeof g !== 'object' || g === null) {
    errors.push(`${where}: must be an object`);
    return;
  }
  const group = g as Record<string, unknown>;
  if (typeof group.enabled !== 'boolean') errors.push(`${where}: "enabled" must be boolean`);
  if (!Array.isArray(group.rectangles)) {
    errors.push(`${where}: "rectangles" must be an array`);
    return;
  }
  group.rectangles.forEach((r, i) => validateRect(r, `${where}.rectangles[${i}]`, errors));
}

export function validateCharacterConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['config must be an object'] };
  }
  const c = input as Record<string, unknown>;

  if (c.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof c.characterId !== 'string' || !/^character\d{2,4}$/.test(c.characterId)) {
    errors.push('characterId must match ^character\\d{2,4}$');
  }
  if (typeof c.sourceFolder !== 'string' || c.sourceFolder.length === 0) {
    errors.push('sourceFolder must be a non-empty string');
  }
  if (c.directions !== 4 && c.directions !== 8) errors.push('directions must be 4 or 8');

  const origin = c.spriteOrigin as Record<string, unknown> | undefined;
  if (!origin || !isFiniteNumber(origin.x) || !isFiniteNumber(origin.y)) {
    errors.push('spriteOrigin.x/y must be finite numbers');
  } else if (origin.x < 0 || origin.x > 1 || origin.y < 0 || origin.y > 1) {
    errors.push('spriteOrigin values must be between 0 and 1');
  }

  const body = c.collisionBody as Record<string, unknown> | undefined;
  if (!body || body.shape !== 'circle') {
    errors.push('collisionBody.shape must be "circle"');
  } else {
    if (!isFiniteNumber(body.offsetX) || !isFiniteNumber(body.offsetY)) {
      errors.push('collisionBody offsets must be finite numbers');
    }
    if (!isFiniteNumber(body.radius) || (body.radius as number) <= 0) {
      errors.push('collisionBody.radius must be > 0');
    }
  }

  if (typeof c.combatBoxesEnabled !== 'boolean') errors.push('combatBoxesEnabled must be boolean');

  const validDirections =
    c.directions === 4 || c.directions === 8
      ? new Set<string>(directionRowsFor(c.directions as 4 | 8))
      : new Set<string>();

  if (typeof c.assets !== 'object' || c.assets === null) {
    errors.push('assets must be an object');
  } else {
    for (const [assetKey, assetRaw] of Object.entries(c.assets as Record<string, unknown>)) {
      const where = `assets["${assetKey}"]`;
      if (typeof assetRaw !== 'object' || assetRaw === null) {
        errors.push(`${where}: must be an object`);
        continue;
      }
      const asset = assetRaw as Record<string, unknown>;
      const fs = asset.frameSize as Record<string, unknown> | undefined;
      if (!fs || !isFiniteNumber(fs.width) || !isFiniteNumber(fs.height) || (fs.width as number) <= 0 || (fs.height as number) <= 0) {
        errors.push(`${where}.frameSize width/height must be > 0`);
      }
      if (!isFiniteNumber(asset.columns) || (asset.columns as number) < 1 || !Number.isInteger(asset.columns)) {
        errors.push(`${where}.columns must be a positive integer`);
      }
      if (!Array.isArray(asset.directionOrder)) {
        errors.push(`${where}.directionOrder must be an array`);
      }
      if (typeof asset.directions !== 'object' || asset.directions === null) {
        errors.push(`${where}.directions must be an object`);
        continue;
      }
      for (const [dirName, dirRaw] of Object.entries(asset.directions as Record<string, unknown>)) {
        const dwhere = `${where}.directions["${dirName}"]`;
        if (validDirections.size > 0 && !validDirections.has(dirName)) {
          errors.push(`${dwhere}: invalid direction for a ${c.directions}-direction character`);
          continue;
        }
        const dir = dirRaw as Record<string, unknown>;
        if (typeof dir !== 'object' || dir === null || typeof dir.frames !== 'object' || dir.frames === null) {
          errors.push(`${dwhere}.frames must be an object`);
          continue;
        }
        for (const [frameIdx, frameRaw] of Object.entries(dir.frames as Record<string, unknown>)) {
          const fwhere = `${dwhere}.frames["${frameIdx}"]`;
          if (!/^\d+$/.test(frameIdx)) {
            errors.push(`${fwhere}: frame index must be a non-negative integer`);
            continue;
          }
          const frame = frameRaw as Record<string, unknown>;
          if (typeof frame !== 'object' || frame === null) {
            errors.push(`${fwhere}: must be an object`);
            continue;
          }
          validateBoxGroup(frame.hurtbox, `${fwhere}.hurtbox`, errors);
          validateBoxGroup(frame.hitbox, `${fwhere}.hitbox`, errors);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: input as unknown as CharacterConfigV1 };
}

/** Safe default config for a character with no saved configuration. */
export function defaultCharacterConfig(
  characterId: string,
  sourceFolder: string,
  directions: 4 | 8,
): CharacterConfigV1 {
  return {
    schemaVersion: 1,
    characterId,
    sourceFolder,
    directions,
    spriteOrigin: { x: 0.5, y: 0.5 },
    collisionBody: { shape: 'circle', offsetX: 0, offsetY: 21, radius: 10 },
    combatBoxesEnabled: false,
    assets: {},
  };
}
