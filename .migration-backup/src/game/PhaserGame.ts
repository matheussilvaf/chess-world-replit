import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  // Force even canvas dimensions to prevent half-pixel center offset
  const width = Math.floor(window.innerWidth / 2) * 2;
  const height = Math.floor(window.innerHeight / 2) * 2;

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,
    parent,
    width,
    height,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    backgroundColor: '#2d5a27',
    render: {
      pixelArt: true,
      antialias: false,
      antialiasGL: false,
      roundPixels: true,
      mipmapFilter: 'NEAREST',
    },
    input: {
      activePointers: 3,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [WorldScene],
  };

  return new Phaser.Game(config);
}

export function getWorldScene(game: Phaser.Game): WorldScene | null {
  return game.scene.getScene('WorldScene') as WorldScene | null;
}
