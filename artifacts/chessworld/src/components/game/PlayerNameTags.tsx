import { useEffect, useRef } from 'react';
import { playerTagBus, type PlayerTagEntry } from '../../game/playerTagBus';

/**
 * PlayerNameTags
 *
 * Renders remote-player name + elo badges as HTML elements positioned over
 * the Phaser canvas. The overlay covers the full canvas (absolute inset-0)
 * and is pointer-events:none so it never blocks game input.
 *
 * We avoid React re-renders at 60 fps by mutating DOM nodes directly inside
 * the playerTagBus subscription callback. Each player gets one div that we
 * move with CSS transform; React only runs when players join/leave.
 */
export function PlayerNameTags() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tagEls = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const unsub = playerTagBus.subscribe((entries: PlayerTagEntry[]) => {
      const container = containerRef.current;
      if (!container) return;

      const seen = new Set<string>();

      for (const entry of entries) {
        seen.add(entry.sessionId);

        let el = tagEls.current.get(entry.sessionId);

        if (!el) {
          // ── Build the tag element once ───────────────────────────────────
          el = document.createElement('div');
          el.className = 'player-nametag-wrap';

          const inner = document.createElement('div');
          inner.className = 'player-nametag';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'player-nametag-name';

          const eloSpan = document.createElement('span');
          eloSpan.className = 'player-nametag-elo';

          inner.appendChild(nameSpan);
          inner.appendChild(eloSpan);
          el.appendChild(inner);
          container.appendChild(el);
          tagEls.current.set(entry.sessionId, el);
        }

        // ── Update position (runs every frame at 60 fps) ──────────────────
        // translate(x - 50%, y) so the tag is horizontally centred on the
        // player. Use left:0;top:0 as the transform origin baseline.
        el.style.transform = `translate(calc(${entry.x}px - 50%), ${entry.y}px)`;

        // ── Update text (only if content changed) ─────────────────────────
        const nameEl = el.querySelector('.player-nametag-name') as HTMLElement | null;
        const eloEl  = el.querySelector('.player-nametag-elo')  as HTMLElement | null;
        if (nameEl && nameEl.textContent !== entry.username)       nameEl.textContent = entry.username;
        if (eloEl  && eloEl.textContent  !== String(entry.rating)) eloEl.textContent  = String(entry.rating);
      }

      // ── Remove stale tags ─────────────────────────────────────────────────
      for (const [sid, el] of tagEls.current.entries()) {
        if (!seen.has(sid)) {
          el.remove();
          tagEls.current.delete(sid);
        }
      }
    });

    return () => {
      unsub();
      for (const el of tagEls.current.values()) el.remove();
      tagEls.current.clear();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10, overflow: 'hidden' }}
    />
  );
}
