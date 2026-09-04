/**
 * Controles do jogador (teclas) — persistidos NESTE aparelho (localStorage),
 * não no perfil: o layout do teclado é do computador, não da conta.
 *
 * `capturing` = ação esperando a próxima tecla na aba Controles; enquanto
 * houver captura o jogo ignora o teclado (o WorldScene consulta este store).
 */
import { create } from 'zustand';
import {
  DEFAULT_KEY_BINDINGS,
  bindingsEqual,
  rebind,
  sanitizeBindings,
  type ControlAction,
  type KeyBinding,
  type KeyBindings,
} from '../lib/controls/keyBindings';

export const CONTROLS_STORAGE_KEY = 'chessworld.controls.v1';

function loadBindings(): KeyBindings {
  try {
    const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
    if (raw) return sanitizeBindings(JSON.parse(raw));
  } catch {
    // storage indisponível/corrompido — segue com o padrão
  }
  return { ...DEFAULT_KEY_BINDINGS };
}

function persistBindings(bindings: KeyBindings) {
  try {
    if (bindingsEqual(bindings, DEFAULT_KEY_BINDINGS)) localStorage.removeItem(CONTROLS_STORAGE_KEY);
    else localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // sem storage: a escolha vale só até recarregar
  }
}

interface ControlsState {
  bindings: KeyBindings;
  capturing: ControlAction | null;
  setCapturing: (action: ControlAction | null) => void;
  /** Atribui a tecla; devolve a ação que ficou com a tecla antiga (troca) ou null. */
  bind: (action: ControlAction, binding: KeyBinding) => ControlAction | null;
  resetBindings: () => void;
}

export const useControlsStore = create<ControlsState>((set, get) => ({
  bindings: loadBindings(),
  capturing: null,
  setCapturing: (action) => set({ capturing: action }),
  bind: (action, binding) => {
    const result = rebind(get().bindings, action, binding);
    if (result.bindings !== get().bindings) {
      persistBindings(result.bindings);
      set({ bindings: result.bindings });
    }
    return result.swappedWith;
  },
  resetBindings: () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS };
    persistBindings(bindings);
    set({ bindings });
  },
}));

/** Leitura fora do React (WorldScene). */
export function getKeyBindings(): KeyBindings {
  return useControlsStore.getState().bindings;
}

/** true enquanto a aba Controles está esperando uma tecla. */
export function isCapturingKey(): boolean {
  return useControlsStore.getState().capturing !== null;
}
