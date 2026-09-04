/**
 * Estações portáteis posicionadas no Mundo de Coleta — desenho e colisão no
 * Phaser (o estado vem do `placedStationsStore`, alimentado pela sala).
 *
 * Por estação: container ancorado no centro da base do corpo (Y-sort pelo
 * mesmo `depthForY` de árvores/jogadores), sprite animado (5 frames) ou
 * estático, barra dos 5 minutos + nome do dono acima do sprite, zona clicável
 * = retângulo do corpo. Colisão exata: corpo estático do Matter (jogador) e
 * retângulo dinâmico na grade do pathfinder (rotas do jogador e animais) —
 * `onCollisionRectsChanged` entrega os rects ao WorldScene.
 *
 * O "fantasma" do posicionamento (preview verde/vermelho) também vive aqui.
 */
import Phaser from 'phaser';
import {
  PLACEABLE_STATIONS,
  placeableStationFor,
  placedStationRect,
  placedStationSpriteOffset,
  pointInRect,
  type PlaceableStationDef,
  type Rect,
} from '../../shared/craft/PlaceableStations';
import type { PlacedStationView } from '../../stores/placedStationsStore';

const textureKeyFor = (def: PlaceableStationDef) => `placed-station:${def.itemId}`;
const animKeyFor = (def: PlaceableStationDef) => `placed-station-anim:${def.itemId}`;

const BAR_W = 56;
const BAR_H = 5;

interface Entry {
  view: PlacedStationView;
  def: PlaceableStationDef;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite | null;
  bar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  body: MatterJS.BodyType | null;
}

export interface PlacementGhost {
  itemKey: string;
  x: number;
  y: number;
  valid: boolean;
}

