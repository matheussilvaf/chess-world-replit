/**
 * ArrowProjectiles — flechas do arco no mundo (fase CraftingWorld).
 *
 * O disparo é 100% client-side nesta fase (como os golpes de coleta): o
 * WorldScene cria a flecha ao FIM da animação knock-and-bow, ela viaja em
 * linha reta na direção do disparo até o alcance configurado no admin
 * (/admin/rigs, bloco "projétil" da variação) e testa, a cada frame, sua
 * hitbox contra as hurtboxes dos nós do CraftingMapRuntime. Cada flecha
 * acerta NO MÁXIMO um nó; ao conectar (ou esgotar o alcance) ela cai e some.
 * Flechas de OUTROS jogadores são cosméticas (nunca acertam nada).
 *
 * O sprite em voo é o frame da coluna 18 (última do knock-and-bow) da folha
 * `arrow_<material>.png` — carregada sob demanda como spritesheet 96×96.
 */
import Phaser from 'phaser';
import { SHEET_COLS } from '../../lib/character-generator/constants';
import type { LocalRectangle, RigDirection } from '../../shared/combat/RigShapes';

/** Velocidade da flecha (px de mundo por segundo). */
export const ARROW_SPEED_PX_S = 420;
/** Coluna da folha arrow_* usada como sprite em voo (arte só existe nas 15–18). */
const ARROW_FLIGHT_COLUMN = 18;

const ROW_BY_DIRECTION: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };
const RIG_DIR_BY_DIRECTION: Record<string, RigDirection> = {
  down: 'south',
  left: 'west',
  right: 'east',
  up: 'north',
};
const UNIT_BY_DIRECTION: Record<string, { x: number; y: number }> = {
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
};

/** Hitbox padrão quando o admin não configurou: caixa fina no eixo do voo. */
function defaultArrowRect(direction: string): LocalRectangle {
  return direction === 'left' || direction === 'right'
    ? { id: 'arrow', x: -12, y: -4, width: 24, height: 8 }
    : { id: 'arrow', x: -4, y: -12, width: 8, height: 24 };
}

export interface ArrowShotSpec {
  /** URL (já com BASE_URL) da folha arrow_<material>.png. */
  sheetUrl: string;
  /** down | left | right | up (linha da folha + eixo do voo). */
  direction: string;
  startX: number;
  startY: number;
  /** Distância máxima em px de mundo (admin; default do contrato). */
  rangePx: number;
  /** Hitbox local ao centro do sprite da flecha, por direção (admin). */
  hitbox: Partial<Record<RigDirection, LocalRectangle>>;
  /** true = flecha de outro jogador: só visual, não acerta nós. */
  cosmetic: boolean;
}

interface ActiveArrow {
  sprite: Phaser.GameObjects.Sprite;
  vx: number;
  vy: number;
  startX: number;
  startY: number;
  rangePx: number;
  rect: LocalRectangle;
  cosmetic: boolean;
  /** true depois de conectar/cair — sem movimento nem testes, só o fade. */
  done: boolean;
}

/** Testa a hitbox de mundo da flecha; true = conectou (a flecha morre). */
export type ProjectileHitTester = (rects: Phaser.Geom.Rectangle[], x: number, y: number) => boolean;

export class ArrowProjectiles {
  private scene: Phaser.Scene;
  private arrows: ActiveArrow[] = [];
  private textureInflight = new Map<string, Promise<boolean>>();
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private textureKeyFor(sheetUrl: string): string {
    return `arrowSheet:${sheetUrl}`;
  }

