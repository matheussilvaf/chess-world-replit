/**
 * RigShapes — shared contract for Character Rigs (schemaVersion 2).
 *
 * A RIG describes physics/combat structure ONLY (sheet grid, directions,
 * animation frame maps, sprite origin, collision body, per-animation
 * hurt/hitboxes + damage metadata). Player APPEARANCE (generated PNG, layers,
 * skin tone) lives elsewhere and never moves rig boxes.
 *
 * This file is mirrored byte-identical in:
 *   - artifacts/chessworld/src/shared/combat/RigShapes.ts   (client)
 *   - server/src/shared/combat/RigShapes.ts                 (Colyseus server)
 *   - artifacts/api-server/src/src/shared/combat/RigShapes.ts
 * Keep it free of Phaser/DOM/Node dependencies.
 *
 * Coordinate contract (see spec §25):
 *   - Box rectangles are stored in ORIGINAL frame pixels (96×96 for the
 *     initial rig), RELATIVE TO THE SPRITE ORIGIN. Never canvas/CSS pixels.
 *   - `origin` is a 0..1 fraction of the frame.
 *   - `collisionBody` offsets/radius are frame pixels relative to the origin.
 */

// ---------------------------------------------------------------- constants

export const RIG_SCHEMA_VERSION = 2 as const;

/** Initial (and, for now, only) rig every generated character points at. */
export const DEFAULT_RIG_ID = 'time-elements-humanoid-v1';

export const RIG_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const RIG_ANIMATION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Direction names for 4-direction rigs (sheet rows 0..3, fixed order). */
export const RIG_DIRECTION_NAMES = ['south', 'west', 'east', 'north'] as const;
export type RigDirection = (typeof RIG_DIRECTION_NAMES)[number];

/** West ↔ East (used by the mirror-copy tools). South/North have no opposite. */
export const RIG_OPPOSITE_DIRECTION: Partial<Record<RigDirection, RigDirection>> = {
  west: 'east',
  east: 'west',
};

// ---------------------------------------------------------------- types

