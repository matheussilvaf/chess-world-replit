import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';
import { BoardState } from './BoardState.js';
import { MatchState } from './MatchState.js';
import { VoiceParticipantState } from './VoiceParticipantState.js';
import { WorldDropState } from './WorldDropState.js';
import { PlacedStationState } from './PlacedStationState.js';
import { BigChessPieceState } from './BigChessPieceState.js';

export class WorldState extends Schema {
  players!: MapSchema<PlayerState>;
  boards!: MapSchema<BoardState>;
  matches!: MapSchema<MatchState>;
  voiceParticipants!: MapSchema<VoiceParticipantState>;
  worldDrops!: MapSchema<WorldDropState>;
  placedStations!: MapSchema<PlacedStationState>;
  /** Peças do Big Chess Board (chave = casa). */
  bigChessPieces!: MapSchema<BigChessPieceState>;

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
    this.boards = new MapSchema<BoardState>();
    this.matches = new MapSchema<MatchState>();
    this.voiceParticipants = new MapSchema<VoiceParticipantState>();
    this.worldDrops = new MapSchema<WorldDropState>();
    this.placedStations = new MapSchema<PlacedStationState>();
    this.bigChessPieces = new MapSchema<BigChessPieceState>();
  }
}

defineTypes(WorldState, {
  players: { map: PlayerState },
  boards: { map: BoardState },
  matches: { map: MatchState },
  voiceParticipants: { map: VoiceParticipantState },
  worldDrops: { map: WorldDropState },
  placedStations: { map: PlacedStationState },
  bigChessPieces: { map: BigChessPieceState },
});
