export interface HuntingThreatEntry {
  sessionId: string;
  threat: number;
  distance: number;
  lastHitAt: number;
}

export interface HuntingThreatSelection {
  currentSessionId: string;
  currentOutsideReachSince: number;
}

/**
 * Pure target selector. The caller is responsible for removing invalid players and
 * decaying threat before invoking it.
 */
export function selectHuntingThreatTarget(
  entries: readonly HuntingThreatEntry[],
  currentSessionId: string,
  attackReach: number,
  combatBreakRange: number,
  now: number,
  currentOutsideReachSince = 0,
): HuntingThreatSelection {
  const inCombat = entries.filter((entry) => entry.distance <= combatBreakRange);
  if (!inCombat.length) return { currentSessionId: '', currentOutsideReachSince: 0 };
  const highest = [...inCombat].sort((a, b) => b.threat - a.threat)[0];
  const current = inCombat.find((entry) => entry.sessionId === currentSessionId);
  if (!current) return { currentSessionId: highest.sessionId, currentOutsideReachSince: 0 };

  const outsideSince = current.distance > attackReach
    ? (currentOutsideReachSince || now)
    : 0;
  const reachable = inCombat
    .filter((entry) => entry.sessionId !== current.sessionId && entry.distance <= attackReach)
    .sort((a, b) => b.threat - a.threat)[0];
  if (reachable && outsideSince && now - outsideSince >= 1500) {
    return { currentSessionId: reachable.sessionId, currentOutsideReachSince: 0 };
  }
  if (highest.sessionId !== current.sessionId && highest.threat >= current.threat * 1.3) {
    return { currentSessionId: highest.sessionId, currentOutsideReachSince: 0 };
  }
  return { currentSessionId: current.sessionId, currentOutsideReachSince: outsideSince };
}