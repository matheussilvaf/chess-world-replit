/**
 * Mapeamento de teclas do jogador (Configurações → Controles).
 *
 * Cada ação tem UMA tecla, identificada pelo `KeyboardEvent.code` (tecla
 * física — WASD continua no mesmo lugar em qualquer layout) e um rótulo de
 * exibição capturado na hora de configurar (`KeyboardEvent.key`), para que
 * teclados ABNT2 mostrem "Ç" e não "Semicolon".
 *
 * Regras:
 *  - uma tecla nunca fica em duas ações: religar uma tecla já usada TROCA as
 *    teclas das duas ações (nenhuma ação fica sem tecla);
 *  - só teclas "de jogo" são permitidas (letras, dígitos, setas, espaço,
 *    modificadores, pontuação) — Esc cancela a captura, Tab/F5/F11/Meta
 *    seguem sendo do navegador.
 */

export type ControlAction = 'moveUp' | 'moveLeft' | 'moveDown' | 'moveRight' | 'attack' | 'interact';

export interface KeyBinding {
  /** `KeyboardEvent.code` (ex.: "KeyW", "Space", "ArrowUp"). */
  code: string;
  /** Texto curto mostrado na tecla (ex.: "W", "Espaço", "↑"). */
  label: string;
}

export type KeyBindings = Record<ControlAction, KeyBinding>;

export const MOVE_ACTIONS: readonly ControlAction[] = ['moveUp', 'moveLeft', 'moveDown', 'moveRight'];

/** Ordem canônica: define quem "vence" em caso de duplicata corrompida no storage. */
export const CONTROL_ACTIONS: readonly ControlAction[] = [...MOVE_ACTIONS, 'attack', 'interact'];

export const CONTROL_ACTION_LABELS: Record<ControlAction, string> = {
  moveUp: 'Mover para cima',
  moveLeft: 'Mover para a esquerda',
  moveDown: 'Mover para baixo',
  moveRight: 'Mover para a direita',
  attack: 'Atacar',
  interact: 'Interagir',
};

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveUp: { code: 'KeyW', label: 'W' },
  moveLeft: { code: 'KeyA', label: 'A' },
  moveDown: { code: 'KeyS', label: 'S' },
  moveRight: { code: 'KeyD', label: 'D' },
  attack: { code: 'KeyF', label: 'F' },
  interact: { code: 'KeyE', label: 'E' },
};

const SPECIAL_CODE_LABELS: Record<string, string> = {
  Space: 'Espaço',
  Enter: 'Enter',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift Esq.',
  ShiftRight: 'Shift Dir.',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  IntlBackslash: '\\',
  IntlRo: '/',
  IntlYen: '¥',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadComma: 'Num ,',
  NumpadEnter: 'Num Enter',
};

const ALLOWED_CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/;

/** Teclas que podem ser atribuídas a uma ação do jogo. */
export function isBindableCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length === 0 || code.length > 24) return false;
  return ALLOWED_CODE_RE.test(code) || Object.prototype.hasOwnProperty.call(SPECIAL_CODE_LABELS, code);
}

/**
 * Evento de teclado que é um atalho do navegador/sistema (Ctrl/Alt/Meta + tecla)
 * ou digitação por IME — nunca um comando do jogo. (Shift pode ficar apertado:
 * Shift+W continua sendo W.)
 */
export function isSystemChord(e: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean }): boolean {
  return !!(e.ctrlKey || e.altKey || e.metaKey || e.isComposing);
}

/** Rótulo derivado só do `code` (quando não há `key` legível). */
export function keyLabelForCode(code: string): string {
  const special = SPECIAL_CODE_LABELS[code];
  if (special) return special;
  const m = /^(Key|Digit)(.)$/.exec(code);
  if (m) return m[2].toUpperCase();
  const n = /^Numpad([0-9])$/.exec(code);
  if (n) return `Num ${n[1]}`;
  return code;
}

/**
 * Rótulo para o evento capturado: caractere imprimível da tecla (respeita o
 * layout: "Ç", "´") ou, para teclas sem caractere, o nome derivado do `code`.
 */
