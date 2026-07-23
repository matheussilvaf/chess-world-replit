#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const MAIN_WORLD_PATH = join(projectRoot, 'public/assets/world-v2/main_world.tmj');
const VILLAGE_TEMPLATE_PATH = join(projectRoot, 'public/assets/world-v2/main_village_template.tmj');

const errors = [];
const warnings = [];
const info = [];

function error(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function log(msg) { info.push(msg); }

function loadJSON(filePath, label) {
  if (!existsSync(filePath)) {
    error(`[${label}] File not found: ${filePath}`);
    return null;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    log(`[${label}] Valid JSON (${(raw.length / 1024).toFixed(1)} KB)`);
    return data;
  } catch (e) {
    error(`[${label}] Invalid JSON: ${e.message}`);
    return null;
  }
}

function checkExternalSources(tilesets, label) {
  let count = 0;
  for (const ts of tilesets) {
    if (ts.source) {
      error(`[${label}] Tileset "${ts.name || '(unnamed)'}" uses external source: ${ts.source}`);
      count++;
    }
  }
  if (count === 0) log(`[${label}] No external "source" references in tilesets`);
  return count;
}

function getAllImages(tilesets) {
  const images = new Set();
  for (const ts of tilesets) {
    if (ts.image) images.add(ts.image);
    if (ts.tiles) {
      for (const t of ts.tiles) {
        if (t.image) images.add(t.image);
      }
    }
  }
  return images;
}

function checkTilesetImages(tilesets, tmjDir, label) {
  const images = getAllImages(tilesets);
  const missing = [];
  const found = [];
  for (const img of images) {
    const fullPath = resolve(tmjDir, img);
    if (existsSync(fullPath)) {
      found.push(img);
    } else {
      missing.push(img);
      warn(`[${label}] Missing tileset image: ${img}`);
    }
  }
  log(`[${label}] Tileset images: ${found.length} found, ${missing.length} missing`);
  return { found, missing };
}

function getLayerNames(layers, prefix = '') {
  const names = [];
  for (const layer of layers) {
    const fullName = prefix ? `${prefix}/${layer.name}` : layer.name;
    names.push({ name: layer.name, fullName, type: layer.type, id: layer.id });
    if (layer.layers) {
      names.push(...getLayerNames(layer.layers, fullName));
    }
  }
  return names;
}

function getObjectLayers(layers) {
  const result = [];
  for (const layer of layers) {
    if (layer.type === 'objectgroup') {
      result.push(layer);
    }
    if (layer.layers) {
      result.push(...getObjectLayers(layer.layers));
    }
  }
  return result;
}

function getAllObjects(layers) {
  const objects = [];
  const objectLayers = getObjectLayers(layers);
  for (const layer of objectLayers) {
    if (layer.objects) {
      for (const obj of layer.objects) {
        objects.push({ ...obj, _layerName: layer.name });
      }
    }
  }
  return objects;
}

function countObjectTypes(objects) {
  let rectangles = 0, points = 0, polygons = 0, polylines = 0, ellipses = 0, tiles = 0;
  for (const obj of objects) {
    if (obj.polygon) polygons++;
    else if (obj.polyline) polylines++;
    else if (obj.ellipse) ellipses++;
    else if (obj.point) points++;
    else if (obj.gid) tiles++;
    else rectangles++;
  }
  return { rectangles, points, polygons, polylines, ellipses, tiles };
}

function checkOutOfBounds(objects, mapWidthPx, mapHeightPx, label) {
  let outCount = 0;
  for (const obj of objects) {
    const x = obj.x || 0;
    const y = obj.y || 0;
    if (obj.polygon || obj.polyline) continue;
    if (x < -50 || y < -50 || x > mapWidthPx + 50 || y > mapHeightPx + 50) {
      warn(`[${label}] Object "${obj.name || obj.id}" in layer "${obj._layerName}" outside bounds: (${Math.round(x)}, ${Math.round(y)})`);
      outCount++;
    }
  }
  return outCount;
}

function getMapProperty(mapData, propName) {
  if (!mapData.properties) return undefined;
  const prop = mapData.properties.find(p => p.name === propName);
  return prop ? prop.value : undefined;
}

function validateMainWorld(data) {
  const label = 'main_world';
  const mapWidthPx = data.width * data.tilewidth;
  const mapHeightPx = data.height * data.tileheight;

  log(`[${label}] Dimensions: ${data.width}x${data.height} tiles, ${data.tilewidth}x${data.tileheight}px`);
  log(`[${label}] Pixel size: ${mapWidthPx}x${mapHeightPx}`);

  // Map properties
  log(`[${label}] --- Map Properties ---`);
  if (data.properties) {
    for (const p of data.properties) {
      log(`[${label}]   ${p.name} = ${p.value} (${p.type})`);
    }
  } else {
    warn(`[${label}] No custom map properties`);
  }

  // Tilesets
  checkExternalSources(data.tilesets || [], label);
  log(`[${label}] Tilesets declared: ${(data.tilesets || []).length}`);
  const tmjDir = dirname(MAIN_WORLD_PATH);
  checkTilesetImages(data.tilesets || [], tmjDir, label);

  // Layers
  const allLayers = getLayerNames(data.layers || []);
  const groups = allLayers.filter(l => l.type === 'group');
  const tileLayers = allLayers.filter(l => l.type === 'tilelayer');
  const objectGroups = allLayers.filter(l => l.type === 'objectgroup');
  log(`[${label}] Layers: ${allLayers.length} total (groups:${groups.length}, tile:${tileLayers.length}, object:${objectGroups.length})`);

  // Required logical layers
  const requiredLayers = [
    'world_zones', 'character_anchors', 'camera_anchors', 'ui_anchors',
    'portal_interactions', 'village_interactions', 'house_interactions',
    'spawns', 'building_interactions', 'collisions', 'chess_tables_interactions',
  ];

  log(`[${label}] --- Required Logical Layers ---`);
  for (const layerName of requiredLayers) {
    const found = allLayers.find(l => l.name.toLowerCase() === layerName.toLowerCase());
    if (found) {
      log(`[${label}]   [OK] ${layerName}`);
    } else {
      error(`[${label}]   [MISSING] Required layer: ${layerName}`);
    }
  }

  // Objects
  const allObjects = getAllObjects(data.layers || []);
  const types = countObjectTypes(allObjects);
  log(`[${label}] Objects: rect=${types.rectangles} poly=${types.polygons} pt=${types.points} tile=${types.tiles} pline=${types.polylines}`);

  // Out of bounds
  const outCount = checkOutOfBounds(allObjects, mapWidthPx, mapHeightPx, label);
  if (outCount > 0) warn(`[${label}] ${outCount} objects outside map bounds`);

  // Count chess boards (14 expected)
  const chessboardLayers = allLayers.filter(l => /^chessboard\d+$/i.test(l.name));
  log(`[${label}] --- Structure Validation ---`);
  if (chessboardLayers.length === 14) {
    log(`[${label}]   [OK] 14 chessboard layers`);
  } else {
    warn(`[${label}]   Expected 14 chessboard layers, found ${chessboardLayers.length}`);
  }

  // Count houses (36 expected)
  const houseLayers = allLayers.filter(l => l.name.toLowerCase().match(/^house\s?\d/));
  if (houseLayers.length === 36) {
    log(`[${label}]   [OK] 36 house layers`);
  } else {
    warn(`[${label}]   Expected 36 house layers, found ${houseLayers.length}`);
  }

  // chess_tables_interactions detail
  const ctlLayer = getObjectLayers(data.layers).find(l => l.name === 'chess_tables_interactions');
  if (ctlLayer) {
    const boards = ctlLayer.objects.filter(o => (o.name || '').includes('_board'));
    const playerSeats = ctlLayer.objects.filter(o => (o.name || '').includes('_player_'));
    const spectatorSeats = ctlLayer.objects.filter(o => (o.name || '').includes('_spectator_'));

    if (boards.length === 14) {
      log(`[${label}]   [OK] 14 board interaction zones`);
    } else {
      warn(`[${label}]   Expected 14 board zones, found ${boards.length}`);
    }

    if (playerSeats.length === 28) {
      log(`[${label}]   [OK] 28 player positions (2 per table)`);
    } else {
      warn(`[${label}]   Expected 28 player positions, found ${playerSeats.length}`);
    }

    if (spectatorSeats.length === 28) {
      log(`[${label}]   [OK] 28 spectator positions (4 per table: 2L + 2R)`);
    } else {
      warn(`[${label}]   Expected 28 spectator positions, found ${spectatorSeats.length}`);
    }
  }

  // character_anchors detail
  const caLayer = getObjectLayers(data.layers).find(l => l.name === 'character_anchors');
  if (caLayer) {
    const playerAnchors = caLayer.objects.filter(o => (o.name || '').includes('_player_'));
    const spectAnchors = caLayer.objects.filter(o => (o.name || '').includes('_spectator_'));
    const exitAnchors = caLayer.objects.filter(o => (o.name || '').includes('_exit_'));
    log(`[${label}]   Character anchors: ${caLayer.objects.length} total (player:${playerAnchors.length} spectator:${spectAnchors.length} exit:${exitAnchors.length})`);
  }

  // ui_anchors overlays
  const uiLayer = getObjectLayers(data.layers).find(l => l.name === 'ui_anchors');
  if (uiLayer) {
    const overlays = uiLayer.objects.filter(o => (o.name || '').includes('_overlay_'));
    const camFocus = uiLayer.objects.filter(o => (o.name || '').includes('_camera_focus_'));
    log(`[${label}]   UI anchors: ${uiLayer.objects.length} total (overlays:${overlays.length} camera_focus:${camFocus.length})`);
    if (overlays.length >= 14) {
      log(`[${label}]   [OK] ${overlays.length} board overlays (14+ expected)`);
    } else {
      warn(`[${label}]   Expected 14+ board overlays, found ${overlays.length}`);
    }
  }

  // camera_anchors
  const camLayer = getObjectLayers(data.layers).find(l => l.name === 'camera_anchors');
  if (camLayer) {
    log(`[${label}]   Camera anchors: ${camLayer.objects.length}`);
  }

  // Collisions breakdown
  const collLayer = getObjectLayers(data.layers).find(l => l.name === 'collisions');
  if (collLayer) {
    const ct = countObjectTypes(collLayer.objects);
    log(`[${label}]   Collisions: ${collLayer.objects.length} total (rect:${ct.rectangles} poly:${ct.polygons})`);
  }

  // Spawns
  const spawnLayer = getObjectLayers(data.layers).find(l => l.name === 'spawns');
  if (spawnLayer) {
    const mainSpawn = spawnLayer.objects.find(o => o.name === 'main_player_spawn');
    if (mainSpawn) {
      log(`[${label}]   [OK] main_player_spawn found at (${Math.round(mainSpawn.x)}, ${Math.round(mainSpawn.y)})`);
    } else {
      error(`[${label}]   main_player_spawn NOT found in spawns layer`);
    }
    log(`[${label}]   Total spawns: ${spawnLayer.objects.length}`);
  }

  // Duplicate layer names
  const nameCount = {};
  allLayers.forEach(l => { nameCount[l.name] = (nameCount[l.name] || 0) + 1; });
  const duplicates = Object.entries(nameCount).filter(([, c]) => c > 1);
  if (duplicates.length > 0) {
    log(`[${label}] Duplicate layer names (may be intentional in different groups):`);
    for (const [name, count] of duplicates) {
      log(`[${label}]   "${name}" x${count}`);
    }
  }

  // Custom properties used on objects
  const propsUsed = new Set();
  allObjects.forEach(o => { (o.properties || []).forEach(p => propsUsed.add(p.name)); });
  log(`[${label}] Custom object properties: ${[...propsUsed].sort().join(', ')}`);
}

function validateVillageTemplate(data) {
  const label = 'village_template';
  const mapWidthPx = data.width * data.tilewidth;
  const mapHeightPx = data.height * data.tileheight;

  log(`[${label}] Dimensions: ${data.width}x${data.height} tiles, ${data.tilewidth}x${data.tileheight}px`);
  log(`[${label}] Pixel size: ${mapWidthPx}x${mapHeightPx}`);

  // Map properties validation
  const checks = [
    { name: 'mapId', expected: 'main_village_template' },
    { name: 'mapType', expected: 'village_template' },
    { name: 'defaultSpawn', expected: 'village_instance_entry' },
    { name: 'templateId', expected: 'main_village_template' },
    { name: 'instanceMode', expected: 'dynamic' },
    { name: 'houseCapacity', expected: 36 },
    { name: 'tileSize', expected: 32 },
  ];

  log(`[${label}] --- Map Properties ---`);
  for (const check of checks) {
    const actual = getMapProperty(data, check.name);
    if (actual === undefined) {
      error(`[${label}]   Missing property: ${check.name} (expected: ${check.expected})`);
    } else if (String(actual) !== String(check.expected)) {
      warn(`[${label}]   Property ${check.name}: expected "${check.expected}", got "${actual}"`);
    } else {
      log(`[${label}]   [OK] ${check.name} = ${actual}`);
    }
  }

  // Tilesets
  checkExternalSources(data.tilesets || [], label);
  const tmjDir = dirname(VILLAGE_TEMPLATE_PATH);
  checkTilesetImages(data.tilesets || [], tmjDir, label);

  // Objects
  const allObjects = getAllObjects(data.layers || []);
  const types = countObjectTypes(allObjects);
  log(`[${label}] Objects: rect=${types.rectangles} poly=${types.polygons} pt=${types.points} tile=${types.tiles}`);

  // village_instance_entry_spawn
  const entrySpawn = allObjects.find(o => o.name === 'village_instance_entry_spawn');
  if (entrySpawn) {
    log(`[${label}]   [OK] village_instance_entry_spawn found`);
  } else {
    error(`[${label}]   MISSING: village_instance_entry_spawn`);
  }

  // village_instance_exit_gateway
  const exitGateway = allObjects.find(o => o.name === 'village_instance_exit_gateway');
  if (exitGateway) {
    log(`[${label}]   [OK] village_instance_exit_gateway found`);
  } else {
    error(`[${label}]   MISSING: village_instance_exit_gateway`);
  }

  // village_instance_zone
  const instanceZone = allObjects.find(o => o.name === 'village_instance_zone');
  if (instanceZone) {
    log(`[${label}]   [OK] village_instance_zone found`);
  } else {
    error(`[${label}]   MISSING: village_instance_zone`);
  }

  // No fixed villageId on houses
  const houseInteractions = getObjectLayers(data.layers).find(l => l.name === 'house_interactions');
  if (houseInteractions) {
    let fixedCount = 0;
    houseInteractions.objects.forEach(o => {
      const vId = (o.properties || []).find(p => p.name === 'villageId');
      if (vId && vId.value && vId.value !== '' && vId.value !== 'dynamic') fixedCount++;
    });
    if (fixedCount === 0) {
      log(`[${label}]   [OK] No fixed villageId on houses`);
    } else {
      warn(`[${label}]   ${fixedCount} houses have a fixed villageId`);
    }
    if (houseInteractions.objects.length === 36) {
      log(`[${label}]   [OK] 36 house interaction entries`);
    } else {
      warn(`[${label}]   Expected 36 house interactions, found ${houseInteractions.objects.length}`);
    }
  }

  // 36 house exit spawns
  const spawnLayer = getObjectLayers(data.layers).find(l => l.name === 'spawns');
  if (spawnLayer) {
    const houseSpawns = spawnLayer.objects.filter(o => (o.name || '').includes('house_') && (o.name || '').includes('_exit_spawn'));
    if (houseSpawns.length === 36) {
      log(`[${label}]   [OK] 36 house exit spawns`);
    } else {
      warn(`[${label}]   Expected 36 house exit spawns, found ${houseSpawns.length}`);
    }
  }

  // Boundary collisions (4 map edges)
  const collLayer = getObjectLayers(data.layers).find(l => l.name === 'collisions');
  if (collLayer) {
    const boundaries = collLayer.objects.filter(o => (o.name || '').includes('map_boundary'));
    if (boundaries.length >= 4) {
      log(`[${label}]   [OK] ${boundaries.length} map boundary collisions`);
    } else {
      warn(`[${label}]   Expected 4 map boundary collisions, found ${boundaries.length}`);
    }
    const ct = countObjectTypes(collLayer.objects);
    log(`[${label}]   Collisions: ${collLayer.objects.length} total (rect:${ct.rectangles} poly:${ct.polygons})`);
  }

  // Out of bounds
  const outCount = checkOutOfBounds(allObjects, mapWidthPx, mapHeightPx, label);
  if (outCount > 0) warn(`[${label}] ${outCount} objects outside map bounds`);
}

// --- Main ---
console.log('='.repeat(60));
console.log('  Chess World v2 - Map Validation Script');
console.log('='.repeat(60));
console.log();

const mainWorld = loadJSON(MAIN_WORLD_PATH, 'main_world');
const villageTemplate = loadJSON(VILLAGE_TEMPLATE_PATH, 'village_template');

if (mainWorld) {
  console.log('--- Validating Main World ---');
  validateMainWorld(mainWorld);
}

if (villageTemplate) {
  console.log('\n--- Validating Village Template ---');
  validateVillageTemplate(villageTemplate);
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('  VALIDATION SUMMARY');
console.log('='.repeat(60));

if (errors.length > 0) {
  console.log(`\n  ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`    [ERROR] ${e}`);
}

if (warnings.length > 0) {
  console.log(`\n  WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`    [WARN]  ${w}`);
}

if (info.length > 0) {
  console.log(`\n  INFO (${info.length} entries):`);
  for (const i of info) console.log(`    ${i}`);
}

console.log('\n' + '-'.repeat(60));
const total = errors.length + warnings.length;
console.log(`  Errors: ${errors.length} | Warnings: ${warnings.length} | Polygons: ${
  (mainWorld ? countObjectTypes(getAllObjects(mainWorld.layers || [])).polygons : 0) +
  (villageTemplate ? countObjectTypes(getAllObjects(villageTemplate.layers || [])).polygons : 0)
}`);

if (errors.length === 0 && warnings.length === 0) {
  console.log('  STATUS: ALL CHECKS PASSED');
} else if (errors.length === 0) {
  console.log('  STATUS: PASSED WITH WARNINGS');
} else {
  console.log('  STATUS: VALIDATION FAILED');
}
console.log('-'.repeat(60));
process.exit(errors.length > 0 ? 1 : 0);
