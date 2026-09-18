import Phaser from 'phaser';
import {
  NPC_ASSET_ROOT,
  NPC_DIRECTION_ORDER,
  NPC_DIRECTION_ROWS,
  NPC_FRAME_SIZE,
  NPC_SHEETS,
  type NpcDirection,
} from '../../shared/hunting/HuntingShapes';
import { RemotePlayerInterpolator } from '../network/interpolation';

export interface NpcView { id: string; x: number; y: number; dir: number; isMoving: boolean }
interface Entry {
  view: NpcView;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  zone: Phaser.GameObjects.Zone;
  interpolator: RemotePlayerInterpolator;
}

const textureKey = (kind: 'idle' | 'walk') => `hunting:npc:${kind}`;
const animKey = (kind: 'idle' | 'walk', direction: NpcDirection) => `hunting:npc:${kind}:${direction}`;

export class NpcLayer {
  private entries = new Map<string, Entry>();
  private ready: Promise<boolean>;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depthForY: (y: number) => number,
    private readonly onTalk: () => void,
  ) {
    this.ready = this.ensureAssets();
  }

  private ensureAssets(): Promise<boolean> {
    if (this.scene.textures.exists(textureKey('idle')) && this.scene.textures.exists(textureKey('walk'))) {
      this.createAnimations();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      for (const kind of ['idle', 'walk'] as const) {
        const sheet = NPC_SHEETS[kind];
        if (!this.scene.textures.exists(textureKey(kind))) {
          this.scene.load.spritesheet(textureKey(kind), encodeURI(`${import.meta.env.BASE_URL}${NPC_ASSET_ROOT}/${sheet.file}`), {
            frameWidth: NPC_FRAME_SIZE, frameHeight: NPC_FRAME_SIZE,
          });
        }
      }
      this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        const ok = this.scene.textures.exists(textureKey('idle')) && this.scene.textures.exists(textureKey('walk'));
        if (ok) this.createAnimations();
        resolve(ok);
      });
      this.scene.load.start();
    });
  }

  private createAnimations(): void {
    for (const kind of ['idle', 'walk'] as const) {
      const sheet = NPC_SHEETS[kind];
      for (const direction of NPC_DIRECTION_ORDER) {
        const key = animKey(kind, direction);
        if (this.scene.anims.exists(key)) continue;
        const row = NPC_DIRECTION_ROWS[direction];
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(textureKey(kind), { start: row * sheet.columns, end: row * sheet.columns + sheet.columns - 1 }),
          frameRate: sheet.fps, repeat: -1,
        });
      }
    }
  }

  sync(views: NpcView[]): void {
    const seen = new Set(views.map((view) => view.id));
    for (const view of views) {
      const entry = this.entries.get(view.id);
      if (entry) {
        entry.view = view;
        entry.interpolator.pushSnapshot(view.x, view.y);
      } else {
        void this.add(view);
      }
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** Applies one Colyseus entity patch without resyncing the whole NPC map. */
  updateNpc(view: NpcView): void {
    const entry = this.entries.get(view.id);
    if (!entry) {
      void this.add(view);
      return;
    }
    const moved = entry.view.x !== view.x || entry.view.y !== view.y;
    entry.view = view;
    if (moved) entry.interpolator.pushSnapshot(view.x, view.y);
  }

  removeNpc(id: string): void {
    this.remove(id);
  }

  private async add(view: NpcView): Promise<void> {
    if (!(await this.ready) || this.entries.has(view.id) || !this.scene.sys.displayList) return;
    const container = this.scene.add.container(view.x, view.y).setDepth(this.depthForY(view.y));
    const sprite = this.scene.add.sprite(0, 0, textureKey('idle')).setOrigin(0.5, 0.9);
    const label = this.scene.add.text(0, -31, 'Líder dos Caçadores', {
      fontFamily: 'monospace', fontSize: '10px', color: '#fde68a', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    const zone = this.scene.add.zone(0, -14, 34, 42).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.stopPropagation?.();
      this.onTalk();
    });
    container.add([sprite, label, zone]);
    this.entries.set(view.id, { view, container, sprite, zone, interpolator: new RemotePlayerInterpolator(view.x, view.y) });
  }

  tick(deltaMs: number): void {
    for (const entry of this.entries.values()) {
      const pos = entry.interpolator.getPosition(deltaMs);
      entry.container.setPosition(pos.x, pos.y).setDepth(this.depthForY(pos.y));
      const direction = NPC_DIRECTION_ORDER[entry.view.dir] ?? 'south';
      const key = animKey(entry.view.isMoving ? 'walk' : 'idle', direction);
      if (entry.sprite.anims.currentAnim?.key !== key) entry.sprite.play(key);
    }
  }

  hitTest(x: number, y: number): boolean {
    for (const entry of this.entries.values()) {
      if (new Phaser.Geom.Rectangle(entry.container.x - 17, entry.container.y - 36, 34, 42).contains(x, y)) return true;
    }
    return false;
  }

  private remove(id: string): void {
    this.entries.get(id)?.container.destroy(true);
    this.entries.delete(id);
  }
  destroy(): void { for (const id of [...this.entries.keys()]) this.remove(id); }
}