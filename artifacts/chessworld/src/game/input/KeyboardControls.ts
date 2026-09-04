/**
 * Teclado do jogador: traduz teclas físicas (`KeyboardEvent.code`) nas ações
 * do jogo usando o mapeamento atual (Configurações → Controles).
 *
 *  - Direções ficam "pressionadas" entre keydown e keyup; o WorldScene lê
 *    `moveVector()` a cada frame (WASD por padrão).
 *  - Atacar/Interagir disparam `onAction` no keydown (atacar aceita
 *    auto-repeat: segurar a tecla golpeia no ritmo do cooldown; interagir não,
 *    para não confirmar duas vezes).
 *  - Enquanto `isBlocked()` (digitando no chat, menu de configurações aberto)
 *    nenhuma tecla vira ação e as direções presas são soltas — mas keyup é
 *    SEMPRE processado, senão soltar a tecla dentro do chat deixava o
 *    personagem andando sozinho.
 *  - Perder o foco da janela/aba solta tudo (alt-tab com W apertado).
 *  - Trocar o mapeamento solta tudo (a tecla antiga nunca fica presa).
 */
import {
  actionForCode,
  isSystemChord,
  moveVectorFromActions,
  type ControlAction,
  type KeyBindings,
  type MoveVector,
} from '../../lib/controls/keyBindings';

export interface KeyLikeEvent {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  preventDefault?: () => void;
}

/** Subconjunto de `Window` usado — permite testar sem DOM. */
export interface KeyEventTarget {
  addEventListener(type: string, listener: (e: any) => void): void;
  removeEventListener(type: string, listener: (e: any) => void): void;
}

export type TriggerAction = 'attack' | 'interact';

export interface KeyboardControlsOptions {
  target: KeyEventTarget;
  getBindings: () => KeyBindings;
  /** true = ignorar teclas do jogo (campo de texto focado, menu aberto). */
  isBlocked: () => boolean;
  onAction: (action: TriggerAction) => void;
  /** `document` para ouvir `visibilitychange` (opcional). */
  document?: KeyEventTarget & { hidden?: boolean };
}

export class KeyboardControls {
  private readonly pressed = new Set<ControlAction>();
  private readonly opts: KeyboardControlsOptions;
  private lastBindings: KeyBindings | null = null;
  private attached = false;

  constructor(opts: KeyboardControlsOptions) {
    this.opts = opts;
  }

  attach(): this {
    if (this.attached) return this;
    this.attached = true;
    this.opts.target.addEventListener('keydown', this.onKeyDown);
    this.opts.target.addEventListener('keyup', this.onKeyUp);
    this.opts.target.addEventListener('blur', this.onBlur);
    this.opts.document?.addEventListener('visibilitychange', this.onVisibility);
    return this;
  }

  destroy(): void {
    if (!this.attached) return;
    this.attached = false;
    this.opts.target.removeEventListener('keydown', this.onKeyDown);
    this.opts.target.removeEventListener('keyup', this.onKeyUp);
    this.opts.target.removeEventListener('blur', this.onBlur);
    this.opts.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.pressed.clear();
  }

  /** Solta todas as direções (foco perdido, mapeamento trocado, bloqueio). */
  clear(): void {
    this.pressed.clear();
  }

  /** Alguma direção pressionada e não bloqueada. */
  isMoving(): boolean {
    return this.moveVector() !== null;
  }

  /**
   * Vetor de movimento no espaço da tela (y para baixo, diagonal
   * normalizada) ou null quando parado/bloqueado.
   */
  moveVector(): MoveVector | null {
    if (this.pressed.size === 0) return null;
    if (this.opts.isBlocked()) {
      this.pressed.clear();
      return null;
    }
    return moveVectorFromActions(this.pressed);
  }

  /** Mapeamento atual; se mudou desde a última leitura, solta as teclas presas. */
  private bindings(): KeyBindings {
    const current = this.opts.getBindings();
    if (this.lastBindings && this.lastBindings !== current) this.pressed.clear();
    this.lastBindings = current;
    return current;
  }

  private readonly onKeyDown = (e: KeyLikeEvent): void => {
    const action = actionForCode(this.bindings(), e.code);
    if (!action) return;
    // Ctrl+F (buscar), Ctrl+W (fechar aba), Alt+…: atalho do navegador, não comando.
    if (isSystemChord(e)) return;
    if (this.opts.isBlocked()) return;
    e.preventDefault?.();
    if (action === 'attack' || action === 'interact') {
      if (action === 'interact' && e.repeat) return;
      this.opts.onAction(action);
      return;
    }
    this.pressed.add(action);
  };

  private readonly onKeyUp = (e: KeyLikeEvent): void => {
    const action = actionForCode(this.bindings(), e.code);
    if (!action) return;
    this.pressed.delete(action);
    // Tecla do jogo: nem no keyup o navegador deve agir (Espaço/Enter "clicam"
    // um botão do HUD que ficou com foco após o último clique).
    if (!isSystemChord(e) && !this.opts.isBlocked()) e.preventDefault?.();
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  private readonly onVisibility = (): void => {
    if (this.opts.document?.hidden) this.pressed.clear();
  };
}

/** Foco em campo de texto: as teclas são digitação, não comandos do jogo. */
export function isTextInputFocused(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
