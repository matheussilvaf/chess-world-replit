/**
 * Aba "Controles": tecla de cada ação do jogo (mover, atacar, interagir).
 *
 * Clicar numa tecla entra em captura: a PRÓXIMA tecla física vira a tecla da
 * ação (Esc cancela). Tecla já usada por outra ação → as duas trocam. Enquanto
 * captura, o ouvinte roda na fase de captura da janela e interrompe o evento,
 * então nem o jogo nem o navegador reagem à tecla escolhida.
 */
import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { useControlsStore } from '../../../stores/controlsStore';
import {
  CONTROL_ACTION_LABELS,
  DEFAULT_KEY_BINDINGS,
  bindingsEqual,
  isBindableCode,
  isSystemChord,
  labelForKeyEvent,
  type ControlAction,
} from '../../../lib/controls/keyBindings';

const NOTICE_MS = 3500;

export function ControlsSettings() {
  const bindings = useControlsStore((s) => s.bindings);
  const capturing = useControlsStore((s) => s.capturing);
  const setCapturing = useControlsStore((s) => s.setCapturing);
  const bind = useControlsStore((s) => s.bind);
  const resetBindings = useControlsStore((s) => s.resetBindings);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);

  // Captura da próxima tecla enquanto `capturing` estiver definido.
  useEffect(() => {
    if (!capturing) return;
    const action = capturing;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') {
        setCapturing(null);
        return;
      }
      if (!isBindableCode(e.code)) {
        setNotice({ text: 'Essa tecla não pode ser usada no jogo. Tente outra.', tone: 'warn' });
        return;
      }
      if (isSystemChord(e)) {
        setNotice({ text: 'Combinações com Ctrl, Alt ou ⌘ não são suportadas. Pressione só a tecla.', tone: 'warn' });
        return;
      }
      const label = labelForKeyEvent(e);
      const swappedWith = bind(action, { code: e.code, label });
      setCapturing(null);
      setNotice(
        swappedWith
          ? {
              text: `${label} agora é "${CONTROL_ACTION_LABELS[action]}"; "${CONTROL_ACTION_LABELS[swappedWith]}" ficou com a tecla antiga.`,
              tone: 'info',
            }
          : { text: `"${CONTROL_ACTION_LABELS[action]}" agora é ${label}.`, tone: 'info' },
      );
    };
    const cancel = () => setCapturing(null);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', cancel);
    };
  }, [capturing, bind, setCapturing]);

  // Fechar a aba/modal no meio da captura não pode deixar o jogo bloqueado.
  useEffect(() => () => setCapturing(null), [setCapturing]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  const isDefault = bindingsEqual(bindings, DEFAULT_KEY_BINDINGS);

  const keyCap = (action: ControlAction, className = '') => {
    const active = capturing === action;
    return (
      <button
        type="button"
        onClick={() => setCapturing(active ? null : action)}
        aria-label={`${CONTROL_ACTION_LABELS[action]}: ${bindings[action].label}. Clique para trocar.`}
        aria-pressed={active}
        data-testid={`keybind-${action}`}
        className={`inline-flex items-center justify-center rounded-lg border font-mono text-sm font-semibold transition-all select-none ${
          active
            ? 'border-amber-400 bg-amber-500/15 text-amber-200 shadow-[0_0_0_3px_rgba(251,191,36,0.25)] animate-pulse'
            : 'border-slate-600 bg-slate-800 text-white hover:border-slate-400 hover:bg-slate-700'
        } ${className}`}
      >
        {active ? '…' : bindings[action].label}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400 flex items-start gap-2">
        <Keyboard className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
        <span>
          Clique em uma tecla e pressione a nova tecla. <kbd className="px-1 rounded bg-slate-700 text-slate-200">Esc</kbd> cancela.
          Salvo neste aparelho.
        </span>
      </p>

      <div>
        <h4 className="text-white font-medium mb-3">Movimento</h4>
        <div className="flex items-center gap-5">
          {/* Cruz de direções: cima em cima; esquerda/baixo/direita embaixo. */}
          <div className="grid grid-cols-3 gap-1.5 shrink-0" aria-label="Teclas de movimento">
            <div />
            {keyCap('moveUp', 'w-12 h-12')}
            <div />
            {keyCap('moveLeft', 'w-12 h-12')}
            {keyCap('moveDown', 'w-12 h-12')}
            {keyCap('moveRight', 'w-12 h-12')}
          </div>
          <ul className="text-xs text-slate-300 space-y-1.5">
            {(['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map((action) => (
              <li key={action} className="flex items-center justify-between gap-3">
                <span className="text-slate-400">{CONTROL_ACTION_LABELS[action]}</span>
                <span className="font-mono text-white">{capturing === action ? '…' : bindings[action].label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h4 className="text-white font-medium mb-3">Ações</h4>
        <ul className="space-y-2">
          {(['attack', 'interact'] as const).map((action) => (
            <li
              key={action}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/80 bg-slate-800/40 px-3 py-2"
            >
              <span className="text-sm text-slate-200">{CONTROL_ACTION_LABELS[action]}</span>
              {keyCap(action, 'min-w-[3rem] h-9 px-3')}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between gap-3 min-h-[2rem]">
        <p
          role="status"
          aria-live="polite"
          className={`text-xs leading-snug ${
            notice ? (notice.tone === 'warn' ? 'text-amber-300' : 'text-emerald-300') : 'text-slate-400'
          }`}
        >
          {notice ? notice.text : capturing ? 'Aguardando tecla…' : ''}
        </p>
        <button
          type="button"
          onClick={() => {
            setCapturing(null);
            resetBindings();
            setNotice({ text: 'Teclas padrão restauradas (W A S D, F, E).', tone: 'info' });
          }}
          disabled={isDefault}
          className="inline-flex items-center gap-1.5 shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restaurar padrão
        </button>
      </div>
    </div>
  );
}