/** Axis-aligned rectangle in origin-relative frame pixels. */
export interface LocalRectangle {
  id: string;
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

export interface RigSheetConfig {
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

/** Sprite anchor as a 0..1 fraction of the frame. Global per rig. */
export interface SpriteOriginConfig {
  x: number;
  y: number;
}

/** Map/obstacle collision circle, relative to the origin. Global per rig. */
export interface CollisionBodyConfig {
  shape: 'circle';
  offsetX: number;
  offsetY: number;
  radius: number;
}

export interface RigBoxGroupConfig {
  enabled: boolean;
  rectangles: LocalRectangle[];
}
export type HurtboxConfig = RigBoxGroupConfig;
export type HitboxConfig = RigBoxGroupConfig;

/** Boxes of one local frame of one direction of one animation. */
export interface RigFrameConfig {
  hurtbox: HurtboxConfig;
  hitbox: HitboxConfig;
}

/** Damage metadata of one animation (server is the damage authority). */
export interface RigCombatConfig {
  enabled: boolean;
  damagePerHit: number;
  singleHitPerTarget: boolean;
}

export interface RigDirectionFrames {
  /** Keyed by LOCAL frame index inside the animation ("0", "1", …). */
  frames: Record<string, RigFrameConfig>;
}

export interface RigAnimationConfig {
  combat: RigCombatConfig;
  directions: Partial<Record<RigDirection, RigDirectionFrames>>;
}

/** Sheet columns played by an animation, in play order. */
export type RigAnimationDefinition = number[];

/**
 * Cosmetic-only preview recipe stored for admin convenience
 * (e.g. { "top": "top25_c2", "skinTone": "tone2" }). Never affects boxes.
 */
export type PreviewAppearanceRecipe = Record<string, string>;

export interface RigConfig {
  schemaVersion: typeof RIG_SCHEMA_VERSION;
  rigId: string;
  displayName: string;
  sheet: RigSheetConfig;
  /** Direction name → sheet row. */
  directions: Partial<Record<RigDirection, number>>;
  /** Animation name → sheet columns (play order). */
  animations: Record<string, RigAnimationDefinition>;
  origin: SpriteOriginConfig;
  collisionBody: CollisionBodyConfig;
  previewAppearance: PreviewAppearanceRecipe;
  animationConfigs: Record<string, RigAnimationConfig>;
}

// ---------------------------------------------------------------- defaults

export function emptyRigBoxGroup(): RigBoxGroupConfig {
  return { enabled: false, rectangles: [] };
}

export function emptyRigFrame(): RigFrameConfig {
  return { hurtbox: emptyRigBoxGroup(), hitbox: emptyRigBoxGroup() };
}

export function defaultRigCombat(): RigCombatConfig {
  return { enabled: false, damagePerHit: 10, singleHitPerTarget: true };
}

/**
 * Animation map of the initial humanoid rig — SAME mapping as the current
 * Character Generator (spec §9). Kebab-case names are the persisted contract.
 * No Dash (out of scope).
 */
export const DEFAULT_RIG_ANIMATIONS: Record<string, RigAnimationDefinition> = {
  stand: [1],
  // Walk plays 1st → 2nd → 3rd → back to middle, then repeats.
  walk: [0, 1, 2, 1],
  'arms-up': [3, 4, 5],
  crouch: [6],
  jump: [7, 8, 9],
  'wind-up': [10],
  attack: [11, 12, 13],
  'attack-full': [10, 11, 12, 13, 14],
  knock: [15],
  bow: [15, 16, 17],
  'knock-and-bow': [15, 16, 17, 18],
  climb: [18, 19, 20],
  sleep: [21],
  dead: [22],
};

/** The initial rig (spec §3): 2208×384, 96×96 frames, 23 columns, 4 rows. */
export function defaultRigConfig(): RigConfig {
  return {
    schemaVersion: RIG_SCHEMA_VERSION,
    rigId: DEFAULT_RIG_ID,
    displayName: 'Time Elements Humanoid V1',
    sheet: { width: 2208, height: 384, frameWidth: 96, frameHeight: 96, columns: 23, rows: 4 },
    directions: { south: 0, west: 1, east: 2, north: 3 },
    animations: JSON.parse(JSON.stringify(DEFAULT_RIG_ANIMATIONS)) as Record<string, RigAnimationDefinition>,
    origin: { x: 0.5, y: 0.5 },
    collisionBody: { shape: 'circle', offsetX: 0, offsetY: 15, radius: 10 },
    previewAppearance: {},
    animationConfigs: {},
  };
}

/** Fresh rig template for "Novo Rig" (same sheet layout, no boxes). */
export function newRigTemplate(rigId: string, displayName: string): RigConfig {
  const rig = defaultRigConfig();
  rig.rigId = rigId;
  rig.displayName = displayName;
  return rig;
}

export function cloneRigConfig(rig: RigConfig): RigConfig {
  return JSON.parse(JSON.stringify(rig)) as RigConfig;
}

// ---------------------------------------------------------------- validation

export type RigValidationResult =
  | { ok: true; config: RigConfig }
  | { ok: false; errors: string[] };

const MAX_RECTANGLES_PER_GROUP = 32;
const MAX_BOX_COORD = 1024;
const MAX_DAMAGE = 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isInt(v: unknown): v is number {
  return finite(v) && Number.isInteger(v);
}

function validateRectangle(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: retângulo deve ser um objeto`);
    return;
  }
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 64) {
    errors.push(`${path}.id: id obrigatório (string de 1–64 caracteres)`);
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!finite(v[key])) errors.push(`${path}.${key}: número inválido (NaN/Infinity não são aceitos)`);
  }
  if (finite(v.width) && v.width <= 0) errors.push(`${path}.width: deve ser > 0`);
  if (finite(v.height) && v.height <= 0) errors.push(`${path}.height: deve ser > 0`);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (finite(v[key]) && Math.abs(v[key]) > MAX_BOX_COORD) {
      errors.push(`${path}.${key}: fora do limite (±${MAX_BOX_COORD}px)`);
    }
  }
}

function validateBoxGroup(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: deve ser um objeto { enabled, rectangles }`);
    return;
  }
  if (typeof v.enabled !== 'boolean') errors.push(`${path}.enabled: deve ser boolean`);
  if (!Array.isArray(v.rectangles)) {
    errors.push(`${path}.rectangles: deve ser uma lista`);
    return;
  }
  if (v.rectangles.length > MAX_RECTANGLES_PER_GROUP) {
    errors.push(`${path}.rectangles: máximo de ${MAX_RECTANGLES_PER_GROUP} retângulos`);
  }
  const ids = new Set<string>();
  v.rectangles.forEach((r, i) => {
    validateRectangle(r, `${path}.rectangles[${i}]`, errors);
    if (isRecord(r) && typeof r.id === 'string') {
      if (ids.has(r.id)) errors.push(`${path}.rectangles[${i}].id: id duplicado "${r.id}"`);
      ids.add(r.id);
    }
  });
}

