import Phaser from 'phaser';
import {
  ANIMAL_ANIMATION_COLUMNS,
  ANIMAL_ANIMATION_FPS,
  ANIMAL_ANIMATIONS,
  ANIMAL_DEFAULT_HURTBOX,
  ANIMAL_DEFAULT_ORIGIN,
  ANIMAL_DIRECTIONS,
  ANIMAL_SHEET_COLUMNS,
  ANIMAL_SHEET_ROWS,
  animalSheetPath,
  parseVariantId,
  rigIdForAnimal,
  type AnimalAnimation,
  type AnimalDirection,
} from '../../shared/hunting/HuntingShapes';
import type { LocalRectangle, RigConfig } from '../../shared/combat/RigShapes';
import { loadRigConfig } from '../rigs/rigLoader';

const textureInflight = new Map<string, Promise<boolean>>();
const rigInflight = new Map<string, Promise<AnimalRig>>();
const rigCache = new Map<string, AnimalRig>();

export interface AnimalRig {
  origin: { x: number; y: number };
  config: RigConfig | null;
}

export const animalTextureKey = (variantId: string) => `animal:${variantId}`;
export const animalAnimationKey = (variantId: string, anim: AnimalAnimation, direction: AnimalDirection) =>
  `animal:${variantId}:${anim}:${direction}`;

function createAnimations(scene: Phaser.Scene, variantId: string): void {
  const texture = animalTextureKey(variantId);
  for (const anim of ANIMAL_ANIMATIONS) {
    for (let row = 0; row < ANIMAL_DIRECTIONS.length; row++) {
      const direction = ANIMAL_DIRECTIONS[row];
      const key = animalAnimationKey(variantId, anim, direction);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: ANIMAL_ANIMATION_COLUMNS[anim].map((column) => ({ key: texture, frame: row * ANIMAL_SHEET_COLUMNS + column })),
        frameRate: ANIMAL_ANIMATION_FPS[anim],
        yoyo: true,
        repeat: anim === 'attack' ? 0 : -1,
      });
    }
  }
}

/** Loads the image first so sheets with different pixel dimensions remain supported. */
export function ensureAnimalTexture(scene: Phaser.Scene, variantId: string): Promise<boolean> {
  const key = animalTextureKey(variantId);
  if (scene.textures.exists(key)) {
    createAnimations(scene, variantId);
    return Promise.resolve(true);
  }
  const existing = textureInflight.get(key);
  if (existing) return existing;
  const imageKey = `${key}:source`;
  const promise = new Promise<boolean>((resolve) => {
    scene.load.image(imageKey, encodeURI(`${import.meta.env.BASE_URL}${animalSheetPath(variantId)}`));
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      try {
        const sourceTexture = scene.textures.get(imageKey);
        const image = sourceTexture?.getSourceImage() as HTMLImageElement | undefined;
        if (!image?.width || !image.height) {
          resolve(false);
          return;
        }
        scene.textures.addSpriteSheet(key, image, {
          frameWidth: image.width / ANIMAL_SHEET_COLUMNS,
          frameHeight: image.height / ANIMAL_SHEET_ROWS,
        });
        scene.textures.remove(imageKey);
        createAnimations(scene, variantId);
        resolve(scene.textures.exists(key));
      } catch {
        resolve(false);
      } finally {
        textureInflight.delete(key);
      }
    });
    scene.load.start();
  });
  textureInflight.set(key, promise);
  return promise;
}

export async function ensureAnimalRig(variantId: string): Promise<AnimalRig> {
  const parsed = parseVariantId(variantId);
  if (!parsed) return { origin: ANIMAL_DEFAULT_ORIGIN, config: null };
  const rigId = rigIdForAnimal(parsed.category, parsed.animal);
  const cached = rigCache.get(rigId);
  if (cached) return cached;
  const pending = rigInflight.get(rigId);
  if (pending) return pending;
  const promise = loadRigConfig(rigId)
    .then((config) => ({ origin: config.origin, config }))
    .catch(() => ({ origin: ANIMAL_DEFAULT_ORIGIN, config: null }))
    .then((rig) => {
      rigCache.set(rigId, rig);
      return rig;
    })
    .finally(() => rigInflight.delete(rigId));
  rigInflight.set(rigId, promise);
  return promise;
}

export function animalHurtboxes(
  rig: AnimalRig,
  anim: AnimalAnimation,
  direction: AnimalDirection,
  localFrame: number,
): LocalRectangle[] {
  const group = rig.config?.animationConfigs[anim]?.directions[direction]?.frames[String(localFrame)]?.hurtbox;
  if (group?.enabled && group.rectangles.length) return group.rectangles;
  return [{ id: 'default', ...ANIMAL_DEFAULT_HURTBOX }];
}