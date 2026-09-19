export const HUNT_COOP_MAX_MEMBERS = 4;

export function canAddHuntingPartyMember(memberCount: number): boolean {
  return Number.isInteger(memberCount) && memberCount >= 0 && memberCount < HUNT_COOP_MAX_MEMBERS;
}

export function isHuntingPartyRewardEligible(input: {
  isLeader: boolean;
  connected: boolean;
  killed: number;
  joinedAtKilled?: number;
}): boolean {
  return input.isLeader || input.connected || input.killed > (input.joinedAtKilled ?? input.killed);
}