/**
 * Estado de UI do inventário (janela aberta/fechada) e do fluxo de soltar
 * item no chão:
 *
 *   arrastar item para fora da janela → `beginPlacement` (a janela FECHA)
 *   → fase 'pick': o jogador escolhe o ponto no mapa (overlay captura o clique)
 *   → `choosePoint` → fase 'confirm': popover de quantidade no ponto escolhido
 *   → `markSending(requestId)` → fase 'sending' até a resposta do servidor
 *   → `resolvePlacement`: ok encerra o fluxo; erro volta para 'confirm' com a
 *     mensagem (o jogador tenta de novo ou cancela) | `cancelPlacement` (reabre a janela).
 */
import { create } from 'zustand';

export interface DropPlacement {
  itemKey: string;
  /** Saldo disponível (limite da quantidade). */
  max: number;
  phase: 'pick' | 'confirm' | 'sending';
  qty: number;
  /** requestId do drop em voo (fase 'sending'). */
  requestId?: string;
  /** Recusa do servidor na última tentativa (mostrada no popover). */
  error?: string;
  /** Ponto escolhido no mundo (válido na fase 'confirm'). */
  worldX: number;
  worldY: number;
  /** Mesmo ponto em coordenadas da tela — ancora o popover. */
  screenX: number;
  screenY: number;
}

interface InventoryUiState {
  open: boolean;
  placement: DropPlacement | null;
  openInventory: () => void;
  closeInventory: () => void;
  toggleInventory: () => void;
  beginPlacement: (itemKey: string, max: number) => void;
  choosePoint: (point: { worldX: number; worldY: number; screenX: number; screenY: number }) => void;
  setPlacementQty: (qty: number) => void;
  /** Volta da confirmação para a escolha do ponto. */
  repickPoint: () => void;
  /** Desiste: reabre o inventário. */
  cancelPlacement: () => void;
  /** Drop enviado ao servidor: aguarda a resposta com este requestId. */
  markSending: (requestId: string) => void;
  /**
   * Resposta do servidor ao drop. Devolve true se o requestId era o do fluxo
   * atual (e portanto já foi tratado aqui — não precisa de aviso avulso).
   */
  resolvePlacement: (requestId: string | undefined, result: { ok: true } | { ok: false; message: string }) => boolean;
  /** Encerra o fluxo (inventário continua fechado). */
  finishPlacement: () => void;
  reset: () => void;
}

const clampQty = (qty: number, max: number) => Math.min(Math.max(1, Math.floor(qty) || 1), Math.max(1, max));

export const useInventoryUiStore = create<InventoryUiState>((set, get) => ({
  open: false,
  placement: null,
  openInventory: () => set({ open: true, placement: null }),
  closeInventory: () => set({ open: false }),
  toggleInventory: () => set((s) => ({ open: !s.open, placement: null })),
  beginPlacement: (itemKey, max) => set({
    open: false,
    placement: { itemKey, max, phase: 'pick', qty: clampQty(max, max), worldX: 0, worldY: 0, screenX: 0, screenY: 0 },
  }),
  choosePoint: (point) => set((s) => (
    s.placement && s.placement.phase !== 'sending'
      ? { placement: { ...s.placement, ...point, phase: 'confirm', error: undefined } }
      : s
  )),
  setPlacementQty: (qty) => set((s) => (
    s.placement && s.placement.phase !== 'sending'
      ? { placement: { ...s.placement, qty: clampQty(qty, s.placement.max) } }
      : s
  )),
  repickPoint: () => set((s) => (
    s.placement && s.placement.phase !== 'sending' ? { placement: { ...s.placement, phase: 'pick', error: undefined } } : s
  )),
  cancelPlacement: () => set({ placement: null, open: true }),
  markSending: (requestId) => set((s) => (
    s.placement?.phase === 'confirm' ? { placement: { ...s.placement, phase: 'sending', requestId, error: undefined } } : s
  )),
  resolvePlacement: (requestId, result) => {
    const placement = get().placement;
    if (!requestId || !placement || placement.phase !== 'sending' || placement.requestId !== requestId) return false;
    set({ placement: result.ok ? null : { ...placement, phase: 'confirm', requestId: undefined, error: result.message } });
    return true;
  },
  finishPlacement: () => set({ placement: null }),
  reset: () => set({ open: false, placement: null }),
}));
