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
import { cullState } from './animalPlayback';

export interface NpcView { id: string; x: number; y: number; dir: number; isMoving: boolean }
interface Entry {
  view: NpcView;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  zone: Phaser.GameObjects.Zone;
  interpolator: RemotePlayerInterpolator;
  live: boolean;
  pausedAnim: boolean;
  depth: number;
}

const textureKey = (kind: 'idle' | 'walk') => `hunting:npc:${kind}`;
/** Sprite origin is (0.5, 0.9): the frame spans from -0.9·F (head) to +0.1·F (feet) around the container. */
const SPRITE_ORIGIN_Y = 0.9;
const SPRITE_TOP = -NPC_FRAME_SIZE * SPRITE_ORIGIN_Y;
const SPRITE_BOTTOM = NPC_FRAME_SIZE * (1 - SPRITE_ORIGIN_Y);
/** Clickable area: the frame plus a small margin. */
const HIT_W = NPC_FRAME_SIZE + 2;
const HIT_TOP = SPRITE_TOP - 6;
const HIT_H = SPRITE_BOTTOM + 4 - HIT_TOP;
const LABEL_Y = SPRITE_TOP - 3;
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
        const moved = entry.view.x !== view.x || entry.view.y !== view.y;
        entry.view = view;
        if (moved) entry.interpolator.pushSnapshot(view.x, view.y);
        if (moved && !entry.live) entry.container.setPosition(view.x, view.y);
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
    if (moved && !entry.live) entry.container.setPosition(view.x, view.y);
  }

  removeNpc(id: string): void {
    this.remove(id);
  }

  private async add(view: NpcView): Promise<void> {
    if (!(await this.ready) || this.entries.has(view.id) || !this.scene.sys.displayList) return;
    const container = this.scene.add.container(view.x, view.y).setDepth(this.depthForY(view.y));
    container.setVisible(false);
    const sprite = this.scene.add.sprite(0, 0, textureKey('idle')).setOrigin(0.5, SPRITE_ORIGIN_Y);
    const label = this.scene.add.text(0, LABEL_Y, 'Líder dos Caçadores', {
      fontFamily: 'monospace', fontSize: '10px', color: '#fde68a', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    const zone = this.scene.add.zone(0, HIT_TOP + HIT_H / 2, HIT_W, HIT_H).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.stopPropagation?.();
      this.onTalk();
    });
    container.add([sprite, label, zone]);
    this.entries.set(view.id, {
      view,
      container,
      sprite,
      zone,
      interpolator: new RemotePlayerInterpolator(view.x, view.y),
      live: false,
      pausedAnim: false,
      depth: this.depthForY(view.y),
    });
  }

  tick(deltaMs: number): void {
    const view = this.scene.cameras.main.worldView;
    const left = view.x;
    const right = view.right;
    const top = view.y;
    const bottom = view.bottom;
    for (const entry of this.entries.values()) {
      const inView = cullState(entry.view.x, entry.view.y, left, right, top, bottom, 200, entry.live);
      if (!inView) {
        if (entry.live) {
          entry.live = false;
          entry.container.setVisible(false);
          if (entry.sprite.anims.isPlaying) {
            entry.sprite.anims.pause();
            entry.pausedAnim = true;
          }
        }
        if (entry.container.x !== entry.view.x || entry.container.y !== entry.view.y) {
          entry.container.setPosition(entry.view.x, entry.view.y);
        }
        continue;
      }
      if (!entry.live) {
        entry.live = true;
        entry.interpolator.reset(entry.view.x, entry.view.y);
        entry.container.setPosition(entry.view.x, entry.view.y).setVisible(true);
        if (entry.pausedAnim) {
          entry.sprite.anims.resume();
          entry.pausedAnim = false;
        }
      }
      const pos = entry.interpolator.getPosition(deltaMs);
      entry.container.setPosition(pos.x, pos.y);
      const depth = this.depthForY(pos.y);
      if (depth !== entry.depth) {
        entry.depth = depth;
        entry.container.setDepth(depth);
      }
      const direction = NPC_DIRECTION_ORDER[entry.view.dir] ?? 'south';
      const key = animKey(entry.view.isMoving ? 'walk' : 'idle', direction);
      if (entry.sprite.anims.currentAnim?.key !== key) entry.sprite.play(key);
    }
  }

  hitTest(x: number, y: number): boolean {
    for (const entry of this.entries.values()) {
      const left = entry.container.x - HIT_W / 2;
      const top = entry.container.y + HIT_TOP;
      if (x >= left && x <= left + HIT_W && y >= top && y <= top + HIT_H) return true;
    }
    return false;
  }

  private remove(id: string): void {
    this.entries.get(id)?.container.destroy(true);
    this.entries.delete(id);
  }
  destroy(): void { for (const id of [...this.entries.keys()]) this.remove(id); }
}