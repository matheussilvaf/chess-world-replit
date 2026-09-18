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
  /** Local run frame (0..2) chosen by the server every tick while running — see shared/hunting/HuntingMotion. */
  frame = 0;
}

defineTypes(AnimalState, {
  id: 'string', variantId: 'string', name: 'string', x: 'number', y: 'number',
  dir: 'number', anim: 'string', hp: 'number', maxHp: 'number',
  level: 'string', dead: 'boolean', contractOwner: 'string', frame: 'uint8',
});