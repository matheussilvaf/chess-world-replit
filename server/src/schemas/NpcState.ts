import { Schema, defineTypes } from '@colyseus/schema';

export class NpcState extends Schema {
  id = '';
  x = 0;
  y = 0;
  dir = 0;
  isMoving = false;
}

defineTypes(NpcState, {
  id: 'string', x: 'number', y: 'number', dir: 'number', isMoving: 'boolean',
});