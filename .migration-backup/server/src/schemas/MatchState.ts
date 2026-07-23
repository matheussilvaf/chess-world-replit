import { Schema, defineTypes } from '@colyseus/schema';

export class MatchState extends Schema {
  id!: string;
  boardId!: string;
  region!: string;
  whitePlayerId!: string;
  blackPlayerId!: string;
  whitePlayerName!: string;
  blackPlayerName!: string;
  fen!: string;
  pgn!: string;
  status!: string;
  turn!: string;
  whiteTimeMs!: number;
  blackTimeMs!: number;
  incrementMs!: number;
  lastMoveAt!: number;
  lastMoveSan!: string;
  lastMoveFrom!: string;
  lastMoveTo!: string;
  winnerId!: string;
  result!: string;

  constructor() {
    super();
    this.id = '';
    this.boardId = '';
    this.region = '';
    this.whitePlayerId = '';
    this.blackPlayerId = '';
    this.whitePlayerName = '';
    this.blackPlayerName = '';
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.pgn = '';
    this.status = 'playing';
    this.turn = 'w';
    this.whiteTimeMs = 600000;
    this.blackTimeMs = 600000;
    this.incrementMs = 0;
    this.lastMoveAt = 0;
    this.lastMoveSan = '';
    this.lastMoveFrom = '';
    this.lastMoveTo = '';
    this.winnerId = '';
    this.result = '';
  }
}

defineTypes(MatchState, {
  id: 'string',
  boardId: 'string',
  region: 'string',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  whitePlayerName: 'string',
  blackPlayerName: 'string',
  fen: 'string',
  pgn: 'string',
  status: 'string',
  turn: 'string',
  whiteTimeMs: 'number',
  blackTimeMs: 'number',
  incrementMs: 'number',
  lastMoveAt: 'number',
  lastMoveSan: 'string',
  lastMoveFrom: 'string',
  lastMoveTo: 'string',
  winnerId: 'string',
  result: 'string',
});
