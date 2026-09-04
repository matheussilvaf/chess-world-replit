/**
 * Bancada DEV das configurações/controles — rota `/dev/controles`, só existe
 * em `import.meta.env.DEV` (ver main.tsx).
 *
 * Renderiza o modal de Configurações real (abas Tema/Controles) com um perfil
 * falso e liga um KeyboardControls igual ao do WorldScene, mostrando ao vivo
 * o vetor de movimento e as ações disparadas — dá para testar religar teclas,
 * troca por conflito, bloqueio (chat/menu) e o efeito no "jogo" sem WebGL.
 * Trocar o tema aqui não funciona (não há sessão no Supabase).
 */
import { useEffect, useRef, useState } from 'react';
import { SettingsModal } from '../game/SettingsModal';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { getKeyBindings, isCapturingKey, useControlsStore } from '../../stores/controlsStore';
import { KeyboardControls, isTextInputFocused, type TriggerAction } from '../../game/input/KeyboardControls';
import { CONTROL_ACTIONS, CONTROL_ACTION_LABELS } from '../../lib/controls/keyBindings';
import type { Profile } from '../../types';

const BENCH_PROFILE: Profile = {
  id: 'bench',
  user_id: 'bench-user',
  username: 'bancada',
  avatar: '',
  current_region: 'brasil',
  rating: 1200,
  trophies: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  games_played: 0,
  board_theme: 'classic',
  piece_style: 'classic',
  created_at: '',
  updated_at: '',
};

interface Readout {
  x: number;
  y: number;
  blocked: boolean;
}

export function ControlsBenchPage() {
  const [seeded, setSeeded] = useState(false);
  const [readout, setReadout] = useState<Readout>({ x: 0, y: 0, blocked: false });
  const [actions, setActions] = useState<Array<{ action: TriggerAction; at: number }>>([]);
  const bindings = useControlsStore((s) => s.bindings);
  const showSettings = useGameStore((s) => s.showSettings);
  const toggleSettings = useGameStore((s) => s.toggleSettings);
  const lastRef = useRef<Readout>({ x: 0, y: 0, blocked: false });

  useEffect(() => {
    useAuthStore.setState({ profile: BENCH_PROFILE });
    useGameStore.setState({ showSettings: true });
    setSeeded(true);
  }, []);

  // Mesmo predicado de bloqueio do WorldScene.
  useEffect(() => {
    const isBlocked = () => isTextInputFocused() || isCapturingKey() || useGameStore.getState().showSettings;
    const kb = new KeyboardControls({
      target: window,
      document,
      getBindings: getKeyBindings,
      isBlocked,
      onAction: (action) => setActions((prev) => [{ action, at: Date.now() }, ...prev].slice(0, 6)),
    }).attach();
    let raf = 0;
    const tick = () => {
      const v = kb.moveVector();
      const next: Readout = { x: v?.x ?? 0, y: v?.y ?? 0, blocked: isBlocked() };
      const last = lastRef.current;
      if (next.x !== last.x || next.y !== last.y || next.blocked !== last.blocked) {
        lastRef.current = next;
        setReadout(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      kb.destroy();
    };
  }, []);

  if (!seeded) return null;

  const fmt = (n: number) => (Math.abs(n) < 1e-6 ? '0' : n.toFixed(2));

  return (
    <div className="relative min-h-screen bg-slate-900 text-slate-100" data-testid="controls-bench">
      <div className="p-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Bancada de controles (DEV)</span>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
          onClick={toggleSettings}
          data-testid="bench-toggle-settings"
        >
          {showSettings ? 'Fechar configurações' : 'Abrir configurações'}
        </button>
        <label className="flex items-center gap-2">
          <span className="text-slate-400">Chat (teste de bloqueio)</span>
          <input
            type="text"
            data-testid="bench-chat-input"
            placeholder="digite aqui"
            className="rounded bg-slate-800 border border-slate-600 px-2 py-1 text-slate-100"
          />
        </label>
      </div>

      <div className="px-4 grid gap-4 sm:grid-cols-2 max-w-3xl">
        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-2">
          <h2 className="font-semibold">Movimento (ao vivo)</h2>
          <p className="font-mono" data-testid="bench-move-vector">
            x={fmt(readout.x)} y={fmt(readout.y)}
          </p>
          <p data-testid="bench-blocked">Teclado do jogo: {readout.blocked ? 'bloqueado' : 'ativo'}</p>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-2">
          <h2 className="font-semibold">Ações disparadas</h2>
          <ol className="font-mono text-xs space-y-1" data-testid="bench-actions">
            {actions.length === 0 && <li className="text-slate-500">nenhuma</li>}
            {actions.map((a) => (
              <li key={a.at + a.action}>{a.action}</li>
            ))}
          </ol>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-2 sm:col-span-2">
          <h2 className="font-semibold">Mapeamento atual</h2>
          <ul className="font-mono text-xs grid grid-cols-2 sm:grid-cols-3 gap-1" data-testid="bench-bindings">
            {CONTROL_ACTIONS.map((action) => (
              <li key={action} data-testid={`bench-binding-${action}`}>
                {CONTROL_ACTION_LABELS[action]}: {bindings[action].label} ({bindings[action].code})
              </li>
            ))}
          </ul>
        </section>
      </div>

      <SettingsModal />
    </div>
  );
}
