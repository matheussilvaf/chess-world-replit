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
import { AnimalPlayback, cullState, type AnimalPlaybackState } from './animalPlayback';
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
  label: Phaser.GameObjects.Text | null;
  bar: Phaser.GameObjects.Graphics | null;
  interpolator: RemotePlayerInterpolator;
  playback: AnimalPlayback;
  playbackState: AnimalPlaybackState;
  rig: AnimalRig | null;
  dying: boolean;
  live: boolean;
  materialized: boolean;
  loading: boolean;
  pausedAnim: boolean;
  depth: number;
  lastLabelText: string;
  lastLabelColor: string;
  lastLabelY: number;
  lastHp: number;
  lastMaxHp: number;
  lastAnimKey: string;
  lastFrame: number | null;
  detailsVisible: boolean;
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
    const now = Date.now();
    for (const view of views) {
      seen.add(view.id);
      const entry = this.entries.get(view.id);
      if (entry) {
        const moved = entry.view.x !== view.x || entry.view.y !== view.y;
        entry.view = view;
        if (moved) entry.interpolator.pushSnapshot(view.x, view.y);
        entry.playback.push(view.anim, view.dir, view.frame, now);
        if (moved && !entry.live && !entry.dying) entry.container.setPosition(view.x, view.y);
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
    if (!entry.live && !entry.dying && moved) entry.container.setPosition(view.x, view.y);
    entry.playback.push(view.anim, view.dir, view.frame, Date.now());
    if (view.dead) this.fade(entry);
  }

  removeAnimal(id: string): void {
    this.remove(id);
  }

  private add(view: AnimalView): void {
    const container = this.scene.add.container(view.x, view.y).setDepth(this.depthForY(view.y));
    container.setVisible(false);
    const playback = new AnimalPlayback();
    const now = Date.now();
    playback.push(view.anim, view.dir, view.frame, now);
    const depth = this.depthForY(view.y);
    const entry: Entry = {
      view, container, sprite: null, label: null, bar: null,
      interpolator: new RemotePlayerInterpolator(view.x, view.y),
      playback,
      playbackState: playback.update(now),
      rig: null,
      dying: false,
      live: false,
      materialized: false,
      loading: false,
      pausedAnim: false,
      depth,
      lastLabelText: '',
      lastLabelColor: '',
      lastLabelY: Number.NaN,
      lastHp: Number.NaN,
      lastMaxHp: Number.NaN,
      lastAnimKey: '',
      lastFrame: null,
      detailsVisible: true,
    };
    this.entries.set(view.id, entry);
    if (view.dead) this.fade(entry);
  }

  private materialize(entry: Entry): void {
    if (entry.materialized || entry.loading || this.destroyed) return;
    entry.materialized = true;
    const bar = this.scene.add.graphics();
    const label = this.scene.add.text(0, -42, entry.view.name, {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    entry.bar = bar;
    entry.label = label;
    entry.container.add([bar, label]);
    entry.loading = true;
    const id = entry.view.id;
    const variantId = entry.view.variantId;
    void Promise.all([ensureAnimalTexture(this.scene, variantId), ensureAnimalRig(variantId)]).then(([ok, rig]) => {
      entry.loading = false;
      if (!ok || this.destroyed || !entry.container.active || this.entries.get(id) !== entry) return;
      entry.rig = rig;
      const sprite = this.scene.add.sprite(0, 0, animalTextureKey(variantId));
      sprite.setOrigin(rig.origin.x, rig.origin.y);
      entry.container.addAt(sprite, 0);
      entry.sprite = sprite;
      if (!entry.live && !entry.dying) sprite.setVisible(false);
      else this.refresh(entry, this.owner(), true, this.scene.cameras.main.zoom >= 0.9);
    });
  }

  tick(deltaMs: number): void {
    const view = this.scene.cameras.main.worldView;
    const left = view.x;
    const right = view.right;
    const top = view.y;
    const bottom = view.bottom;
    const now = Date.now();
    const owner = this.owner();
    const detailsVisible = this.scene.cameras.main.zoom >= 0.9;
    for (const entry of this.entries.values()) {
      const inView = this.visibleTo(entry.view, owner) && (entry.dying || cullState(
        entry.view.x, entry.view.y, left, right, top, bottom, 200, entry.live,
      ));
      if (!inView) {
        if (entry.live) {
          entry.live = false;
          entry.container.setVisible(false);
          if (entry.sprite?.anims.isPlaying) {
            entry.sprite.anims.pause();
            entry.pausedAnim = true;
          }
        }
        if (entry.container.x !== entry.view.x || entry.container.y !== entry.view.y) {
          entry.container.setPosition(entry.view.x, entry.view.y);
        }
        entry.playback.snapLatest();
        continue;
      }
      let force = false;
      if (!entry.live) {
        entry.live = true;
        entry.interpolator.reset(entry.view.x, entry.view.y);
        entry.container.setPosition(entry.view.x, entry.view.y).setVisible(true);
        if (entry.sprite) entry.sprite.setVisible(true);
        if (entry.pausedAnim) {
          entry.sprite?.anims.resume();
          entry.pausedAnim = false;
        }
        this.materialize(entry);
        force = true;
      }
      const pos = entry.interpolator.getPosition(deltaMs);
      entry.playbackState = entry.playback.update(now);
      entry.container.setPosition(pos.x, pos.y);
      const depth = this.depthForY(pos.y);
      if (depth !== entry.depth) {
        entry.depth = depth;
        entry.container.setDepth(depth);
      }
      this.refresh(entry, owner, force, detailsVisible);
    }
  }

  private owner(): string | null {
    return useHuntingStore.getState().active?.partyId ?? this.localUserId();
  }

  /**
   * Animal de contrato de OUTRO jogador/grupo não existe para mim: não renderiza, não é
   * acertável nem aparece na bússola (o servidor também ignora golpes/alvos de não-membros).
   */
  private visibleTo(view: AnimalView, owner: string | null): boolean {
    if (!view.contractOwner) return true;
    return view.contractOwner === owner || view.contractOwner === this.localUserId();
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

  private refresh(entry: Entry, owner: string | null, force = false, detailsVisible = true): void {
    const { view, sprite, playbackState } = entry;
    const label = entry.label;
    const bar = entry.bar;
    if (label && bar) {
      if (force || detailsVisible !== entry.detailsVisible) {
        entry.detailsVisible = detailsVisible;
        label.setVisible(detailsVisible);
        bar.setVisible(detailsVisible);
      }
      const color = view.contractOwner && view.contractOwner === owner ? '#facc15' : '#ffffff';
      if (force || entry.lastLabelText !== view.name) {
        entry.lastLabelText = view.name;
        label.setText(view.name);
      }
      if (force || entry.lastLabelColor !== color) {
        entry.lastLabelColor = color;
        label.setColor(color);
      }
      const labelY = sprite ? -Math.max(34, sprite.displayHeight * (1 - sprite.originY) + 7) : -42;
      if (force || entry.lastLabelY !== labelY) {
        entry.lastLabelY = labelY;
        label.setY(labelY);
        bar.setY(labelY + 2);
      }
      if (force || entry.lastHp !== view.hp || entry.lastMaxHp !== view.maxHp) {
        entry.lastHp = view.hp;
        entry.lastMaxHp = view.maxHp;
        bar.clear();
        if (view.hp < view.maxHp && view.maxHp > 0) {
          bar.fillStyle(0x111827, 0.9).fillRect(-BAR_W / 2, 0, BAR_W, 4);
          bar.fillStyle(view.hp / view.maxHp < 0.25 ? 0xef4444 : 0x22c55e, 1)
            .fillRect(-BAR_W / 2 + 1, 1, (BAR_W - 2) * Math.max(0, view.hp / view.maxHp), 2);
        }
      }
    }
    if (!sprite) return;
    const direction = ANIMAL_DIRECTIONS[playbackState.dir] ?? 'south';
    if (playbackState.frame !== null) {
      if (entry.lastFrame !== playbackState.frame || entry.lastAnimKey !== `run:${direction}`) {
        entry.lastAnimKey = `run:${direction}`;
        entry.lastFrame = playbackState.frame;
        sprite.anims.stop();
        const row = entry.rig?.config?.directions[direction] ?? ANIMAL_DIRECTIONS.indexOf(direction);
        sprite.setFrame(row * 12 + ANIMAL_ANIMATION_COLUMNS.run[playbackState.frame]);
      }
      return;
    }
    const key = animalAnimationKey(view.variantId, playbackState.anim, direction);
    // after a run (frames set by hand, animation stopped) the looping anims must restart even when the key is unchanged
    const restart = !sprite.anims.isPlaying && playbackState.anim !== 'attack';
    if ((entry.lastAnimKey !== key || restart) && this.scene.anims.exists(key)) {
      entry.lastAnimKey = key;
      entry.lastFrame = null;
      sprite.play(key);
    }
  }

  tryProjectileHit(rects: Phaser.Geom.Rectangle[]): boolean {
    const owner = this.owner();
    for (const entry of this.entries.values()) {
      if (entry.view.dead || !this.visibleTo(entry.view, owner)) continue;
      const direction = ANIMAL_DIRECTIONS[entry.playbackState.dir] ?? 'south';
      const columns = ANIMAL_ANIMATION_COLUMNS[entry.playbackState.anim];
      // Sem sprite (fora da tela / textura ainda carregando) o bicho continua acertável: hurtbox do 1º quadro.
      const frameColumn = entry.sprite ? Number(entry.sprite.frame.name) : columns[0];
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
    if (entry && !this.visibleTo(entry.view, this.owner())) return; // não denunciar animal de contrato alheio
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
    if (!this.visibleTo(entry.view, this.owner())) return; // some sem aparecer
    if (!entry.live) {
      entry.interpolator.reset(entry.view.x, entry.view.y);
      entry.container.setPosition(entry.view.x, entry.view.y);
      if (entry.sprite) entry.sprite.setVisible(true);
      if (entry.pausedAnim) {
        entry.sprite?.anims.resume();
        entry.pausedAnim = false;
      }
    }
    entry.live = true;
    entry.container.setVisible(true);
    this.materialize(entry);
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