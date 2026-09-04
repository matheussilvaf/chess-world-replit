/**
 * Configurações do jogador (botão da engrenagem no HUD), em abas:
 *   Tema      → tabuleiro e peças (perfil)
 *   Controles → teclas de mover/atacar/interagir (aparelho)
 *
 * Diálogo modal de verdade: foco entra na aba ativa ao abrir, Tab circula só
 * dentro dele, Esc fecha (exceto durante a captura de tecla, que consome o Esc
 * antes) e o foco volta para onde estava ao fechar. Setas trocam de aba.
 */
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { X, Settings, Palette, Gamepad2 } from 'lucide-react';
import { ThemeSettings } from './settings/ThemeSettings';
import { ControlsSettings } from './settings/ControlsSettings';

type SettingsTab = 'theme' | 'controls';

const TABS: Array<{ id: SettingsTab; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'theme', label: 'Tema', icon: Palette },
  { id: 'controls', label: 'Controles', icon: Gamepad2 },
];

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SettingsModal() {
  const profile = useAuthStore((s) => s.profile);
  const showSettings = useGameStore((s) => s.showSettings);
  const toggleSettings = useGameStore((s) => s.toggleSettings);

  if (!showSettings || !profile) return null;
  return <SettingsDialog onClose={toggleSettings} />;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const profile = useAuthStore((s) => s.profile);
  const [tab, setTab] = useState<SettingsTab>('theme');
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  // Foco entra no diálogo ao abrir e volta ao elemento anterior ao fechar.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    tabRefs.current[tab]?.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectTab = (next: SettingsTab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const onTabListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.id === tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectTab(TABS[next].id);
  };

  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!profile) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onDialogKeyDown}
        className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 id="settings-title" className="text-white font-bold flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-400" />
            Configurações
          </h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Seções"
          onKeyDown={onTabListKeyDown}
          className="flex gap-1 p-1 mx-6 mt-4 rounded-lg bg-slate-800/80"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                ref={(el) => { tabRefs.current[id] = el; }}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={selected}
                aria-controls={`settings-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(id)}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  selected ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 ${selected ? 'text-amber-400' : ''}`} />
                {label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          tabIndex={0}
          className="flex-1 overflow-y-auto p-6 focus:outline-none"
        >
          {tab === 'theme' ? <ThemeSettings profile={profile} /> : <ControlsSettings />}
        </div>
      </div>
    </div>
  );
}
