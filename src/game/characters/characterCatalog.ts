export type Direction8 =
  | 'down'
  | 'down-right'
  | 'right'
  | 'up-right'
  | 'up'
  | 'up-left'
  | 'left'
  | 'down-left';

export interface CharacterDef {
  id: string;
  sheet: string;
  columns: number;
  rows: number;
  framesPerDirection: number;
  frameWidth: number;
  frameHeight: number;
  directions: Direction8[];
  scale: number;
  bodyWidth: number;
  bodyHeight: number;
  bodyOffsetX: number;
  bodyOffsetY: number;
  originX: number;
  originY: number;
  feetY: number;
}

const DIRECTION_ORDER: Direction8[] = [
  'down',
  'down-right',
  'right',
  'up-right',
  'up',
  'up-left',
  'left',
  'down-left',
];

export const CHARACTERS: Record<string, CharacterDef> = {
  'test-character-01': {
    id: 'test-character-01',
    sheet: '/assets/characters/test-character-01/walk-8dir.png',
    columns: 4,
    rows: 8,
    framesPerDirection: 4,
    frameWidth: 104,
    frameHeight: 104,
    directions: DIRECTION_ORDER,
    scale: 1.0,
    bodyWidth: 24,
    bodyHeight: 12,
    bodyOffsetX: 0,
    bodyOffsetY: 0,
    originX: 0.5,
    originY: 0.5,
    feetY: 83,
  },
};

export const DEFAULT_CHARACTER_ID = 'test-character-01';

interface RuntimeCharConfig {
  origin_x: number;
  origin_y: number;
  body_offset_x: number;
  body_offset_y: number;
  body_radius: number;
}

let runtimeConfigs: Map<string, RuntimeCharConfig> = new Map();

export function applyCharacterConfig(charId: string, config: RuntimeCharConfig) {
  runtimeConfigs.set(charId, config);
}

export function getCharacter(id?: string): CharacterDef {
  const charId = id || DEFAULT_CHARACTER_ID;
  const base = CHARACTERS[charId] || CHARACTERS[DEFAULT_CHARACTER_ID];
  const rc = runtimeConfigs.get(charId);
  if (rc) {
    return {
      ...base,
      originX: rc.origin_x,
      originY: rc.origin_y,
      feetY: rc.origin_y * base.frameHeight + rc.body_offset_y + rc.body_radius,
    };
  }
  return base;
}

export function getBodyConfig(id?: string): { offsetX: number; offsetY: number; radius: number } {
  const charId = id || DEFAULT_CHARACTER_ID;
  const rc = runtimeConfigs.get(charId);
  if (rc) {
    return { offsetX: rc.body_offset_x, offsetY: rc.body_offset_y, radius: rc.body_radius };
  }
  const base = CHARACTERS[charId] || CHARACTERS[DEFAULT_CHARACTER_ID];
  const offsetY = base.feetY - base.originY * base.frameHeight - 10;
  return { offsetX: 0, offsetY, radius: 10 };
}

export function getIdleFrame(dir: Direction8): number {
  const idx = DIRECTION_ORDER.indexOf(dir);
  return idx >= 0 ? idx * 4 : 0;
}

export function getAnimKey(dir: Direction8): string {
  return `walk-${dir}`;
}
