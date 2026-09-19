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
  const tagEls = useRef<Map<string, {
    wrap: HTMLDivElement;
    name: HTMLSpanElement;
    elo: HTMLSpanElement;
  }>>(new Map());
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = playerTagBus.subscribe((entries: PlayerTagEntry[]) => {
      const container = containerRef.current;
      if (!container) return;

      const seen = seenIds.current;
      seen.clear();

      for (const entry of entries) {
        seen.add(entry.sessionId);

        let refs = tagEls.current.get(entry.sessionId);

        if (!refs) {
          // ── Build the tag element once ───────────────────────────────────
          const el = document.createElement('div');
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
          refs = { wrap: el, name: nameSpan, elo: eloSpan };
          tagEls.current.set(entry.sessionId, refs);
        }

        // Atualiza em 30 Hz; refs diretas evitam querySelector no caminho quente.
        // translate(x - 50%, y) so the tag is horizontally centred on the
        // player. Use left:0;top:0 as the transform origin baseline.
        refs.wrap.style.transform = `translate(calc(${entry.x}px - 50%), ${entry.y}px)`;

        // ── Update text (only if content changed) ─────────────────────────
        if (refs.name.textContent !== entry.username) refs.name.textContent = entry.username;
        const rating = String(entry.rating);
        if (refs.elo.textContent !== rating) refs.elo.textContent = rating;
      }

      // ── Remove stale tags ─────────────────────────────────────────────────
      for (const [sid, refs] of tagEls.current.entries()) {
        if (!seen.has(sid)) {
          refs.wrap.remove();
          tagEls.current.delete(sid);
        }
      }
    });

    return () => {
      unsub();
      for (const refs of tagEls.current.values()) refs.wrap.remove();
      tagEls.current.clear();
      seenIds.current.clear();
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
