/**
 * Peças do Big Chess Board no Mundo de Coleta — desenho e acerto no Phaser (o
 * estado vem do `bigChessStore`, alimentado pela sala).
 *
 * Por peça: container ancorado na base da casa (Y-sort pelo mesmo `depthForY`
 * de árvores/jogadores), imagem da peça, barra de HP + nome do dono acima,
 * marcadores de capa/defesa, zona clicável = a casa inteira (abre o card).
 * As peças NÃO bloqueiam o movimento (o tabuleiro continua transitável).
 *
 * Também vivem aqui:
 *   - o "fantasma" do posicionamento (casas iniciais livres realçadas + casa sob
 *     o ponteiro em verde/vermelho);
 *   - o teste de ACERTO local: golpe (hitboxes do perfil da arma) e flecha
 *     contra o retângulo da casa — 1 acerto por golpe/flecha; o servidor decide
 *     o dano e responde (`flashHit` mostra o resultado).
 */
import Phaser from 'phaser';
import {
  bigChessPieceFor,
  bigChessSquareAt,
  bigChessSquareRect,
  bigChessSquaresForItem,
  type BigChessPieceDef,
  type BigChessPieceView,
} from '../../shared/bigchess/BigChessShapes';

const textureKeyFor = (def: BigChessPieceDef) => `bigchess-piece:${def.itemId}`;

const BAR_W = 40;
const BAR_H = 4;
/** Altura máxima do PNG das peças (as imagens têm 38–50 px). */
const PIECE_MAX_H = 50;

export type BigChessHitMode = 'melee' | 'arrow';

interface Entry {
  view: BigChessPieceView;
  def: BigChessPieceDef;
  rect: Phaser.Geom.Rectangle;
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image | null;
  bar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

export interface BigChessGhost {
  itemKey: string;
  /** Casa sob o ponteiro (null = fora do tabuleiro: só as casas candidatas ficam realçadas). */
  square: string | null;
  valid: boolean;
}

export class BigChessPieceLayer {
  private entries = new Map<string, Entry>();
  private ghost: { container: Phaser.GameObjects.Container; itemKey: string; image: Phaser.GameObjects.Image | null } | null = null;
  private lastGhost: BigChessGhost | null = null;
  private loading = new Set<string>();
  private onTexture = new Map<string, Array<() => void>>();
  private lastSwingId = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depthForY: (y: number) => number,
    private readonly onClick: (square: string) => void,
    private readonly onLocalHit: (square: string, mode: BigChessHitMode) => void,
  ) {}

  /** Casa com peça que contém o ponto (mundo), se houver. */
  hitTest(worldX: number, worldY: number): string | null {
    const square = bigChessSquareAt(worldX, worldY);
    return square && this.entries.has(square) ? square : null;
  }

  hasPiece(square: string): boolean {
    return this.entries.has(square);
  }

  hasAnyPiece(): boolean {
    return this.entries.size > 0;
  }

