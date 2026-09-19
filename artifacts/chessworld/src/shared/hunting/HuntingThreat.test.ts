import { describe, expect, it } from 'vitest';
import { selectHuntingThreatTarget } from './HuntingThreat';

const entry = (sessionId: string, threat: number, distance: number) => ({ sessionId, threat, distance, lastHitAt: 0 });

describe('selectHuntingThreatTarget', () => {
  it('keeps the current target below the hysteresis threshold', () => {
    expect(selectHuntingThreatTarget([entry('a', 100, 30), entry('b', 129, 30)], 'a', 48, 400, 1000).currentSessionId).toBe('a');
  });
  it('switches when another hunter reaches 130% threat', () => {
    expect(selectHuntingThreatTarget([entry('a', 100, 30), entry('b', 130, 30)], 'a', 48, 400, 1000).currentSessionId).toBe('b');
  });
  it('bites a reachable hunter after the target stays away', () => {
    const first = selectHuntingThreatTarget([entry('a', 100, 100), entry('b', 10, 30)], 'a', 48, 400, 1000);
    expect(selectHuntingThreatTarget([entry('a', 100, 100), entry('b', 10, 30)], 'a', 48, 400, 2500, first.currentOutsideReachSince).currentSessionId).toBe('b');
  });
  it('retargets in-range threat before breaking combat', () => {
    expect(selectHuntingThreatTarget([entry('a', 100, 500), entry('b', 20, 200)], 'a', 48, 400, 1000).currentSessionId).toBe('b');
  });
  it('breaks combat when nobody remains in range', () => {
    expect(selectHuntingThreatTarget([entry('a', 100, 500)], 'a', 48, 400, 1000).currentSessionId).toBe('');
  });
});