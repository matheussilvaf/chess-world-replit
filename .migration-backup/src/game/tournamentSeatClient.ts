export function seatTournamentPlayerWhenReady(
  boardId: string,
  seat: string,
  color: 'w' | 'b',
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const attempt = (remaining: number) => {
    if (cancelled) return;

    const scene = (window as any).__worldScene;
    if (!scene) {
      if (remaining > 0) {
        timer = setTimeout(() => attempt(remaining - 1), 100);
      }
      return;
    }

    if (scene.currentSeatInfo?.tableId === boardId && scene.currentSeatInfo?.seat === seat) {
      return;
    }

    if (scene.tableRegistry?.tables?.has(boardId)) {
      scene.seatPlayer(boardId, 'player', seat, color);
      return;
    }

    if (remaining > 0) {
      timer = setTimeout(() => attempt(remaining - 1), 100);
    } else {
      console.warn('[tournamentSeatClient] Gave up waiting for table', boardId);
    }
  };

  attempt(50);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
