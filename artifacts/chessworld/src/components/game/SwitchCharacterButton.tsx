import { useEffect, useRef, useState } from 'react';
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
  const [denial, setDenial] = useState<string | null>(null);
  const denialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (denialTimerRef.current) clearTimeout(denialTimerRef.current);
    };
  }, []);

  const visible = import.meta.env.DEV || characterSwitchEnabled;
  if (!visible) return null;
  if (listWorldCharacters().length < 2) return null;

  const showDenial = (message: string) => {
    if (denialTimerRef.current) clearTimeout(denialTimerRef.current);
    setDenial(message);
    denialTimerRef.current = setTimeout(() => setDenial(null), 5000);
  };

  const nextId = nextCharacterId(currentId);
  const next = nextId ? getWorldCharacter(nextId) : null;
  const current = currentId ? getWorldCharacter(currentId) : null;

  const onClick = async () => {
    if (busy) return;
    const scene = getScene();
    if (!scene) {
      showDenial('O mundo ainda está carregando — tente de novo em instantes.');
      return;
    }
    if (!nextId) {
      showDenial('Nenhum outro personagem disponível.');
      return;
    }
    setBusy(true);
    try {
      const ok = await scene.switchCharacter(nextId);
      if (ok) {
        setDenial(null);
        setCurrentId(nextId);
      } else {
        showDenial(scene.lastSwitchDenial ?? 'Não foi possível trocar agora.');
      }
    } catch (err) {
      console.error('[SwitchCharacterButton] switch failed:', err);
      showDenial('Erro ao trocar — veja o console.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex flex-col items-center gap-1">
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
      {denial && (
        <div className="rounded border border-amber-500/40 bg-slate-900/90 px-2 py-1 text-center text-[10px] text-amber-300 shadow">
          {denial}
        </div>
      )}
    </div>
  );
}
