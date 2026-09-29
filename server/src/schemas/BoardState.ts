import { Schema, defineTypes } from '@colyseus/schema';

export class BoardState extends Schema {
  id!: string;
  name!: string;
  region!: string;
  x!: number;
  y!: number;
  width!: number;
  height!: number;
  status!: string; // 'idle' | 'waiting' | 'playing'
  waitingPlayerId!: string;
  waitingPlayerName!: string;
  timeCategory!: string;
  baseMinutes!: number;
  incrementSeconds!: number;
  timeLabel!: string;
  whitePlayerId!: string;
  blackPlayerId!: string;
  matchId!: string;
  battleMode: string = '';
  battleBand: string = '';
  battleShowThemes: boolean = false;
  battleExpiresAt: number = 0;
}

defineTypes(BoardState, {
  id: 'string',
  name: 'string',
  region: 'string',
  x: 'number',
  y: 'number',
  width: 'number',
  height: 'number',
  status: 'string',
  waitingPlayerId: 'string',
  waitingPlayerName: 'string',
  timeCategory: 'string',
  baseMinutes: 'number',
  incrementSeconds: 'number',
  timeLabel: 'string',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  matchId: 'string',
  battleMode: 'string',
  battleBand: 'string',
  battleShowThemes: 'boolean',
  battleExpiresAt: 'number',
});
