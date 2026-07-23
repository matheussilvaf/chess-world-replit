import Phaser from 'phaser';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, ARENAS, HOUSES, SLIMES } from './mapLayout';

const DEPTH = {
  GROUND: 0,
  PATH: 1,
  WATER: 2,
  DECORATION: 3,
  TREE: 5,
  BUILDING: 6,
  ARENA: 7,
  LABEL: 8,
  NPC: 9,
};

// Path grid definition
function buildPathGrid(): boolean[][] {
  const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
  const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
  const grid: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));

  const drawLine = (x1t: number, y1t: number, x2t: number, y2t: number, thickness: number) => {
    const dx = x2t - x1t;
    const dy = y2t - y1t;
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(x1t + dx * t);
      const cy = Math.round(y1t + dy * t);
      const half = Math.floor(thickness / 2);
      for (let w = -half; w <= half; w++) {
        for (let h = -half; h <= half; h++) {
          const gx = cx + w;
          const gy = cy + h;
          if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
            grid[gy][gx] = true;
          }
        }
      }
    }
  };

  const hCenter = Math.floor(rows * 0.5);
  const vCenter = Math.floor(cols * 0.5);

  // Main roads
  drawLine(0, hCenter, cols - 1, hCenter, 4);
  drawLine(vCenter, 0, vCenter, rows - 1, 4);
  // Diagonal paths
  drawLine(vCenter, hCenter, 18, 22, 3);
  drawLine(vCenter, hCenter, cols - 12, 22, 3);
  drawLine(vCenter, hCenter, 15, rows - 10, 3);
  drawLine(vCenter, hCenter, cols - 10, rows - 10, 3);
  // Housing paths
  drawLine(14, 18, 42, 18, 2);
  drawLine(14, 32, 42, 32, 2);
  drawLine(28, 14, 28, 38, 2);
  // Arena garden paths
  drawLine(cols - 38, 18, cols - 8, 18, 2);
  drawLine(cols - 38, 38, cols - 8, 38, 2);
  drawLine(cols - 25, 14, cols - 25, 42, 2);
  // Central plaza circle
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (Math.sqrt(dx * dx + dy * dy) <= 5) {
        const gx = vCenter + dx;
        const gy = hCenter + dy;
        if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) grid[gy][gx] = true;
      }
    }
  }

  return grid;
}

export function createGroundLayer(scene: Phaser.Scene) {
  // TileSprite for grass base (ONE object)
  scene.add.tileSprite(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH, MAP_HEIGHT, 'grass')
    .setDepth(DEPTH.GROUND);

  // Path rendering using a single Graphics (draws all paths as colored rectangles)
  const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
  const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
  const pathGrid = buildPathGrid();

  const pathGfx = scene.add.graphics().setDepth(DEPTH.PATH);
  const edgeGfx = scene.add.graphics().setDepth(DEPTH.PATH);

  // Main dirt color
  const dirtColor = 0x8b6b3a;
  const dirtEdge = 0x6b5028;
  const grassEdge = 0x3a7a2a;

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!pathGrid[ty][tx]) continue;
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;

      const above = ty > 0 && pathGrid[ty - 1][tx];
      const below = ty < rows - 1 && pathGrid[ty + 1][tx];
      const left = tx > 0 && pathGrid[ty][tx - 1];
      const right = tx < cols - 1 && pathGrid[ty][tx + 1];

      // Dirt fill
      pathGfx.fillStyle(dirtColor, 1);
      pathGfx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      // Add dark dirt variation spots (sparse)
      if (Math.random() < 0.15) {
        pathGfx.fillStyle(dirtEdge, 0.5);
        pathGfx.fillCircle(px + Phaser.Math.Between(3, 13), py + Phaser.Math.Between(3, 13), Phaser.Math.Between(2, 4));
      }

      // Draw grass-colored edges where path meets grass
      if (!above) { edgeGfx.fillStyle(grassEdge, 0.7); edgeGfx.fillRect(px, py, TILE_SIZE, 3); }
      if (!below) { edgeGfx.fillStyle(grassEdge, 0.7); edgeGfx.fillRect(px, py + TILE_SIZE - 3, TILE_SIZE, 3); }
      if (!left) { edgeGfx.fillStyle(grassEdge, 0.7); edgeGfx.fillRect(px, py, 3, TILE_SIZE); }
      if (!right) { edgeGfx.fillStyle(grassEdge, 0.7); edgeGfx.fillRect(px + TILE_SIZE - 3, py, 3, TILE_SIZE); }
    }
  }

  // Sparse grass details
  for (let i = 0; i < 60; i++) {
    const x = Phaser.Math.Between(10, MAP_WIDTH - 10);
    const y = Phaser.Math.Between(10, MAP_HEIGHT - 10);
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < cols && ty < rows && !pathGrid[ty][tx]) {
      scene.add.image(x, y, 'decor8', Phaser.Math.Between(0, 7)).setDepth(DEPTH.GROUND + 1).setAlpha(0.7);
    }
  }
}