  /** Reconcilia com o store: cria, atualiza e remove. */
  sync(views: BigChessPieceView[]): void {
    if (!this.scene.sys?.displayList) return;
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.square);
      const existing = this.entries.get(view.square);
      if (!existing) {
        this.create(view);
        continue;
      }
      if (existing.view.itemKey !== view.itemKey) {
        // Casa reocupada por outra peça (destruída e reposicionada entre dois syncs).
        this.destroyEntry(view.square);
        this.create(view);
        continue;
      }
      existing.view = view;
      this.refresh(existing);
    }
    for (const square of [...this.entries.keys()]) {
      if (!seen.has(square)) this.destroyEntry(square);
    }
  }

  clear(): void {
    for (const square of [...this.entries.keys()]) this.destroyEntry(square);
    this.setGhost(null);
  }

  destroy(): void {
    this.clear();
    this.onTexture.clear();
    this.loading.clear();
  }

  // --------------------------------------------------------------- acertos

  /**
   * Golpe corpo a corpo em andamento: no primeiro frame em que uma hitbox da
   * arma toca a casa de uma peça, reporta o acerto (uma vez por swingId).
   */
  pollSwing(state: { swingId: number; rects: Phaser.Geom.Rectangle[] }): void {
    if (this.entries.size === 0 || state.rects.length === 0) return;
    if (state.swingId === this.lastSwingId) return;
    const target = this.firstHit(state.rects);
    if (!target) return;
    this.lastSwingId = state.swingId;
    this.onLocalHit(target.view.square, 'melee');
  }

  /** Hitbox de uma flecha local contra as casas com peça; true = conectou (a flecha morre). */
  tryProjectileHit(rects: Phaser.Geom.Rectangle[]): boolean {
    if (this.entries.size === 0 || rects.length === 0) return false;
    const target = this.firstHit(rects);
    if (!target) return false;
    this.onLocalHit(target.view.square, 'arrow');
    return true;
  }

  /** Feedback do servidor a um acerto nosso: pisca a peça e sobe o número do dano. */
  flashHit(square: string, damage: number, destroyed: boolean): void {
    const entry = this.entries.get(square);
    if (!this.scene.sys?.displayList) return;
    const rect = bigChessSquareRect(square);
    const x = rect.x + rect.width / 2;
    const y = rect.y + 6;
    if (entry?.image) {
      const image = entry.image;
      // Phaser 4: fill-tint = setTint + setTintMode (setTintFill não recebe cor).
      image.setTint(0xffffff);
      image.setTintMode(Phaser.TintModes.FILL);
      this.scene.time.delayedCall(70, () => {
        if (image.active) {
          image.setTint(0xff6b6b);
          image.setTintMode(Phaser.TintModes.MULTIPLY);
        }
      });
      this.scene.time.delayedCall(220, () => {
        if (image.active) {
          image.clearTint();
          image.setTintMode(Phaser.TintModes.MULTIPLY);
        }
      });
    }
    const text = this.scene.add
      .text(x, y, destroyed ? 'DESTRUÍDA' : `-${Math.max(0, Math.round(damage))}`, {
        fontFamily: 'monospace',
        fontSize: destroyed ? '11px' : '13px',
        fontStyle: 'bold',
        color: destroyed ? '#fca5a5' : '#fde68a',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(this.depthForY(rect.y + rect.height) + 2);
    this.scene.tweens.add({
      targets: text,
      y: y - 26,
      alpha: 0,
      duration: destroyed ? 1100 : 700,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  // -------------------------------------------------------------- fantasma

  /**
   * Preview do posicionamento: casas iniciais LIVRES da peça em verde fraco;
   * a casa sob o ponteiro em verde/vermelho forte com a imagem semitransparente.
   */
  setGhost(ghost: BigChessGhost | null): void {
    this.lastGhost = ghost;
    if (!ghost) {
      this.ghost?.container.destroy();
      this.ghost = null;
      return;
    }
    const def = bigChessPieceFor(ghost.itemKey);
    if (!def || !this.scene.sys?.displayList) return;
    if (!this.ghost || this.ghost.itemKey !== ghost.itemKey) {
      this.ghost?.container.destroy();
      const container = this.scene.add.container(0, 0).setDepth(this.depthForY(bigChessSquareRect('a1').y) + 1);
      const outline = this.scene.add.graphics().setName('outline');
      container.add(outline);
      const holder = { container, itemKey: ghost.itemKey, image: null as Phaser.GameObjects.Image | null };
      this.ghost = holder;
      this.withTexture(def, () => {
        if (!container.active || this.ghost !== holder) return;
        const image = this.scene.add.image(0, 0, textureKeyFor(def)).setOrigin(0.5, 1).setAlpha(0.7).setVisible(false);
        container.add(image);
        holder.image = image;
      });
    }
    const outline = this.ghost.container.getByName('outline') as Phaser.GameObjects.Graphics | null;
    if (outline) {
      outline.clear();
      for (const square of bigChessSquaresForItem(ghost.itemKey)) {
        if (this.entries.has(square) || square === ghost.square) continue;
        const rect = bigChessSquareRect(square);
        outline.fillStyle(0x4ade80, 0.14);
        outline.fillRect(rect.x, rect.y, rect.width, rect.height);
        outline.lineStyle(1.5, 0x4ade80, 0.6);
        outline.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
      }
      if (ghost.square) {
        const rect = bigChessSquareRect(ghost.square);
        const color = ghost.valid ? 0x4ade80 : 0xf87171;
        outline.fillStyle(color, 0.28);
        outline.fillRect(rect.x, rect.y, rect.width, rect.height);
        outline.lineStyle(2, color, 0.95);
        outline.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
      }
    }
    const image = this.ghost.image;
    if (image) {
      if (ghost.square) {
        const rect = bigChessSquareRect(ghost.square);
        image.setPosition(rect.x + rect.width / 2, rect.y + rect.height - 3).setVisible(true);
        image.setTint(ghost.valid ? 0xffffff : 0xff9a9a);
      } else {
        image.setVisible(false);
      }
    }
  }

  // ------------------------------------------------------------------ internos

  private firstHit(rects: Phaser.Geom.Rectangle[]): Entry | null {
    for (const entry of this.entries.values()) {
      for (const rect of rects) {
        if (Phaser.Geom.Intersects.RectangleToRectangle(rect, entry.rect)) return entry;
      }
    }
    return null;
  }

  private create(view: BigChessPieceView): void {
    const def = bigChessPieceFor(view.itemKey);
    if (!def) return;
    const r = bigChessSquareRect(view.square);
    const rect = new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height);
    const baseX = rect.x + rect.width / 2;
    const baseY = rect.y + rect.height - 3;
    const container = this.scene.add.container(baseX, baseY).setDepth(this.depthForY(rect.y + rect.height));
    // Zona clicável = a casa inteira.
    const zone = this.scene.add
      .zone(0, -rect.height / 2 + 3, rect.width, rect.height)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.onClick(view.square);
    });
    const bar = this.scene.add.graphics();
    const label = this.scene.add
      .text(0, -PIECE_MAX_H - 14, '', { fontFamily: 'monospace', fontSize: '9px', color: '#fde68a', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    container.add([zone, bar, label]);
    const entry: Entry = { view, def, rect, container, image: null, bar, label };
    this.entries.set(view.square, entry);
    this.withTexture(def, () => {
      if (!container.active || this.entries.get(view.square) !== entry) return;
      const image = this.scene.add.image(0, 0, textureKeyFor(def)).setOrigin(0.5, 1);
      container.addAt(image, 0);
      entry.image = image;
    });
    this.refresh(entry);
    // Fantasma aberto: a casa deixou de estar livre.
    if (this.ghost) this.redrawGhostOutline();
  }

  private refresh(entry: Entry): void {
    const { view, bar, label } = entry;
    label.setText(view.ownerName ? view.ownerName.slice(0, 14) : '');
    const ratio = view.maxHp > 0 ? Math.max(0, Math.min(1, view.hp / view.maxHp)) : 0;
    const x = -BAR_W / 2;
    const y = -PIECE_MAX_H - 11;
    bar.clear();
    bar.fillStyle(0x000000, 0.7);
    bar.fillRect(x - 1, y - 1, BAR_W + 2, BAR_H + 2);
    bar.fillStyle(0x3b2a14, 1);
    bar.fillRect(x, y, BAR_W, BAR_H);
    const color = ratio > 0.5 ? 0x4ade80 : ratio > 0.2 ? 0xfbbf24 : 0xf87171;
    bar.fillStyle(color, 1);
    bar.fillRect(x, y, Math.round(BAR_W * ratio), BAR_H);
    // Marcadores: capa (azul) e defesas (verde), pontinhos à direita da barra.
    let dotX = x + BAR_W + 5;
    const dotY = y + BAR_H / 2;
    if (view.cover) {
      bar.fillStyle(0x60a5fa, 1);
      bar.fillCircle(dotX, dotY, 2.5);
      dotX += 6;
    }
    for (let i = 0; i < view.defenses.length; i += 1) {
      bar.fillStyle(0x34d399, 1);
      bar.fillCircle(dotX, dotY, 2.5);
      dotX += 6;
    }
    if (view.counterUntil > 0) {
      bar.lineStyle(1.5, 0xf87171, 0.9);
      bar.strokeCircle(0, -PIECE_MAX_H / 2, entry.rect.width / 2 - 2);
    }
  }

  private redrawGhostOutline(): void {
    const last = this.lastGhost;
    if (!last) return;
    const occupied = !!last.square && this.entries.has(last.square);
    this.setGhost({ ...last, valid: last.valid && !occupied });
  }

  private destroyEntry(square: string): void {
    const entry = this.entries.get(square);
    if (!entry) return;
    this.entries.delete(square);
    entry.container.destroy();
  }

  /** Garante a textura (PNG) carregada e chama `ready`. */
  private withTexture(def: BigChessPieceDef, ready: () => void): void {
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
    this.scene.load.image(key, encodeURI(def.imageUrl));
    const flush = () => {
      this.loading.delete(key);
      const pending = this.onTexture.get(key) ?? [];
      this.onTexture.delete(key);
      if (!this.scene.textures.exists(key)) return; // arquivo ausente: fica sem imagem (zona/barra continuam)
      this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      for (const fn of pending) fn();
    };
    const onError = (file: { key?: string }) => {
      if (file?.key !== key) return;
      this.scene.load.off('loaderror', onError);
      flush();
    };
    this.scene.load.on('loaderror', onError);
    this.scene.load.once(`filecomplete-image-${key}`, () => {
      this.scene.load.off('loaderror', onError);
      flush();
    });
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }
}
