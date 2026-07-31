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
  characterId!: string;
  hp!: number;
  maxHp!: number;

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
    this.characterId = '';
    this.hp = 100;
    this.maxHp = 100;
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
  characterId: 'string',
  hp: 'number',
  // Appended last on purpose: schema field order is part of the wire
  // protocol for the pinned colyseus.js 0.15 clients — additive only.
  maxHp: 'number',
});