export function createWaterAreas(scene: Phaser.Scene) {
  const waterGfx = scene.add.graphics().setDepth(DEPTH.WATER);
  const waters = [
    { x: 650, y: 200, w: 140, h: 100 },
    { x: 100, y: 1100, w: 160, h: 120 },
    { x: 1400, y: 900, w: 120, h: 90 },
  ];

  waters.forEach(w => {
    waterGfx.fillStyle(0x1a3d6b, 1);
    waterGfx.fillRoundedRect(w.x - 3, w.y - 3, w.w + 6, w.h + 6, 8);
    waterGfx.fillStyle(0x4a9fd4, 1);
    waterGfx.fillRoundedRect(w.x, w.y, w.w, w.h, 6);
    waterGfx.fillStyle(0x6dc0e8, 0.5);
    waterGfx.fillRoundedRect(w.x + 14, w.y + 14, w.w - 28, w.h - 28, 4);
  });

  // Rocks in water
  [
    { x: 670, y: 230, key: 'rockInWater1' }, { x: 740, y: 260, key: 'rockInWater2' },
    { x: 710, y: 280, key: 'rockInWater3' }, { x: 130, y: 1130, key: 'rockInWater4' },
    { x: 200, y: 1170, key: 'rockInWater5' }, { x: 160, y: 1190, key: 'rockInWater6' },
    { x: 1430, y: 930, key: 'rockInWater1' }, { x: 1480, y: 960, key: 'rockInWater3' },
  ].forEach(r => scene.add.image(r.x, r.y, r.key).setDepth(DEPTH.WATER + 1));

  // Lillies
  [
    { x: 690, y: 220 }, { x: 730, y: 250 }, { x: 760, y: 240 },
    { x: 145, y: 1125 }, { x: 220, y: 1165 }, { x: 1450, y: 925 },
  ].forEach(l => scene.add.image(l.x, l.y, 'waterLillies', Phaser.Math.Between(0, 5)).setDepth(DEPTH.WATER + 1));
}