export class PlacedStationLayer {
  private entries = new Map<string, Entry>();
  private ghost: { container: Phaser.GameObjects.Container; itemKey: string } | null = null;
  private loading = new Set<string>();
  private onTexture = new Map<string, Array<() => void>>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depthForY: (y: number) => number,
    private readonly onClick: (placedId: string) => void,
    private readonly onCollisionRectsChanged: (rects: Rect[]) => void,
  ) {}

  /** Mesmos rects usados na colisão (corpo exato de cada estação). */
  collisionRects(): Rect[] {
    return [...this.entries.values()].map((e) => placedStationRect(e.def, e.view.x, e.view.y));
  }

  /** Estação cujo corpo contém o ponto (mundo), se houver. */
  hitTest(worldX: number, worldY: number): string | null {
    for (const [id, entry] of this.entries) {
      if (pointInRect(worldX, worldY, placedStationRect(entry.def, entry.view.x, entry.view.y))) return id;
    }
    return null;
  }

  /** Reconcilia com o store: cria, atualiza e remove. */
  sync(views: PlacedStationView[]): void {
    if (!this.scene.sys?.displayList) return;
    const seen = new Set<string>();
    let collisionDirty = false;
    for (const view of views) {
      seen.add(view.id);
      const existing = this.entries.get(view.id);
      if (!existing) {
        if (this.create(view)) collisionDirty = true;
        continue;
      }
      const moved = existing.view.x !== view.x || existing.view.y !== view.y;
      existing.view = view;
      if (moved) {
        existing.container.setPosition(view.x, view.y).setDepth(this.depthForY(view.y));
        this.rebuildBody(existing);
        collisionDirty = true;
      }
      this.refreshLabel(existing);
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) {
        this.destroyEntry(id);
        collisionDirty = true;
      }
    }
    if (collisionDirty) this.onCollisionRectsChanged(this.collisionRects());
  }

  /** Atualiza as barras de tempo (chamar ~4x/s). */
  tick(now: number): void {
    for (const entry of this.entries.values()) this.drawBar(entry, now);
  }

  /** Reaplica os corpos do Matter depois de uma troca de mapa (o mundo físico foi reconstruído). */
  reattachBodies(): void {
    for (const entry of this.entries.values()) this.rebuildBody(entry);
    this.onCollisionRectsChanged(this.collisionRects());
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.destroyEntry(id);
    this.setGhost(null);
    this.onCollisionRectsChanged([]);
  }

  destroy(): void {
    this.clear();
    this.onTexture.clear();
    this.loading.clear();
  }

  /** Preview do posicionamento: sprite semitransparente + retângulo do corpo (verde/vermelho). */
  setGhost(ghost: PlacementGhost | null): void {
    if (!ghost) {
      this.ghost?.container.destroy();
      this.ghost = null;
      return;
    }
    const def = placeableStationFor(ghost.itemKey);
    if (!def || !this.scene.sys?.displayList) return;
    if (!this.ghost || this.ghost.itemKey !== ghost.itemKey) {
      this.ghost?.container.destroy();
      const container = this.scene.add.container(ghost.x, ghost.y);
      this.ghost = { container, itemKey: ghost.itemKey };
      const offset = placedStationSpriteOffset(def);
      this.withTexture(def, () => {
        if (!container.active || this.ghost?.container !== container) return;
        const sprite = this.scene.add.image(offset.x, offset.y, textureKeyFor(def), 0).setOrigin(0.5, 1).setAlpha(0.65);
        container.addAt(sprite, 0);
      });
      const outline = this.scene.add.graphics().setName('outline');
      container.add(outline);
    }
    const container = this.ghost.container;
    container.setPosition(ghost.x, ghost.y).setDepth(this.depthForY(ghost.y) + 1);
    const outline = container.getByName('outline') as Phaser.GameObjects.Graphics | null;
    if (outline) {
      const rect = placedStationRect(def, 0, 0);
      outline.clear();
      const color = ghost.valid ? 0x4ade80 : 0xf87171;
      outline.fillStyle(color, 0.18);
      outline.fillRect(rect.x, rect.y, rect.width, rect.height);
      outline.lineStyle(2, color, 0.95);
      outline.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // ------------------------------------------------------------------ internos

  private create(view: PlacedStationView): boolean {
    const def = placeableStationFor(view.itemKey);
    if (!def) return false;
    const container = this.scene.add.container(view.x, view.y).setDepth(this.depthForY(view.y));
    const offset = placedStationSpriteOffset(def);
    const body = placedStationRect(def, 0, 0);
    // Zona clicável = corpo exato.
    const zone = this.scene.add.zone(body.x + body.width / 2, body.y + body.height / 2, body.width, body.height)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.onClick(view.id);
    });
    const bar = this.scene.add.graphics();
    const topY = offset.y - def.sprite.frameHeight; // topo do frame em relação à âncora
    const label = this.scene.add
      .text(0, topY - 12, '', { fontFamily: 'monospace', fontSize: '9px', color: '#fde68a', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    container.add([zone, bar, label]);
    const entry: Entry = { view, def, container, sprite: null, bar, label, body: null };
    this.entries.set(view.id, entry);
    this.withTexture(def, () => {
      if (!container.active || this.entries.get(view.id) !== entry) return;
      const sprite = this.scene.add.sprite(offset.x, offset.y, textureKeyFor(def), 0).setOrigin(0.5, 1);
      container.addAt(sprite, 0);
      entry.sprite = sprite;
      if (def.sprite.frames > 1) {
        const animKey = animKeyFor(def);
        if (!this.scene.anims.exists(animKey)) {
          this.scene.anims.create({
            key: animKey,
            frames: this.scene.anims.generateFrameNumbers(textureKeyFor(def), { start: 0, end: def.sprite.frames - 1 }),
            frameRate: def.sprite.fps,
            repeat: -1,
          });
        }
        sprite.play(animKey);
      }
    });
    this.refreshLabel(entry);
    this.drawBar(entry, Date.now());
    this.rebuildBody(entry);
    return true;
  }

  private refreshLabel(entry: Entry): void {
    entry.label.setText(entry.view.ownerName ? `${entry.view.ownerName}` : '');
  }

  private drawBar(entry: Entry, now: number): void {
    const { view, def, bar } = entry;
    const total = Math.max(1, view.expiresAt - view.placedAt);
    const ratio = Math.max(0, Math.min(1, (view.expiresAt - now) / total));
    const offset = placedStationSpriteOffset(def);
    const topY = offset.y - def.sprite.frameHeight;
    const x = -BAR_W / 2;
    const y = topY - 9;
    bar.clear();
    bar.fillStyle(0x000000, 0.7);
    bar.fillRect(x - 1, y - 1, BAR_W + 2, BAR_H + 2);
    bar.fillStyle(0x3b2a14, 1);
    bar.fillRect(x, y, BAR_W, BAR_H);
    const color = ratio > 0.5 ? 0x4ade80 : ratio > 0.2 ? 0xfbbf24 : 0xf87171;
    bar.fillStyle(color, 1);
    bar.fillRect(x, y, Math.round(BAR_W * ratio), BAR_H);
  }

  private rebuildBody(entry: Entry): void {
    const matter = (this.scene as Phaser.Scene & { matter?: Phaser.Physics.Matter.MatterPhysics }).matter;
    if (!matter?.world) return;
    if (entry.body) {
      try { matter.world.remove(entry.body); } catch { /* corpo já fora do mundo */ }
      entry.body = null;
    }
    const rect = placedStationRect(entry.def, entry.view.x, entry.view.y);
    entry.body = matter.add.rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, {
      isStatic: true,
      label: `placed-station:${entry.view.id}`,
    });
  }

  private destroyEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const matter = (this.scene as Phaser.Scene & { matter?: Phaser.Physics.Matter.MatterPhysics }).matter;
    if (entry.body && matter?.world) {
      try { matter.world.remove(entry.body); } catch { /* já removido */ }
    }
    entry.container.destroy();
  }

  /** Garante a textura (spritesheet) carregada e chama `ready`. */
  private withTexture(def: PlaceableStationDef, ready: () => void): void {
    const key = textureKeyFor(def);
    if (this.scene.textures.exists(key)) {
      ready();
      return;
    }
    const waiters = this.onTexture.get(key) ?? [];
    waiters.push(ready);
    this.onTexture.set(key, waiters);
    if (this.loading.has(key)) return;
    this.loading.add(key);
    this.scene.load.spritesheet(key, encodeURI(def.sprite.url), {
      frameWidth: def.sprite.frameWidth,
      frameHeight: def.sprite.frameHeight,
    });
    const flush = () => {
      this.loading.delete(key);
      const pending = this.onTexture.get(key) ?? [];
      this.onTexture.delete(key);
      if (!this.scene.textures.exists(key)) return; // arquivo ausente: fica sem sprite (zona/barra continuam)
      this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      for (const fn of pending) fn();
    };
    const onError = (file: { key?: string }) => {
      if (file?.key !== key) return;
      this.scene.load.off('loaderror', onError);
      flush();
    };
    this.scene.load.on('loaderror', onError);
    this.scene.load.once(`filecomplete-spritesheet-${key}`, () => {
      this.scene.load.off('loaderror', onError);
      flush();
    });
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }
}

/** Pré-carrega as folhas das estações portáteis (opcional, evita "pop-in"). */
export function preloadPlaceableStationSheets(scene: Phaser.Scene): void {
  for (const def of PLACEABLE_STATIONS) {
    const key = textureKeyFor(def);
    if (scene.textures.exists(key)) continue;
    scene.load.spritesheet(key, encodeURI(def.sprite.url), { frameWidth: def.sprite.frameWidth, frameHeight: def.sprite.frameHeight });
  }
}