  /** Carrega a folha como spritesheet 96×96 (uma vez por URL; corrida-segura). */
  private ensureTexture(sheetUrl: string): Promise<boolean> {
    const key = this.textureKeyFor(sheetUrl);
    if (this.scene.textures.exists(key)) return Promise.resolve(true);
    const inflight = this.textureInflight.get(key);
    if (inflight) return inflight;
    const promise = new Promise<boolean>((resolve) => {
      this.scene.load.spritesheet(key, sheetUrl, { frameWidth: 96, frameHeight: 96 });
      // COMPLETE dispara quando a fila atual esvazia (mesmo com LOAD_ERROR do
      // arquivo): o critério de sucesso é a textura existir de fato.
      this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.textureInflight.delete(key);
        resolve(this.scene.textures.exists(key));
      });
      this.scene.load.start();
    });
    this.textureInflight.set(key, promise);
    return promise;
  }

  /** Dispara uma flecha (async: espera a folha; falha vira warn, nunca exceção). */
  async fire(spec: ArrowShotSpec): Promise<void> {
    try {
      const ok = await this.ensureTexture(spec.sheetUrl);
      if (this.destroyed) return;
      if (!ok) {
        console.warn(`[ArrowProjectiles] folha da flecha indisponível: ${spec.sheetUrl}`);
        return;
      }
      const row = ROW_BY_DIRECTION[spec.direction] ?? 0;
      const unit = UNIT_BY_DIRECTION[spec.direction] ?? UNIT_BY_DIRECTION.down;
      const rigDir = RIG_DIR_BY_DIRECTION[spec.direction] ?? 'south';
      const sprite = this.scene.add.sprite(
        spec.startX,
        spec.startY,
        this.textureKeyFor(spec.sheetUrl),
        row * SHEET_COLS + ARROW_FLIGHT_COLUMN,
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(spec.startY);
      this.arrows.push({
        sprite,
        vx: unit.x * ARROW_SPEED_PX_S,
        vy: unit.y * ARROW_SPEED_PX_S,
        startX: spec.startX,
        startY: spec.startY,
        rangePx: Math.max(1, spec.rangePx),
        rect: spec.hitbox[rigDir] ?? defaultArrowRect(spec.direction),
        cosmetic: spec.cosmetic,
        done: false,
      });
    } catch (e) {
      console.warn('[ArrowProjectiles] falha ao disparar:', e instanceof Error ? e.message : e);
    }
  }

  /** Avança as flechas; `hitTester` = null fora do mundo de coleta (flechas só voam). */
  update(deltaMs: number, hitTester: ProjectileHitTester | null): void {
    if (this.arrows.length === 0) return;
    const dt = deltaMs / 1000;
    for (const arrow of this.arrows) {
      if (arrow.done) continue;
      const spr = arrow.sprite;
      if (!spr.scene) {
        arrow.done = true;
        continue;
      }
      spr.x += arrow.vx * dt;
      spr.y += arrow.vy * dt;
      spr.setDepth(spr.y);

      if (!arrow.cosmetic && hitTester) {
        const world = new Phaser.Geom.Rectangle(
          spr.x + arrow.rect.x,
          spr.y + arrow.rect.y,
          arrow.rect.width,
          arrow.rect.height,
        );
        if (hitTester([world], spr.x, spr.y)) {
          this.finish(arrow, true);
          continue;
        }
      }

      const traveled = Phaser.Math.Distance.Between(arrow.startX, arrow.startY, spr.x, spr.y);
      if (traveled >= arrow.rangePx) this.finish(arrow, false);
    }
    // Sprites destruídos (fade concluído / teardown) saem da lista.
    this.arrows = this.arrows.filter((a) => a.sprite.scene);
  }

  /** Fim de voo: acertou (para na hora) ou esgotou o alcance (cai um tico) — fade e some. */
  private finish(arrow: ActiveArrow, hit: boolean): void {
    arrow.done = true;
    const spr = arrow.sprite;
    this.scene.tweens.add({
      targets: spr,
      alpha: 0,
      y: spr.y + (hit ? 2 : 7),
      duration: hit ? 150 : 240,
      ease: 'Quad.easeIn',
      onComplete: () => spr.destroy(),
    });
  }

  /** Contorno das hitboxes das flechas vivas (debug de combate). */
  drawDebug(gfx: Phaser.GameObjects.Graphics): void {
    for (const arrow of this.arrows) {
      if (arrow.done) continue;
      gfx.lineStyle(1, 0x00e5ff, 0.9);
      gfx.strokeRect(
        arrow.sprite.x + arrow.rect.x,
        arrow.sprite.y + arrow.rect.y,
        arrow.rect.width,
        arrow.rect.height,
      );
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const arrow of this.arrows) arrow.sprite.destroy();
    this.arrows = [];
  }
}