export function labelForKeyEvent(e: { code: string; key: string; shiftKey?: boolean }): string {
  const k = typeof e.key === 'string' ? e.key : '';
  // Com Shift segurado o caractere é o "de cima" (#, !, …), mas a tecla física
  // é a mesma: rotula pela tecla base para não enganar.
  if (e.shiftKey && !e.code.startsWith('Shift')) return keyLabelForCode(e.code);
  if (k.length === 1 && k !== ' ') return k.toUpperCase();
  return keyLabelForCode(e.code);
}

function sanitizeBinding(raw: unknown): KeyBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const { code, label } = raw as { code?: unknown; label?: unknown };
  if (!isBindableCode(code)) return null;
  const text = typeof label === 'string' ? label.trim().slice(0, 12) : '';
  return { code, label: text || keyLabelForCode(code) };
}

/** Teclas livres candidatas quando um mapeamento corrompido repete teclas. */
const FALLBACK_CODES = [
  ...CONTROL_ACTIONS.map((a) => DEFAULT_KEY_BINDINGS[a].code),
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyQ', 'KeyR', 'KeyG', 'KeyX', 'KeyZ', 'KeyC', 'KeyV',
];

/**
 * Storage → mapeamento válido: ações ausentes/inválidas voltam ao padrão e
 * teclas duplicadas são resolvidas na ordem canônica — a primeira ação fica
 * com a tecla, a seguinte recebe seu padrão ou, se já ocupado, a primeira
 * tecla livre da lista de reserva. Nunca sobram duas ações na mesma tecla.
 */
export function sanitizeBindings(raw: unknown): KeyBindings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as KeyBindings;
  const used = new Set<string>();
  for (const action of CONTROL_ACTIONS) {
    let binding = sanitizeBinding(source[action]) ?? DEFAULT_KEY_BINDINGS[action];
    if (used.has(binding.code)) {
      const fallback = DEFAULT_KEY_BINDINGS[action];
      if (!used.has(fallback.code)) {
        binding = fallback;
      } else {
        const free = FALLBACK_CODES.find((code) => !used.has(code))!;
        binding = { code: free, label: keyLabelForCode(free) };
      }
    }
    used.add(binding.code);
    out[action] = binding;
  }
  return out;
}

export function bindingsEqual(a: KeyBindings, b: KeyBindings): boolean {
  return CONTROL_ACTIONS.every((action) => a[action].code === b[action].code && a[action].label === b[action].label);
}

/** Ação ligada a uma tecla física (null = tecla livre). */
export function actionForCode(bindings: KeyBindings, code: string): ControlAction | null {
  for (const action of CONTROL_ACTIONS) {
    if (bindings[action].code === code) return action;
  }
  return null;
}

export interface RebindResult {
  bindings: KeyBindings;
  /** Ação que recebeu a tecla antiga (a tecla escolhida já era dela). */
  swappedWith: ControlAction | null;
}

/**
 * Atribui `binding` a `action`. Se a tecla já pertencia a outra ação, as duas
 * trocam de tecla — assim nenhuma ação fica sem tecla.
 */
export function rebind(bindings: KeyBindings, action: ControlAction, binding: KeyBinding): RebindResult {
  const clean = sanitizeBinding(binding);
  if (!clean) return { bindings, swappedWith: null };
  const owner = actionForCode(bindings, clean.code);
  if (owner === action) {
    if (bindings[action].label === clean.label) return { bindings, swappedWith: null };
    return { bindings: { ...bindings, [action]: clean }, swappedWith: null };
  }
  const next: KeyBindings = { ...bindings, [action]: clean };
  if (owner) next[owner] = bindings[action];
  return { bindings: next, swappedWith: owner };
}

export interface MoveVector {
  x: number;
  y: number;
}

/**
 * Vetor de movimento (espaço da TELA, y para baixo) a partir das ações de
 * direção pressionadas. Direções opostas se cancelam; diagonais são
 * normalizadas para o personagem não andar mais rápido. null = parado.
 */
export function moveVectorFromActions(pressed: ReadonlySet<ControlAction>): MoveVector | null {
  const x = (pressed.has('moveRight') ? 1 : 0) - (pressed.has('moveLeft') ? 1 : 0);
  const y = (pressed.has('moveDown') ? 1 : 0) - (pressed.has('moveUp') ? 1 : 0);
  if (x === 0 && y === 0) return null;
  if (x !== 0 && y !== 0) {
    const k = Math.SQRT1_2;
    return { x: x * k, y: y * k };
  }
  return { x, y };
}
