// Core domain types for the Swiss tournament system

export type PlayerId = string;
export type TPN = number; // Tournament Pairing Number (1-based)

export type Color = 'w' | 'b';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '+/-' | '-/+' | '-/-';

export type RoundMode = 'auto-normal' | 'auto-fast' | 'manual';
export type TournamentStatus = 'setup' | 'active' | 'finished' | 'cancelled';
export type PlayerStatus = 'active' | 'withdrawn';

export interface Player {
  id: PlayerId;
  name: string;
  rating: number;
  status: PlayerStatus;
  tpn: TPN | null;
}

export interface Pairing {
  board: number;
  whiteTpn: TPN;
  blackTpn: TPN;
  result: GameResult | null;
  isPlayed: boolean; // true if game was actually played (affects color history)
}

export interface RoundBye {
  tpn: TPN;
  points: number; // always 1.0 for pairing-allocated bye
}

export interface Round {
  number: number;
  pairings: Pairing[];
  bye: RoundBye | null;
  finalized: boolean;
}

export interface TournamentConfig {
  roundMode: RoundMode;
  totalRounds: number;
  initialColor: Color;
}

export interface PlayerHistory {
  tpn: TPN;
  points: number;
  colors: (Color | null)[]; // null for rounds with no played game
  opponents: (TPN | null)[]; // null for bye/forfeit-unplayed
  playedOpponents: TPN[]; // only those from actually played games
  results: (GameResult | null)[];
  byes: number;
  wins: number;
  draws: number;
  losses: number;
  winsByForfeit: number;
  lossesByForfeit: number;
  doubleAbsences: number;
  whiteGames: number;
  blackGames: number;
  upfloats: number;
  downfloats: number;
}

export interface TiebreakDetail {
  buchholzCut1: number;
  buchholz: number;
  sonnebornBerger: number;
  winsPlayed: number;
  progressiveScore: number;
  // Detailed breakdowns
  opponentScores: { tpn: TPN | null; score: number; adjusted: boolean }[];
  removedBuchholz: number;
  sbContributions: { tpn: TPN | null; result: number; oppScore: number; contribution: number }[];
  progressiveRounds: number[];
}

export interface Standing {
  position: number;
  tpn: TPN;
  playerId: PlayerId;
  name: string;
  rating: number;
  points: number;
  tiebreak: TiebreakDetail;
  status: PlayerStatus;
}

export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  config: TournamentConfig;
  players: Player[];
  rounds: Round[];
  standings: Standing[];
  createdAt: string;
  updatedAt: string;
}

// Results as stored - more detail than display
export interface GameResultDetail {
  result: GameResult;
  isPlayed: boolean; // true = game was actually played on a board
}

// Diagnostics from pairing generation
export interface PairingDiagnostics {
  engineVersion: string;
  roundRequested: number;
  activePlayers: number;
  expectedPairings: number;
  expectedByes: number;
  validationsRun: string[];
  violations: string[];
  colorWarnings: string[];
  floaters: { tpn: TPN; from: number; to: number }[];
  trfInput: string;
  engineOutput: string;
  checkerOutput: string;
  errors: string[];
  success: boolean;
}

// Presets for testing
export interface PlayerPreset {
  name: string;
  players: { name: string; rating: number }[];
}