export function createTrees(scene: Phaser.Scene) {
  const treeGfx = scene.add.graphics().setDepth(DEPTH.TREE);
  const positions = [
    { x: 60, y: 100 }, { x: 180, y: 80 }, { x: 60, y: 300 },
    { x: 1900, y: 100 }, { x: 1950, y: 300 }, { x: 1900, y: 500 },
    { x: 60, y: 800 }, { x: 1950, y: 800 },
    { x: 60, y: 1200 }, { x: 1950, y: 1200 },
    { x: 60, y: 1400 }, { x: 1950, y: 1400 },
    { x: 580, y: 180 }, { x: 820, y: 200 }, { x: 750, y: 150 },
    { x: 150, y: 250 }, { x: 650, y: 400 },
    { x: 1550, y: 1050 }, { x: 1650, y: 1150 }, { x: 1750, y: 1050 },
    { x: 1850, y: 1150 }, { x: 1700, y: 1250 }, { x: 1550, y: 1300 },
    { x: 500, y: 1050 }, { x: 550, y: 1200 }, { x: 400, y: 1350 },
    { x: 800, y: 600 }, { x: 1200, y: 600 },
    { x: 800, y: 850 }, { x: 1200, y: 850 },
  ];

  positions.forEach(pos => {
    const s = Phaser.Math.FloatBetween(0.85, 1.2);
    // Shadow
    treeGfx.fillStyle(0x1a4a1a, 0.2);
    treeGfx.fillEllipse(pos.x, pos.y + 14 * s, 22 * s, 8 * s);
    // Trunk
    treeGfx.fillStyle(0x4a2a10, 1);
    treeGfx.fillRect(pos.x - 2.5 * s, pos.y - 2 * s, 5 * s, 18 * s);
    treeGfx.fillStyle(0x5c3818, 1);
    treeGfx.fillRect(pos.x - 1 * s, pos.y, 2 * s, 14 * s);
    // Canopy
    treeGfx.fillStyle(0x1a6b1a, 1);
    treeGfx.fillCircle(pos.x - 5 * s, pos.y - 14 * s, 11 * s);
    treeGfx.fillCircle(pos.x + 7 * s, pos.y - 12 * s, 9 * s);
    treeGfx.fillStyle(0x228b22, 1);
    treeGfx.fillCircle(pos.x, pos.y - 18 * s, 13 * s);
    treeGfx.fillCircle(pos.x - 8 * s, pos.y - 10 * s, 7 * s);
    treeGfx.fillCircle(pos.x + 9 * s, pos.y - 9 * s, 6 * s);
    treeGfx.fillStyle(0x2ea82e, 1);
    treeGfx.fillCircle(pos.x + 3 * s, pos.y - 21 * s, 7 * s);
    treeGfx.fillCircle(pos.x - 4 * s, pos.y - 16 * s, 6 * s);
    treeGfx.fillStyle(0x44cc44, 0.5);
    treeGfx.fillCircle(pos.x - 1 * s, pos.y - 23 * s, 4 * s);
    treeGfx.fillCircle(pos.x + 5 * s, pos.y - 16 * s, 3 * s);
  });
}

export function createDecorations(scene: Phaser.Scene) {
  const gfx = scene.add.graphics().setDepth(DEPTH.DECORATION);
  // Flowers
  const colors = [0xffffff, 0xffe066, 0xff8899, 0xffcc44];
  for (let i = 0; i < 80; i++) {
    const x = Phaser.Math.Between(20, MAP_WIDTH - 20);
    const y = Phaser.Math.Between(20, MAP_HEIGHT - 20);
    gfx.fillStyle(colors[Phaser.Math.Between(0, colors.length - 1)], 0.9);
    gfx.fillCircle(x, y, Phaser.Math.Between(1, 2));
  }
  // Stones
  for (let i = 0; i < 20; i++) {
    const x = Phaser.Math.Between(30, MAP_WIDTH - 30);
    const y = Phaser.Math.Between(30, MAP_HEIGHT - 30);
    gfx.fillStyle(0x6a6a8e, 1);
    gfx.fillEllipse(x, y, Phaser.Math.Between(4, 8), Phaser.Math.Between(3, 5));
  }

  // Fences
  const fences = [
    { x: 220, y: 280, len: 14, h: true }, { x: 220, y: 600, len: 14, h: true },
    { x: 220, y: 280, len: 20, h: false }, { x: 640, y: 250, len: 22, h: false },
    { x: 1440, y: 300, len: 20, h: true }, { x: 1440, y: 650, len: 20, h: true },
  ];
  fences.forEach(f => {
    for (let i = 0; i < f.len; i++) {
      const fx = f.h ? f.x + i * TILE_SIZE + 8 : f.x + 8;
      const fy = f.h ? f.y + 8 : f.y + i * TILE_SIZE + 8;
      scene.add.sprite(fx, fy, 'fences', f.h ? 0 : 4).setDepth(DEPTH.DECORATION);
    }
  });

  // Chests
  [
    { x: 350, y: 480 }, { x: 600, y: 340 }, { x: 1550, y: 450 },
    { x: 1750, y: 550 }, { x: 400, y: 1200 }, { x: 1700, y: 1200 },
  ].forEach(c => scene.add.sprite(c.x, c.y, 'chest1', 0).setDepth(DEPTH.DECORATION).setScale(1.5));
}

