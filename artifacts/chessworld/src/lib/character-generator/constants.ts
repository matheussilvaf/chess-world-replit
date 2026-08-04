/**
 * Character Generator — spritesheet geometry, layer order and animation map.
 * Single source of truth: tweak here, everything (preview, sheet, export) follows.
 */

export const SHEET_WIDTH = 2208;
export const SHEET_HEIGHT = 384;
export const SHEET_ROWS = 4;
export const SHEET_COLS = 23;
export const FRAME_WIDTH = 96;
export const FRAME_HEIGHT = 96;

/** ms per animation frame in the animated preview. */
export const ANIM_FRAME_MS = 150;

/** Draw order, back to front. Centralised so it's easy to adjust later. */
export const LAYER_ORDER = [
  'shadow',
  'backextra',
  'backhair',
  'bottom',
  'top',
  'head',
  'hair',
  'hat',
  'weapon',
  'frontextra',
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  shadow: 'Sombra',
  backextra: 'Extra (trás)',
  backhair: 'Cabelo (trás)',
  bottom: 'Calça',
  top: 'Camisa',
  head: 'Cabeça',
  hair: 'Cabelo',
  hat: 'Chapéu',
  weapon: 'Arma',
  frontextra: 'Extra (frente)',
};

/** Sheet rows — fixed order. */
export const DIRECTIONS = [
  { id: 'south', label: 'South', row: 0 },
  { id: 'west', label: 'West', row: 1 },
  { id: 'east', label: 'East', row: 2 },
  { id: 'north', label: 'North', row: 3 },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];

/**
 * Column mapping — exactly as specified for this asset pack.
 * (No Dash animation exists in these sheets — deliberately out of scope.)
 */
export const ANIMATIONS = [
  { id: 'stand', label: 'Stand', frames: [1] },
  // Walk plays 1st → 2nd → 3rd → back to middle, then repeats (0,1,2,1,0,1,2,1…).
  { id: 'walk', label: 'Walk', frames: [0, 1, 2, 1] },
  { id: 'armsUp', label: 'Arms Up', frames: [3, 4, 5] },
  { id: 'crouch', label: 'Crouch', frames: [6] },
  { id: 'jump', label: 'Jump', frames: [7, 8, 9] },
  { id: 'windUp', label: 'Wind Up', frames: [10] },
  { id: 'attack', label: 'Attack', frames: [11, 12, 13] },
  { id: 'attackFull', label: 'Attack Full', frames: [10, 11, 12, 13] },
  { id: 'knock', label: 'Knock', frames: [14] },
  { id: 'bow', label: 'Bow', frames: [15, 16, 17] },
  { id: 'knockAndBow', label: 'Knock And Bow', frames: [14, 15, 16, 17] },
  { id: 'climb', label: 'Climb', frames: [18, 19, 20] },
  { id: 'sleep', label: 'Sleep', frames: [21] },
  { id: 'dead', label: 'Dead / KO', frames: [22] },
] as const;

export type AnimationId = (typeof ANIMATIONS)[number]['id'];

export function getAnimation(id: AnimationId) {
  return ANIMATIONS.find((a) => a.id === id) ?? ANIMATIONS[0];
}

export function getDirection(id: DirectionId) {
  return DIRECTIONS.find((d) => d.id === id) ?? DIRECTIONS[0];
}
