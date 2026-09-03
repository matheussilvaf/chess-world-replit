import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';
import { getPerformanceSettings } from './performanceSettings';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  // Force even canvas dimensions to prevent half-pixel center offset
  const width = Math.floor(window.innerWidth / 2) * 2;
  const height = Math.floor(window.innerHeight / 2) * 2;

  const perf = getPerformanceSettings();

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
    // Modo Economia: limita o loop a 30 FPS (menos bateria/aquecimento).
    ...(perf.mode === 'battery' ? { fps: { limit: 30 } } : {}),
  };

  const game = new Phaser.Game(config);
  // Medidor de FPS do painel de desempenho lê o loop daqui.
  (window as any).__cwGame = game;
  return game;
}

export function getWorldScene(game: Phaser.Game): WorldScene | null {
  return game.scene.getScene('WorldScene') as WorldScene | null;
}
