import Phaser from 'phaser';
import { RemotePlayerInterpolator } from '../network/interpolation';
import {
  ANIMAL_ANIMATION_COLUMNS,
  ANIMAL_DIRECTIONS,
  type AnimalAnimation,
  type HuntingLevel,
} from '../../shared/hunting/HuntingShapes';
import {
  animalAnimationKey,
  animalHurtboxes,
  animalTextureKey,
  ensureAnimalRig,
  ensureAnimalTexture,
  type AnimalRig,
} from './huntingAssets';
import { AnimalPlayback, type AnimalPlaybackState } from './animalPlayback';
import { useHuntingStore } from '../../stores/huntingStore';

export interface AnimalView {
  id: string;
  variantId: string;
  name: string;
  x: number;
  y: number;
  dir: number;
  anim: AnimalAnimation;
  /** Local run frame (0..2) picked by the server while running. */
  frame: number;
  hp: number;
  maxHp: number;
  level: HuntingLevel;
  dead: boolean;
  contractOwner: string;
}

interface Entry {
  view: AnimalView;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite | null;
  label: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
  interpolator: RemotePlayerInterpolator;
  playback: AnimalPlayback;
  playbackState: AnimalPlaybackState;
  rig: AnimalRig | null;
  dying: boolean;
}

const BAR_W = 42;

