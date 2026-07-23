import { Schema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  id!: string;
  sessionId!: string;
  username!: string;
  rating!: number;
  region!: string;
  x!: number;
  y!: number;
  targetX!: number;
  targetY!: number;
  direction!: string;
  isMoving!: boolean;
  currentBoardId!: string;

  constructor() {
    super();
    this.id = '';
    this.sessionId = '';
    this.username = '';
    this.rating = 0;
    this.region = '';
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.direction = 'down';
    this.isMoving = false;
    this.currentBoardId = '';
  }
}

defineTypes(PlayerState, {
  id: 'string',
  sessionId: 'string',
  username: 'string',
  rating: 'number',
  region: 'string',
  x: 'number',
  y: 'number',
  targetX: 'number',
  targetY: 'number',
  direction: 'string',
  isMoving: 'boolean',
  currentBoardId: 'string',
});
