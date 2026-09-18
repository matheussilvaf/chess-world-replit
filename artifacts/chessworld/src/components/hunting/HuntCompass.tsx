import { useEffect, useRef } from 'react';
import { huntCompassBus, type HuntCompassEntry } from '../../game/hunting/huntCompassBus';

/** World px per displayed metre (one map tile). */
const PX_PER_METRE = 32;

/**
 * HuntCompass
 *
 * Arrows at the edge of the screen pointing to the player's contract animals while they are out of
 * view. Like PlayerNameTags, the overlay covers the canvas (absolute inset-0, pointer-events:none)
 * and the DOM nodes are moved directly from the huntCompassBus callback — WorldScene decides per
 * frame which animals get an arrow (off-screen, alive), so React never re-renders at 60 fps.
 */
export function HuntCompass() {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<Map<string, { wrap: HTMLDivElement; arrow: HTMLDivElement; name: HTMLSpanElement; dist: HTMLSpanElement }>>(new Map());

  useEffect(() => {
    const unsub = huntCompassBus.subscribe((entries: HuntCompassEntry[]) => {
      const container = containerRef.current;
      if (!container) return;
      const seen = new Set<string>();
      for (const entry of entries) {
        seen.add(entry.id);
        let node = nodes.current.get(entry.id);
        if (!node) {
          const wrap = document.createElement('div');
          wrap.className = 'hunt-compass-wrap';
          const arrow = document.createElement('div');
          arrow.className = 'hunt-compass-arrow';
          arrow.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M22 12 L6 3 L10 12 L6 21 Z" fill="#fbbf24" stroke="#1c1917" stroke-width="1.5" stroke-linejoin="round"/></svg>';
          const label = document.createElement('div');
          label.className = 'hunt-compass-label';
          const name = document.createElement('span');
          name.className = 'hunt-compass-name';
          const dist = document.createElement('span');
          dist.className = 'hunt-compass-dist';
          label.append(name, dist);
          wrap.append(arrow, label);
          container.appendChild(wrap);
          node = { wrap, arrow, name, dist };
          nodes.current.set(entry.id, node);
        }
        node.wrap.style.transform = `translate(${entry.x}px, ${entry.y}px) translate(-50%, -50%)`;
        node.arrow.style.transform = `rotate(${entry.angleDeg}deg)`;
        const distance = `${Math.max(1, Math.round(entry.distancePx / PX_PER_METRE))} m`;
        if (node.name.textContent !== entry.name) node.name.textContent = entry.name;
        if (node.dist.textContent !== distance) node.dist.textContent = distance;
      }
      for (const [id, node] of nodes.current.entries()) {
        if (seen.has(id)) continue;
        node.wrap.remove();
        nodes.current.delete(id);
      }
    });
    return () => {
      unsub();
      for (const node of nodes.current.values()) node.wrap.remove();
      nodes.current.clear();
    };
  }, []);

  return <div ref={containerRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 11, overflow: 'hidden' }} />;
}
