import Phaser from 'phaser';
import type { HuntShotHitPayload, HuntShotPayload } from '../../shared/hunting/HuntingShapes';
import { INTERPOLATION_DELAY_MS } from '../network/interpolation';

/**
 * Animal projectiles — the cheapest rendering that still sorts with the world:
 *  • ONE tiny texture generated once in memory (no asset, no network);
 *  • a pool of plain Images (no physics, no tweens, no per-shot allocations after warm-up);
 *  • the position is computed from the spawn message alone (origin + direction × speed × time), the
 *    server never streams projectile positions;
 *  • each image gets the world depth of its ground point, so it passes behind/in front of players,
 *    animals and trees like everything else.
 * The replay starts INTERPOLATION_DELAY_MS after the message, matching the delayed positions of the
 * animals and remote players, so the shot leaves the animal at the moment its attack frame shows.
 */
const TEXTURE_KEY = 'hunt-shot-dot';
const DOT_SIZE = 10;
/** Drawn this far above the ground point (the shot flies at the height of the animal's mouth). */
const FLIGHT_HEIGHT_PX = 22;
/** A hit message may arrive before the delayed replay reaches that point: hold the burst until it does. */
const IMPACT_MS = 140;

interface LiveShot {
  spec: HuntShotPayload;
  startAt: number;
  image: Phaser.GameObjects.Image;
  /** Set by the hit message: the replay stops here (world ground point) and flashes. */
  impact: { x: number; y: number } | null;
  impactAt: number;
}

export class AnimalShots {
  private readonly live = new Map<string, LiveShot>();
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly depthForY: (y: number) => number) {
    if (!scene.textures.exists(TEXTURE_KEY)) {
      const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
      gfx.fillStyle(0x365314, 1).fillCircle(DOT_SIZE / 2, DOT_SIZE / 2, DOT_SIZE / 2);
      gfx.fillStyle(0xa3e635, 1).fillCircle(DOT_SIZE / 2, DOT_SIZE / 2, DOT_SIZE / 2 - 2);
      gfx.fillStyle(0xecfccb, 1).fillCircle(DOT_SIZE / 2 - 1, DOT_SIZE / 2 - 1, 1.5);
      gfx.generateTexture(TEXTURE_KEY, DOT_SIZE, DOT_SIZE);
      gfx.destroy();
    }
  }

  spawn(spec: HuntShotPayload, now = Date.now()): void {
    if (this.destroyed || this.live.has(spec.id)) return;
    const image = this.pool.pop() ?? this.scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0.5);
    image.setVisible(false).setActive(true).setAlpha(1).setScale(1);
    this.live.set(spec.id, { spec, startAt: now + INTERPOLATION_DELAY_MS, image, impact: null, impactAt: 0 });
  }

  hit(payload: HuntShotHitPayload): void {
    const shot = this.live.get(payload.id);
    if (shot) shot.impact = { x: payload.x, y: payload.y };
  }

  tick(now = Date.now()): void {
    if (!this.live.size) return;
    for (const [id, shot] of this.live) {
      const { spec, image } = shot;
      const elapsed = now - shot.startAt;
      if (elapsed < 0) continue;
      let travelled = Math.min(spec.range, spec.speed * (elapsed / 1000));
      if (shot.impact) {
        const impactDistance = Math.hypot(shot.impact.x - spec.x, shot.impact.y - spec.y);
        if (travelled >= impactDistance) {
          travelled = impactDistance;
          if (!shot.impactAt) shot.impactAt = now;
        }
      }
      const x = spec.x + spec.dx * travelled, y = spec.y + spec.dy * travelled;
      image.setPosition(x, y - FLIGHT_HEIGHT_PX).setDepth(this.depthForY(y) + 1).setVisible(true);
      if (shot.impactAt) {
        // small burst: the dot grows and fades over IMPACT_MS, then goes back to the pool
        const progress = Math.min(1, (now - shot.impactAt) / IMPACT_MS);
        image.setScale(1 + progress * 1.4).setAlpha(1 - progress);
        if (progress >= 1) this.release(id, shot);
      } else if (!shot.impact && travelled >= spec.range) {
        this.release(id, shot);
      }
    }
  }

  private release(id: string, shot: LiveShot): void {
    this.live.delete(id);
    shot.image.setVisible(false).setActive(false);
    this.pool.push(shot.image);
  }

  destroy(): void {
    this.destroyed = true;
    for (const shot of this.live.values()) shot.image.destroy();
    for (const image of this.pool) image.destroy();
    this.live.clear();
    this.pool.length = 0;
  }
}
