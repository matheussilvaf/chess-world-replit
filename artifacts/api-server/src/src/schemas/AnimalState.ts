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
}

defineTypes(AnimalState, {
  id: 'string', variantId: 'string', name: 'string', x: 'number', y: 'number',
  dir: 'number', anim: 'string', hp: 'number', maxHp: 'number',
  level: 'string', dead: 'boolean', contractOwner: 'string',
});