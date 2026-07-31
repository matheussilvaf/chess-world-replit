import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useGameSettingsStore } from '../../stores/gameSettingsStore';
import {
  getSelectedCharacterId,
  getWorldCharacter,
  listWorldCharacters,
  nextCharacterId,
} from '../../game/characters/characterCatalog';
import type { WorldScene } from '../../game/scenes/WorldScene';

/**
 * Temporary dev tool: cycles the local player through every valid character.
 * Visible in dev builds always; in production only when the
 * game_settings.character_switch_enabled flag is on.
 */
export function SwitchCharacterButton({ getScene }: { getScene: () => WorldScene | null }) {
  const characterSwitchEnabled = useGameSettingsStore((s) => s.characterSwitchEnabled);
  const [currentId, setCurrentId] = useState<string | null>(() => getSelectedCharacterId());
  const [busy, setBusy] = useState(false);

  const visible = import.meta.env.DEV || characterSwitchEnabled;
  if (!visible) return null;
  if (listWorldCharacters().length < 2) return null;

  const nextId = nextCharacterId(currentId);
  const next = nextId ? getWorldCharacter(nextId) : null;
  const current = currentId ? getWorldCharacter(currentId) : null;

  const onClick = async () => {
    const scene = getScene();
    if (!scene || !nextId || busy) return;
    setBusy(true);
    try {
      const ok = await scene.switchCharacter(nextId);
      if (ok) setCurrentId(nextId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <button
        onClick={onClick}
        disabled={busy || !next}
        title="Dev: trocar personagem (preserva a posição)"
        className="pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur transition-colors hover:border-cyan-500/60 hover:text-cyan-300 disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
        <span>
          {current?.displayName ?? '—'} → {next?.displayName ?? '—'}
        </span>
      </button>
    </div>
  );
}
