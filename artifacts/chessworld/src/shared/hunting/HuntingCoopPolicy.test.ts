import { describe, expect, it } from 'vitest';
import { canAddHuntingPartyMember, isHuntingPartyRewardEligible } from './HuntingCoopPolicy';

describe('hunting co-op policy', () => {
  it('refuses a fifth retained member', () => {
    expect(canAddHuntingPartyMember(3)).toBe(true);
    expect(canAddHuntingPartyMember(4)).toBe(false);
  });

  it('allows the leader, connected members, and offline members who participated', () => {
    expect(isHuntingPartyRewardEligible({ isLeader: true, connected: false, killed: 0, joinedAtKilled: 0 })).toBe(true);
    expect(isHuntingPartyRewardEligible({ isLeader: false, connected: true, killed: 0, joinedAtKilled: 0 })).toBe(true);
    expect(isHuntingPartyRewardEligible({ isLeader: false, connected: false, killed: 2, joinedAtKilled: 1 })).toBe(true);
    expect(isHuntingPartyRewardEligible({ isLeader: false, connected: false, killed: 1, joinedAtKilled: 1 })).toBe(false);
  });
});