import type { RoundMode } from './types.js';

export function calculateMaxRounds(playerCount: number): number {
  if (playerCount <= 1) return 0;
  if (playerCount % 2 === 0) return playerCount - 1;
  return playerCount;
}

export function calculateAutoNormalRounds(playerCount: number): number {
  if (playerCount <= 1) return 0;
  if (playerCount === 2) return 1;
  const log2 = Math.ceil(Math.log2(playerCount));
  const rounds = log2 + 1;
  const max = calculateMaxRounds(playerCount);
  return Math.min(rounds, max);
}

export function calculateAutoFastRounds(playerCount: number): number {
  if (playerCount <= 1) return 0;
  if (playerCount === 2) return 1;
  const log2 = Math.ceil(Math.log2(playerCount));
  const max = calculateMaxRounds(playerCount);
  return Math.min(log2, max);
}

export function calculateRounds(playerCount: number, mode: RoundMode, manualCount?: number): number {
  switch (mode) {
    case 'auto-normal':
      return calculateAutoNormalRounds(playerCount);
    case 'auto-fast':
      return calculateAutoFastRounds(playerCount);
    case 'manual':
      if (!manualCount || manualCount <= 0) throw new Error('Manual round count must be positive');
      const max = calculateMaxRounds(playerCount);
      if (manualCount > max) throw new Error(`Cannot exceed ${max} rounds without repeating opponents`);
      return manualCount;
  }
}

export function validateRoundCount(playerCount: number, rounds: number): { valid: boolean; error?: string } {
  if (rounds <= 0) return { valid: false, error: 'Must have at least 1 round' };
  const max = calculateMaxRounds(playerCount);
  if (rounds > max) return { valid: false, error: `Max ${max} rounds for ${playerCount} players` };
  return { valid: true };
}
