import { Schema, defineTypes } from '@colyseus/schema';

export class VoiceParticipantState extends Schema {
  sessionId!: string;
  playerId!: string;
  username!: string;
  region!: string;
  joinedAt!: number;
  muted!: boolean;

  constructor() {
    super();
    this.sessionId = '';
    this.playerId = '';
    this.username = '';
    this.region = '';
    this.joinedAt = 0;
    this.muted = false;
  }
}

defineTypes(VoiceParticipantState, {
  sessionId: 'string',
  playerId: 'string',
  username: 'string',
  region: 'string',
  joinedAt: 'number',
  muted: 'boolean',
});