export class AnimalLayer {
  private entries = new Map<string, Entry>();
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depthForY: (y: number) => number,
    private readonly localUserId: () => string | null,
    private readonly onArrowHit: (animalId: string) => void,
  ) {}

  sync(views: AnimalView[]): void {
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.id);
      const entry = this.entries.get(view.id);
      if (entry) {
        entry.view = view;
        entry.interpolator.pushSnapshot(view.x, view.y);
        entry.playback.push(view.anim, view.dir, view.frame, Date.now());
        if (view.dead) this.fade(entry);
      } else {
        this.add(view);
      }
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** Applies one Colyseus entity patch without touching other interpolation buffers. */
  updateAnimal(view: AnimalView): void {
    const entry = this.entries.get(view.id);
    if (!entry) {
      this.add(view);
      return;
    }
    const moved = entry.view.x !== view.x || entry.view.y !== view.y;
    entry.view = view;
    if (moved) entry.interpolator.pushSnapshot(view.x, view.y);
    entry.playback.push(view.anim, view.dir, view.frame, Date.now());
    if (view.dead) this.fade(entry);
  }

  removeAnimal(id: string): void {
    this.remove(id);
  }

  private add(view: AnimalView): void {
    const container = this.scene.add.container(view.x, view.y).setDepth(this.depthForY(view.y));
    const bar = this.scene.add.graphics();
    const label = this.scene.add.text(0, -42, view.name, {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    container.add([bar, label]);
    const playback = new AnimalPlayback();
    playback.push(view.anim, view.dir, view.frame, Date.now());
    const entry: Entry = {
      view, container, sprite: null, label, bar,
      interpolator: new RemotePlayerInterpolator(view.x, view.y),
      playback,
      playbackState: playback.update(Date.now()),
      rig: null,
      dying: false,
    };
    this.entries.set(view.id, entry);
    void Promise.all([ensureAnimalTexture(this.scene, view.variantId), ensureAnimalRig(view.variantId)]).then(([ok, rig]) => {
      if (!ok || this.destroyed || !container.active || this.entries.get(view.id) !== entry) return;
      entry.rig = rig;
      const sprite = this.scene.add.sprite(0, 0, animalTextureKey(view.variantId));
      sprite.setOrigin(rig.origin.x, rig.origin.y);
      container.addAt(sprite, 0);
      entry.sprite = sprite;
      this.refresh(entry);
    });
    if (view.dead) this.fade(entry);
  }

  tick(deltaMs: number): void {
    const view = this.scene.cameras.main.worldView;
    const bounds = Phaser.Geom.Rectangle.Inflate(new Phaser.Geom.Rectangle(view.x, view.y, view.width, view.height), 200, 200);
    for (const entry of this.entries.values()) {
      const pos = entry.interpolator.getPosition(deltaMs);
      entry.playbackState = entry.playback.update(Date.now());
      entry.container.setPosition(pos.x, pos.y).setDepth(this.depthForY(pos.y));
      if (!bounds.contains(pos.x, pos.y) || entry.dying) continue;
      this.refresh(entry);
    }
  }

  /**
   * Living animals of the LOCAL player's contract with their current (interpolated) world position —
   * the targets of the HUD compass. Dying animals (already faded) are left out.
   */
  contractTargets(): { id: string; name: string; x: number; y: number }[] {
    const me = this.localUserId();
    if (!me) return [];
    const owner = useHuntingStore.getState().active?.partyId ?? me;
    const out: { id: string; name: string; x: number; y: number }[] = [];
    for (const entry of this.entries.values()) {
      if (entry.dying || entry.view.dead || entry.view.contractOwner !== owner) continue;
      out.push({ id: entry.view.id, name: entry.view.name, x: entry.container.x, y: entry.container.y });
    }
    return out;
  }

  private refresh(entry: Entry): void {
    const { view, sprite, playbackState } = entry;
    const owner = useHuntingStore.getState().active?.partyId ?? this.localUserId();
    entry.label.setText(view.name).setColor(view.contractOwner && view.contractOwner === owner ? '#facc15' : '#ffffff');
    entry.label.setY(sprite ? -Math.max(34, sprite.displayHeight * (1 - sprite.originY) + 7) : -42);
    entry.bar.setY(entry.label.y + 2);
    entry.bar.clear();
    if (view.hp < view.maxHp && view.maxHp > 0) {
      entry.bar.fillStyle(0x111827, 0.9).fillRect(-BAR_W / 2, 0, BAR_W, 4);
      entry.bar.fillStyle(view.hp / view.maxHp < 0.25 ? 0xef4444 : 0x22c55e, 1)
        .fillRect(-BAR_W / 2 + 1, 1, (BAR_W - 2) * Math.max(0, view.hp / view.maxHp), 2);
    }
    if (!sprite) return;
    const direction = ANIMAL_DIRECTIONS[playbackState.dir] ?? 'south';
    if (playbackState.frame !== null) {
      sprite.anims.stop();
      const row = entry.rig?.config?.directions[direction] ?? ANIMAL_DIRECTIONS.indexOf(direction);
      sprite.setFrame(row * 12 + ANIMAL_ANIMATION_COLUMNS.run[playbackState.frame]);
      return;
    }
    const key = animalAnimationKey(view.variantId, playbackState.anim, direction);
    // after a run (frames set by hand, animation stopped) the looping anims must restart even when the key is unchanged
    const restart = !sprite.anims.isPlaying && playbackState.anim !== 'attack';
    if ((sprite.anims.currentAnim?.key !== key || restart) && this.scene.anims.exists(key)) sprite.play(key);
  }

  tryProjectileHit(rects: Phaser.Geom.Rectangle[]): boolean {
    for (const entry of this.entries.values()) {
      if (entry.view.dead || !entry.sprite) continue;
      const direction = ANIMAL_DIRECTIONS[entry.playbackState.dir] ?? 'south';
      const columns = ANIMAL_ANIMATION_COLUMNS[entry.playbackState.anim];
      const frameColumn = Number(entry.sprite.frame.name);
      const localFrame = Math.max(0, columns.indexOf(frameColumn % 12));
      const hurtboxes = animalHurtboxes(entry.rig ?? { origin: { x: 0.5, y: 0.8 }, config: null }, entry.playbackState.anim, direction, localFrame);
      for (const hurtbox of hurtboxes) {
        const world = new Phaser.Geom.Rectangle(
          entry.container.x + hurtbox.x, entry.container.y + hurtbox.y, hurtbox.width, hurtbox.height,
        );
        if (rects.some((rect) => Phaser.Geom.Intersects.RectangleToRectangle(rect, world))) {
          this.onArrowHit(entry.view.id);
          return true;
        }
      }
    }
    return false;
  }

  flashHit(animalId: string, damage: number): void {
    const entry = this.entries.get(animalId);
    const sprite = entry?.sprite;
    if (sprite) {
      sprite.setTint(0xff5b5b).setTintMode(Phaser.TintModes.FILL);
      this.scene.time.delayedCall(120, () => {
        if (sprite.active) sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      });
    }
    if (!entry) return;
    const text = this.scene.add.text(entry.container.x, entry.container.y - 42, `-${Math.max(0, Math.round(damage))}`, {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#fecaca', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(this.depthForY(entry.container.y) + 2);
    this.scene.tweens.add({ targets: text, y: text.y - 24, alpha: 0, duration: 650, onComplete: () => text.destroy() });
  }

  private fade(entry: Entry): void {
    if (entry.dying) return;
    entry.dying = true;
    this.scene.tweens.add({ targets: entry.container, alpha: 0, duration: 400 });
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.container.destroy(true);
    this.entries.delete(id);
  }

  destroy(): void {
    this.destroyed = true;
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}