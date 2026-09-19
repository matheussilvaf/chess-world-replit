import { create } from 'zustand';

export const TOUCH_CONTROLS_STORAGE_KEY = 'chessworld.touchControls.v1';
const OLD_ATTACK_STORAGE_KEY = 'chessworld:attack-button:v1';

export type TouchPositioning = 'joystick' | 'attack' | null;
export interface TouchControlsConfig {
  joystick: {
    enabled: boolean;
    opacity: number;
    size: number;
    position: { x: number; y: number };
  };
  attack: {
    size: number;
    opacity: number;
    position: { right: number; bottom: number } | null;
  };
}

export const DEFAULT_TOUCH_CONTROLS: TouchControlsConfig = {
  joystick: { enabled: true, opacity: 0.55, size: 130, position: { x: 95, y: 200 } },
  attack: { size: 72, opacity: 1, position: null },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function clampTouchConfig(config: TouchControlsConfig): TouchControlsConfig {
  const width = typeof window === 'undefined' ? 390 : window.innerWidth;
  const height = typeof window === 'undefined' ? 844 : window.innerHeight;
  const joystickSize = Math.round(clamp(config.joystick.size, 80, 220));
  const attackSize = Math.round(clamp(config.attack.size, 56, 140));
  const half = joystickSize / 2;
  const attackPosition = config.attack.position
    ? {
        right: Math.round(clamp(config.attack.position.right, 0, Math.max(0, width - attackSize))),
        bottom: Math.round(clamp(config.attack.position.bottom, 0, Math.max(0, height - attackSize))),
      }
    : null;
  return {
    joystick: {
      enabled: config.joystick.enabled !== false,
      opacity: clamp(config.joystick.opacity, 0.15, 1),
      size: joystickSize,
      position: {
        x: Math.round(clamp(config.joystick.position.x, half, Math.max(half, width - half))),
        y: Math.round(clamp(config.joystick.position.y, half, Math.max(half, height - half))),
      },
    },
    attack: {
      size: attackSize,
      opacity: clamp(config.attack.opacity, 0.3, 1),
      position: attackPosition,
    },
  };
}

function loadConfig(): TouchControlsConfig {
  let loaded: TouchControlsConfig = structuredClone(DEFAULT_TOUCH_CONTROLS);
  if (typeof window === 'undefined') return loaded;
  try {
    const raw = localStorage.getItem(TOUCH_CONTROLS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      loaded = {
        joystick: { ...loaded.joystick, ...parsed?.joystick, position: { ...loaded.joystick.position, ...parsed?.joystick?.position } },
        attack: { ...loaded.attack, ...parsed?.attack },
      };
    } else {
      const legacy = JSON.parse(localStorage.getItem(OLD_ATTACK_STORAGE_KEY) || 'null');
      if (legacy && typeof legacy === 'object') {
        loaded.attack = {
          ...loaded.attack,
          size: typeof legacy.size === 'number' ? legacy.size : loaded.attack.size,
          position: typeof legacy.right === 'number' && typeof legacy.bottom === 'number'
            ? { right: legacy.right, bottom: legacy.bottom }
            : null,
        };
        localStorage.removeItem(OLD_ATTACK_STORAGE_KEY);
      }
    }
  } catch {
    // Storage indisponível ou corrompido: mantém os padrões seguros.
  }
  return clampTouchConfig(loaded);
}

function persist(config: TouchControlsConfig) {
  try {
    localStorage.setItem(TOUCH_CONTROLS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // A configuração continua válida nesta sessão.
  }
}

interface TouchControlsState extends TouchControlsConfig {
  positioning: TouchPositioning;
  setJoystick: (patch: Partial<TouchControlsConfig['joystick']>) => void;
  setAttack: (patch: Partial<TouchControlsConfig['attack']>) => void;
  setPositioning: (value: TouchPositioning) => void;
  resetPosition: (control: Exclude<TouchPositioning, null>) => void;
  clampToViewport: () => void;
}

const initial = loadConfig();
export const useTouchControlsStore = create<TouchControlsState>((set, get) => ({
  ...initial,
  positioning: null,
  setJoystick: (patch) => set((state) => {
    const config = clampTouchConfig({
      joystick: { ...state.joystick, ...patch, position: { ...state.joystick.position, ...patch.position } },
      attack: state.attack,
    });
    persist(config);
    return config;
  }),
  setAttack: (patch) => set((state) => {
    const config = clampTouchConfig({
      joystick: state.joystick,
      attack: { ...state.attack, ...patch },
    });
    persist(config);
    return config;
  }),
  setPositioning: (positioning) => set({ positioning }),
  resetPosition: (control) => {
    if (control === 'joystick') get().setJoystick({ position: DEFAULT_TOUCH_CONTROLS.joystick.position });
    else get().setAttack({ position: null });
  },
  clampToViewport: () => set((state) => {
    const config = clampTouchConfig({ joystick: state.joystick, attack: state.attack });
    persist(config);
    return config;
  }),
}));
