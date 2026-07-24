export const MAP_CONFIG = {
  key: 'world',
  path: '/assets/world-v2/main_world.tmj',
  basePath: '/assets/world-v2/',
  tileSize: 32,
  logicalLayers: [
    'world_zones',
    'character_anchors',
    'camera_anchors',
    'ui_anchors',
    'portal_interactions',
    'village_interactions',
    'house_interactions',
    'spawns',
    'building_interactions',
    'collisions',
    'chess_tables_interactions',
  ],
  zoom: {
    // PPU (Pixels Per Unit) = zoom. At zoom 2, each world pixel = 2 screen pixels.
    // All steps produce integer tile sizes: tileSize * step = 32 * 0.25 = 8 (integer).
    default: 2,
    min: 0.5,
    max: 4,
    step: 0.25,
    smoothSpeed: 0.12,
    board: 3,
  },
  playerSpeed: 3,
};
