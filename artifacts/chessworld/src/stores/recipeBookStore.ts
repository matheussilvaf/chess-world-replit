/**
 * Estado de UI do Livro de Receitas (botão de livro no HUD). Exclusivo com o
 * inventário e o painel de habilidades: abrir um fecha os outros — os três
 * dividem o Esc e a atenção do jogador.
 */
import { create } from 'zustand';
import { useInventoryUiStore } from './inventoryUiStore';
import { useProgressStore } from './progressStore';

interface RecipeBookState {
  open: boolean;
  /** Item cuja receita está aberta no detalhe (null = lista). */
  selectedId: string | null;
  openBook: () => void;
  closeBook: () => void;
  toggleBook: () => void;
  select: (itemId: string | null) => void;
}

export const useRecipeBookStore = create<RecipeBookState>((set, get) => ({
  open: false,
  selectedId: null,
  openBook: () => {
    if (get().open) return;
    useInventoryUiStore.getState().closeInventory();
    useProgressStore.getState().closeSkills();
    set({ open: true });
  },
  closeBook: () => set({ open: false }),
  toggleBook: () => (get().open ? get().closeBook() : get().openBook()),
  select: (itemId) => set({ selectedId: itemId }),
}));

// Abrir o inventário ou as habilidades fecha o livro.
useInventoryUiStore.subscribe((state, previous) => {
  if (state.open && !previous.open) useRecipeBookStore.getState().closeBook();
});
useProgressStore.subscribe((state, previous) => {
  if (state.skillsOpen && !previous.skillsOpen) useRecipeBookStore.getState().closeBook();
});
