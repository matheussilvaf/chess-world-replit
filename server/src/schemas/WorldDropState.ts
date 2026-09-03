import { Schema, defineTypes } from '@colyseus/schema';

/** Public, room-local dropped inventory item. */
export class WorldDropState extends Schema {
  id = '';
  itemKey = '';
  qty = 0;
  x = 0;
  y = 0;
}

defineTypes(WorldDropState, {
  id: 'string',
  itemKey: 'string',
  qty: 'number',
  x: 'number',
  y: 'number',
});