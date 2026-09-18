import { Schema, defineTypes } from '@colyseus/schema';

export class AnimalState extends Schema {
  id = '';
  variantId = '';
  name = '';
  x = 0;
  y = 0;
  dir = 0;
  anim = 'idle';
  hp = 1;
  maxHp = 1;
  level = 'easy';
  dead = false;
  contractOwner = '';
  /** Effective run stride (px per leap) — the client drives the run frames by distance travelled. */
  stride = 40;
}

defineTypes(AnimalState, {
  id: 'string', variantId: 'string', name: 'string', x: 'number', y: 'number',
  dir: 'number', anim: 'string', hp: 'number', maxHp: 'number',
  level: 'string', dead: 'boolean', contractOwner: 'string', stride: 'number',
});