export function createBuildings(scene: Phaser.Scene, onHouseClick?: (id: string) => void) {
  HOUSES.forEach(house => {
    const sprite = scene.add.image(house.x, house.y, house.variant)
      .setDepth(DEPTH.BUILDING).setOrigin(0.5, 0.85);
    scene.add.text(house.x, house.y + 22, house.name, {
      fontSize: '6px', color: '#fff', stroke: '#000', strokeThickness: 2, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH.LABEL);
    scene.add.text(house.x, house.y + 31, `${house.price} trofeus`, {
      fontSize: '5px', color: '#ffd700', stroke: '#000', strokeThickness: 1,
    }).setOrigin(0.5).setDepth(DEPTH.LABEL);
    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerdown', (p: Phaser.Input.Pointer) => { p.event.stopPropagation(); if (onHouseClick) onHouseClick(house.id); });
    sprite.on('pointerover', () => sprite.setTint(0xdddddd));
    sprite.on('pointerout', () => sprite.clearTint());
  });
}

export function createChessArenas(scene: Phaser.Scene, onBoardClick?: (id: string) => void) {
  const gfx = scene.add.graphics().setDepth(DEPTH.ARENA);
  ARENAS.forEach(arena => {
    const sz = 32, cell = sz / 8;
    gfx.fillStyle(0x5c4020, 1);
    gfx.fillRoundedRect(arena.x - sz / 2 - 6, arena.y - sz / 2 - 6, sz + 12, sz + 16, 3);
    gfx.fillStyle(0x7a5530, 1);
    gfx.fillRoundedRect(arena.x - sz / 2 - 3, arena.y - sz / 2 - 3, sz + 6, sz + 6, 2);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        gfx.fillStyle((r + c) % 2 === 0 ? 0xf5e6c8 : 0x8b6914, 1);
        gfx.fillRect(arena.x - sz / 2 + c * cell, arena.y - sz / 2 + r * cell, cell, cell);
      }
    }

    const indicator = scene.add.circle(arena.x + sz / 2 + 3, arena.y - sz / 2 - 3, 4, 0x10b981)
      .setDepth(DEPTH.LABEL);
    indicator.setStrokeStyle(1.5, 0xffffff);
    indicator.setData('arenaId', arena.id);

    scene.add.text(arena.x, arena.y + sz / 2 + 10, arena.name, {
      fontSize: '6px', color: '#fff', stroke: '#000', strokeThickness: 2, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH.LABEL);

    const hit = scene.add.rectangle(arena.x, arena.y, sz + 16, sz + 16)
      .setDepth(DEPTH.ARENA + 1).setAlpha(0.001);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => { p.event.stopPropagation(); if (onBoardClick) onBoardClick(arena.id); });
  });
}

export function createCreatures(scene: Phaser.Scene) {
  if (!scene.anims.exists('slime_idle')) {
    scene.anims.create({
      key: 'slime_idle',
      frames: scene.anims.generateFrameNumbers('slime', { start: 0, end: 6 }),
      frameRate: 5, repeat: -1,
    });
  }
  SLIMES.forEach(pos => {
    const slime = scene.add.sprite(pos.x, pos.y, 'slime', 0).setDepth(DEPTH.NPC);
    slime.anims.play('slime_idle', true);
    scene.tweens.add({
      targets: slime, x: pos.x + Phaser.Math.Between(-15, 15), y: pos.y + Phaser.Math.Between(-10, 10),
      duration: Phaser.Math.Between(3000, 5000), ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      delay: Phaser.Math.Between(0, 2000),
    });
  });
}
