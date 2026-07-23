export const ASSETS = {
  // Characters
  player: '/assets/sprites/characters/player.png',
  skeleton: '/assets/sprites/characters/skeleton.png',
  slime: '/assets/sprites/characters/slime.png',
  // Tilesets
  grass: '/assets/sprites/tilesets/grass.png',
  plains: '/assets/sprites/tilesets/plains.png',
  decor8: '/assets/sprites/tilesets/decor_8x8.png',
  decor16: '/assets/sprites/tilesets/decor_16x16.png',
  fences: '/assets/sprites/tilesets/fences.png',
  // Water
  waterSheet: '/assets/sprites/tilesets/water-sheet.png',
  water1: '/assets/sprites/tilesets/water1.png',
  waterLillies: '/assets/sprites/tilesets/water_lillies.png',
  waterDecorations: '/assets/sprites/tilesets/water_decorations.png',
  // Floors
  woodenFloor: '/assets/sprites/tilesets/floors/wooden.png',
  flooring: '/assets/sprites/tilesets/floors/flooring.png',
  carpet: '/assets/sprites/tilesets/floors/carpet.png',
  // Walls
  walls: '/assets/sprites/tilesets/walls/walls.png',
  woodenDoor: '/assets/sprites/tilesets/walls/wooden_door.png',
  woodenDoorB: '/assets/sprites/tilesets/walls/wooden_door_b.png',
  // Objects
  chest1: '/assets/sprites/objects/chest_01.png',
  chest2: '/assets/sprites/objects/chest_02.png',
  objects: '/assets/sprites/objects/objects.png',
  rockInWater1: '/assets/sprites/objects/rock_in_water_01.png',
  rockInWater2: '/assets/sprites/objects/rock_in_water_02.png',
  rockInWater3: '/assets/sprites/objects/rock_in_water_03.png',
  rockInWater4: '/assets/sprites/objects/rock_in_water_04.png',
  rockInWater5: '/assets/sprites/objects/rock_in_water_05.png',
  rockInWater6: '/assets/sprites/objects/rock_in_water_06.png',
  // Houses
  house1: '/assets/sprites/houses/HOUSE_1_-_DAY.png',
  house2: '/assets/sprites/houses/HOUSE_2_-_DAY.png',
  // Particles
  dust: '/assets/sprites/particles/dust_particles_01.png',
};

// Player spritesheet: 288x480, 48x48 frames, 6 columns, 10 rows
export const PLAYER_CONFIG = {
  frameWidth: 48,
  frameHeight: 48,
};

// Slime: 224x416, 32x32, 7 columns
export const SLIME_CONFIG = {
  frameWidth: 32,
  frameHeight: 32,
};

// Plains: 96x192, 16x16 (6x12)
export const PLAINS_CONFIG = { frameWidth: 16, frameHeight: 16 };

// Fences: 64x64, 16x16 (4x4)
export const FENCES_CONFIG = { frameWidth: 16, frameHeight: 16 };

// Decor 16x16: 64x80 (4x5)
export const DECOR16_CONFIG = { frameWidth: 16, frameHeight: 16 };

// Decor 8x8: 32x32 (4x4)
export const DECOR8_CONFIG = { frameWidth: 8, frameHeight: 8 };

// Chest: 64x16 (4 frames of 16x16)
export const CHEST_CONFIG = { frameWidth: 16, frameHeight: 16 };

// Water lillies: 96x16 (6 frames of 16x16)
export const WATER_LILLIES_CONFIG = { frameWidth: 16, frameHeight: 16 };

// Water decorations: 96x32 (6x2 at 16x16)
export const WATER_DECORATIONS_CONFIG = { frameWidth: 16, frameHeight: 16 };