/** Strict structural validation of a RigConfig (spec §18). */
export function validateRigConfig(value: unknown): RigValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['config deve ser um objeto JSON'] };

  if (value.schemaVersion !== RIG_SCHEMA_VERSION) {
    errors.push(`schemaVersion: esperado ${RIG_SCHEMA_VERSION}`);
  }
  if (typeof value.rigId !== 'string' || !RIG_ID_RE.test(value.rigId)) {
    errors.push('rigId: use minúsculas/números/hífens (2–64 caracteres), ex.: time-elements-humanoid-v1');
  }
  if (typeof value.displayName !== 'string' || value.displayName.trim().length === 0 || value.displayName.length > 80) {
    errors.push('displayName: obrigatório (até 80 caracteres)');
  }

  // sheet
  const sheet = value.sheet;
  if (!isRecord(sheet)) {
    errors.push('sheet: obrigatório');
  } else {
    for (const key of ['width', 'height', 'frameWidth', 'frameHeight', 'columns', 'rows'] as const) {
      if (!isInt(sheet[key]) || (sheet[key] as number) <= 0) errors.push(`sheet.${key}: inteiro positivo obrigatório`);
    }
    if (
      isInt(sheet.width) && isInt(sheet.frameWidth) && isInt(sheet.columns) &&
      sheet.width !== sheet.frameWidth * sheet.columns
    ) {
      errors.push(`sheet.width (${sheet.width}) ≠ frameWidth×columns (${(sheet.frameWidth as number) * (sheet.columns as number)})`);
    }
    if (
      isInt(sheet.height) && isInt(sheet.frameHeight) && isInt(sheet.rows) &&
      sheet.height !== sheet.frameHeight * sheet.rows
    ) {
      errors.push(`sheet.height (${sheet.height}) ≠ frameHeight×rows (${(sheet.frameHeight as number) * (sheet.rows as number)})`);
    }
  }
  const rows = isRecord(sheet) && isInt(sheet.rows) ? sheet.rows : 4;
  const columns = isRecord(sheet) && isInt(sheet.columns) ? sheet.columns : 23;

  // directions
  const directions = value.directions;
  if (!isRecord(directions) || Object.keys(directions).length === 0) {
    errors.push('directions: obrigatório (ex.: { "south": 0, "west": 1, "east": 2, "north": 3 })');
  } else {
    const seenRows = new Set<number>();
    for (const [name, row] of Object.entries(directions)) {
      if (!(RIG_DIRECTION_NAMES as readonly string[]).includes(name)) {
        errors.push(`directions.${name}: direção desconhecida (use ${RIG_DIRECTION_NAMES.join('/')})`);
        continue;
      }
      if (!isInt(row) || row < 0 || row >= rows) {
        errors.push(`directions.${name}: linha inválida (0–${rows - 1})`);
        continue;
      }
      if (seenRows.has(row)) errors.push(`directions.${name}: linha ${row} usada por mais de uma direção`);
      seenRows.add(row);
    }
  }

  // animations
  const animations = value.animations;
  if (!isRecord(animations) || Object.keys(animations).length === 0) {
    errors.push('animations: obrigatório (mapa nome → colunas)');
  } else {
    for (const [name, frames] of Object.entries(animations)) {
      if (!RIG_ANIMATION_NAME_RE.test(name)) {
        errors.push(`animations.${name}: nome inválido (minúsculas/números/hífens)`);
      }
      if (!Array.isArray(frames) || frames.length === 0) {
        errors.push(`animations.${name}: lista de colunas obrigatória`);
        continue;
      }
      frames.forEach((col, i) => {
        if (!isInt(col) || col < 0 || col >= columns) {
          errors.push(`animations.${name}[${i}]: coluna inválida (0–${columns - 1})`);
        }
      });
    }
  }

  // origin
  const origin = value.origin;
  if (!isRecord(origin) || !finite(origin.x) || !finite(origin.y)) {
    errors.push('origin: obrigatório ({ x, y } com números finitos)');
  } else {
    if (origin.x < 0 || origin.x > 1) errors.push('origin.x: deve estar entre 0 e 1');
    if (origin.y < 0 || origin.y > 1) errors.push('origin.y: deve estar entre 0 e 1');
  }

  // collisionBody
  const body = value.collisionBody;
  if (!isRecord(body)) {
    errors.push('collisionBody: obrigatório');
  } else {
    if (body.shape !== 'circle') errors.push('collisionBody.shape: apenas "circle" é suportado');
    if (!finite(body.offsetX) || Math.abs(body.offsetX) > MAX_BOX_COORD) errors.push('collisionBody.offsetX: número inválido');
    if (!finite(body.offsetY) || Math.abs(body.offsetY) > MAX_BOX_COORD) errors.push('collisionBody.offsetY: número inválido');
    if (!finite(body.radius) || body.radius <= 0 || body.radius > 512) errors.push('collisionBody.radius: deve ser > 0 e ≤ 512');
  }

  // previewAppearance (cosmetic only)
  const preview = value.previewAppearance;
  if (preview !== undefined) {
    if (!isRecord(preview)) {
      errors.push('previewAppearance: deve ser um objeto { categoria: assetId }');
    } else {
      for (const [k, v] of Object.entries(preview)) {
        if (k.length > 32 || typeof v !== 'string' || v.length > 64) {
          errors.push(`previewAppearance.${k}: valor inválido`);
        }
      }
    }
  }

  // animationConfigs
  const animConfigs = value.animationConfigs;
  if (animConfigs !== undefined) {
    if (!isRecord(animConfigs)) {
      errors.push('animationConfigs: deve ser um objeto');
    } else {
      for (const [animName, cfg] of Object.entries(animConfigs)) {
        const path = `animationConfigs.${animName}`;
        const animFrames =
          isRecord(animations) && Array.isArray((animations as Record<string, unknown>)[animName])
            ? ((animations as Record<string, unknown>)[animName] as unknown[])
            : null;
        if (!animFrames) {
          errors.push(`${path}: animação "${animName}" não existe em animations`);
        }
        if (!isRecord(cfg)) {
          errors.push(`${path}: deve ser um objeto`);
          continue;
        }
        const combat = cfg.combat;
        if (!isRecord(combat)) {
          errors.push(`${path}.combat: obrigatório`);
        } else {
          if (typeof combat.enabled !== 'boolean') errors.push(`${path}.combat.enabled: boolean obrigatório`);
          if (!isInt(combat.damagePerHit) || combat.damagePerHit < 0 || combat.damagePerHit > MAX_DAMAGE) {
            errors.push(`${path}.combat.damagePerHit: inteiro 0–${MAX_DAMAGE}`);
          }
          if (typeof combat.singleHitPerTarget !== 'boolean') {
            errors.push(`${path}.combat.singleHitPerTarget: boolean obrigatório`);
          }
        }
        const dirs = cfg.directions;
        if (!isRecord(dirs)) {
          errors.push(`${path}.directions: obrigatório (pode ser {})`);
          continue;
        }
        for (const [dirName, dirCfg] of Object.entries(dirs)) {
          const dPath = `${path}.directions.${dirName}`;
          if (!isRecord(directions) || !(dirName in directions)) {
            errors.push(`${dPath}: direção não existe no rig`);
          }
          if (!isRecord(dirCfg) || !isRecord(dirCfg.frames)) {
            errors.push(`${dPath}.frames: obrigatório (pode ser {})`);
            continue;
          }
          for (const [frameKey, frameCfg] of Object.entries(dirCfg.frames)) {
            const fPath = `${dPath}.frames.${frameKey}`;
            const idx = Number(frameKey);
            const maxLocal = animFrames ? animFrames.length : 0;
            if (!/^\d+$/.test(frameKey) || !Number.isInteger(idx) || idx < 0 || (animFrames !== null && idx >= maxLocal)) {
              errors.push(`${fPath}: índice de frame local inválido (0–${Math.max(0, maxLocal - 1)})`);
            }
            if (!isRecord(frameCfg)) {
              errors.push(`${fPath}: deve ser um objeto { hurtbox, hitbox }`);
              continue;
            }
            validateBoxGroup(frameCfg.hurtbox, `${fPath}.hurtbox`, errors);
            validateBoxGroup(frameCfg.hitbox, `${fPath}.hitbox`, errors);
          }
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Normalise optional containers so consumers can rely on their presence.
  const config = value as unknown as RigConfig;
  if (config.previewAppearance === undefined) config.previewAppearance = {};
  if (config.animationConfigs === undefined) config.animationConfigs = {};
  return { ok: true, config };
}

// ---------------------------------------------------------------- accessors

/** Sheet column of a local animation frame, or null when out of range. */
export function sheetColumnForFrame(rig: RigConfig, animation: string, localFrame: number): number | null {
  const frames = rig.animations[animation];
  if (!frames || localFrame < 0 || localFrame >= frames.length) return null;
  return frames[localFrame];
}

/** Boxes of a frame; missing entries mean "both groups disabled" (spec §18). */
export function getRigFrameConfig(
  rig: RigConfig,
  animation: string,
  direction: RigDirection,
  localFrame: number,
): RigFrameConfig {
  const frame = rig.animationConfigs[animation]?.directions[direction]?.frames[String(localFrame)];
  return frame ?? emptyRigFrame();
}

export function getRigCombat(rig: RigConfig, animation: string): RigCombatConfig {
  return rig.animationConfigs[animation]?.combat ?? defaultRigCombat();
}

export function getActiveRigHitboxRects(
  rig: RigConfig,
  animation: string,
  direction: RigDirection,
  localFrame: number,
): LocalRectangle[] {
  const frame = getRigFrameConfig(rig, animation, direction, localFrame);
  return frame.hitbox.enabled ? frame.hitbox.rectangles : [];
}

export function getActiveRigHurtboxRects(
  rig: RigConfig,
  animation: string,
  direction: RigDirection,
  localFrame: number,
): LocalRectangle[] {
  const frame = getRigFrameConfig(rig, animation, direction, localFrame);
  return frame.hurtbox.enabled ? frame.hurtbox.rectangles : [];
}

/** Local frame indices of an animation that carry enabled hitboxes. */
export function rigHitboxFrameIndices(rig: RigConfig, animation: string, direction: RigDirection): number[] {
  const frames = rig.animations[animation] ?? [];
  const result: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (getActiveRigHitboxRects(rig, animation, direction, i).length > 0) result.push(i);
  }
  return result;
}

/** Union (concatenation) of enabled hurtboxes across all frames of a direction. */
export function unionRigHurtboxRects(rig: RigConfig, animation: string, direction: RigDirection): LocalRectangle[] {
  const frames = rig.animations[animation] ?? [];
  const result: LocalRectangle[] = [];
  for (let i = 0; i < frames.length; i++) {
    result.push(...getActiveRigHurtboxRects(rig, animation, direction, i));
  }
  return result;
}

// ---------------------------------------------------------------- geometry
// Shared, Phaser-free (spec §24-25). The editor and the game must use these.

/** Canvas/screen px → frame px (the editor draws the frame scaled by `scale`). */
export function screenToFrameCoordinates(screenX: number, screenY: number, scale: number): { x: number; y: number } {
  return { x: screenX / scale, y: screenY / scale };
}

/** Frame px → canvas/screen px. */
export function frameToScreenCoordinates(frameX: number, frameY: number, scale: number): { x: number; y: number } {
  return { x: frameX * scale, y: frameY * scale };
}

/** Origin-relative rect → world rect, given the origin's world position. */
export function localRectToWorldRect(rect: LocalRectangle, originWorldX: number, originWorldY: number): WorldRectangle {
  return { x: originWorldX + rect.x, y: originWorldY + rect.y, width: rect.width, height: rect.height };
}

/** Mirror a rect horizontally across the origin's vertical axis (West ↔ East). */
export function mirrorRectAcrossOrigin(rect: LocalRectangle): LocalRectangle {
  return { ...rect, x: -(rect.x + rect.width) };
}

export function mirrorRigFrameConfig(frame: RigFrameConfig): RigFrameConfig {
  return {
    hurtbox: { enabled: frame.hurtbox.enabled, rectangles: frame.hurtbox.rectangles.map(mirrorRectAcrossOrigin) },
    hitbox: { enabled: frame.hitbox.enabled, rectangles: frame.hitbox.rectangles.map(mirrorRectAcrossOrigin) },
  };
}

export function rectanglesIntersectWorld(a: WorldRectangle, b: WorldRectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
