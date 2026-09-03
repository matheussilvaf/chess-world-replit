/**
 * Estado do inventário de coleta + fila de envio.
 *
 * O runtime Phaser chama `queueCollect(itemKey)` a cada item coletado no
 * Mundo de Coleta: o total local sobe na hora (UI otimista) e as coletas são
 * agregadas num lote enviado ao servidor após um curto debounce — um flush
 * por vez, para os totais lidos+gravados no servidor não se atropelarem.
 *
 * Grade: `capacity` slots (vem do admin — Mundo de Coleta → Inventário) em
 * INVENTORY_COLUMNS colunas. A última linha é o acesso rápido; o primeiro
 * slot dela é RESERVADO à arma da classe (nunca recebe item). A arrumação
 * dos slots é local (localStorage por usuário); as quantidades são do servidor.
 */
import { create } from 'zustand';
import { fetchInventory, postCollect } from '../lib/collectionInventoryApi';
import type { RigApiError } from '../components/admin/rig-editor/rigApi';
import { useAuthStore } from './authStore';
import { loadCollectionWorldConfig } from '../game/config/collectionConfigLoader';
import { DEFAULT_INVENTORY_SLOTS, resolveInventorySlots } from '../shared/collection/CollectionShapes';
import {
  countUnslottedItems as countUnslotted,
  emptySlots,
  reconcileSlots,
  sanitizeSlots,
  swapSlots,
  weaponSlotIndex,
} from '../lib/inventory/inventorySlots';

export { weaponSlotIndex };

const storageKey = (userId: string) => `chessworld:collection-inventory-slots:${userId}`;

function loadSlots(userId: string | null, capacity: number): Array<string | null> {
  if (!userId) return emptySlots(capacity);
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return sanitizeSlots(raw ? JSON.parse(raw) : null, capacity);
  } catch {
    return emptySlots(capacity);
  }
}

function persistSlots(slots: Array<string | null>) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  try { localStorage.setItem(storageKey(userId), JSON.stringify(slots)); } catch { /* unavailable */ }
}

interface CollectionInventoryState {
  /** itemKey → quantidade total. */
  items: Record<string, number>;
  /** Grade fixa e ordenada; null = slot vazio. `slots[weaponSlotIndex(capacity)]` é sempre null. */
  slots: Array<string | null>;
  /** Total de slots (admin). */
  capacity: number;
  selectedItemKey: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  tableMissing: boolean;
  tableSql: string | null;
  refresh: () => Promise<void>;
  /** Carrega uma única vez (hotbar/painel chamam ao montar). */
  ensureLoaded: () => void;
  addLocal: (itemKey: string, qty: number) => void;
  applyServerTotals: (items: Array<{ itemKey: string; qty: number }>) => void;
  moveSlot: (from: number, to: number) => void;
  selectItem: (itemKey: string | null) => void;
  setCapacity: (capacity: number) => void;
  hydrateSlots: () => void;
  setInventoryError: (message: string | null) => void;
}

export const useCollectionInventoryStore = create<CollectionInventoryState>((set, get) => ({
  items: {},
  slots: emptySlots(DEFAULT_INVENTORY_SLOTS),
  capacity: DEFAULT_INVENTORY_SLOTS,
  selectedItemKey: null,
  loaded: false,
  loading: false,
  error: null,
  tableMissing: false,
  tableSql: null,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [res, config] = await Promise.all([fetchInventory(), loadCollectionWorldConfig()]);
      const capacity = resolveInventorySlots(config);
      const items: Record<string, number> = {};
      for (const it of res.items) items[it.itemKey] = it.qty;
      const slots = reconcileSlots(loadSlots(useAuthStore.getState().user?.id ?? null, capacity), items, capacity);
      persistSlots(slots);
      set({
        items,
        slots,
        capacity,
        loaded: true,
        loading: false,
        tableMissing: !!res.tableMissing,
        tableSql: res.tableSql ?? null,
      });
    } catch (e) {
      const err = e as RigApiError & { tableSql?: string };
      set({
        loading: false,
        error: err.message ?? 'Falha ao carregar inventário',
        tableMissing: err.status === 503,
        tableSql: err.tableSql ?? null,
      });
    }
  },

  ensureLoaded: () => {
    const s = get();
    if (!s.loaded && !s.loading) void s.refresh();
  },

  addLocal: (itemKey, qty) =>
    set((s) => {
      const items = { ...s.items, [itemKey]: Math.max(0, (s.items[itemKey] ?? 0) + qty) };
      const slots = reconcileSlots(s.slots, items, s.capacity);
      persistSlots(slots);
      return { items, slots };
    }),

  applyServerTotals: (items) =>
    set((s) => {
      const next: Record<string, number> = {};
      for (const it of items) if (it.qty > 0) next[it.itemKey] = it.qty;
      const slots = reconcileSlots(s.slots, next, s.capacity);
      persistSlots(slots);
      return {
        items: next,
        slots,
        selectedItemKey: s.selectedItemKey && next[s.selectedItemKey] > 0 ? s.selectedItemKey : null,
      };
    }),

  moveSlot: (from, to) => set((s) => {
    const slots = swapSlots(s.slots, from, to, s.capacity);
    if (slots === s.slots) return s;
    persistSlots(slots);
    return { slots };
  }),

  selectItem: (selectedItemKey) => set({ selectedItemKey }),

  setCapacity: (capacity) => set((s) => {
    if (capacity === s.capacity) return s;
    const slots = reconcileSlots(s.slots, s.items, capacity);
    persistSlots(slots);
    return { capacity, slots };
  }),

  hydrateSlots: () => set((s) => ({
    slots: reconcileSlots(loadSlots(useAuthStore.getState().user?.id ?? null, s.capacity), s.items, s.capacity),
  })),
  setInventoryError: (error) => set({ error }),
}));

/** Quantos itens (com saldo) não couberam em nenhum slot. */
export function countUnslottedItems(state: Pick<CollectionInventoryState, 'items' | 'slots'>): number {
  return countUnslotted(state.items, state.slots);
}

// --------------------------- fila de coleta (lote) ---------------------------

const FLUSH_MS = 600;
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60000;
const MAX_QTY_PER_ENTRY = 99; // limite do servidor por entrada
const MAX_ENTRIES_PER_POST = 40; // limite do servidor por lote

let pending = new Map<string, number>();
/** Dono da fila — coletas nunca são enviadas com o JWT de outra conta. */
let pendingUserId: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let retryMs = RETRY_BASE_MS;

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

/** Chamado pelo runtime do mapa a cada item coletado (fora do React). */
export function queueCollect(itemKey: string, qty = 1): void {
  const uid = currentUserId();
  if (pending.size > 0 && pendingUserId !== uid) {
    // Trocou de conta com fila pendente: descarta o resto da sessão anterior.
    pending = new Map();
  }
  pendingUserId = uid;
  useCollectionInventoryStore.getState().addLocal(itemKey, qty);
  pending.set(itemKey, (pending.get(itemKey) ?? 0) + qty);
  scheduleFlush(FLUSH_MS);
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer || inFlight) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, delayMs);
}

async function flushPending(): Promise<void> {
  if (inFlight || pending.size === 0) return;
  const uid = currentUserId();
  if (uid !== pendingUserId) {
    // Conta mudou entre a coleta e o envio: nunca postar na identidade errada.
    pending = new Map();
    pendingUserId = uid;
    return;
  }
  inFlight = true;
  // Fatia o lote respeitando os limites do servidor (99 por entrada, 40 entradas).
  const batch: Array<{ itemKey: string; qty: number }> = [];
  for (const [itemKey, total] of pending) {
    for (let q = total; q > 0 && batch.length < MAX_ENTRIES_PER_POST; q -= MAX_QTY_PER_ENTRY) {
      batch.push({ itemKey, qty: Math.min(MAX_QTY_PER_ENTRY, q) });
    }
    if (batch.length >= MAX_ENTRIES_PER_POST) break;
  }
  // Tira da fila só o que entrou no lote; o resto fica para o próximo flush.
  for (const { itemKey, qty } of batch) {
    const left = (pending.get(itemKey) ?? 0) - qty;
    if (left > 0) pending.set(itemKey, left);
    else pending.delete(itemKey);
  }
  try {
    const res = await postCollect(batch);
    useCollectionInventoryStore.getState().applyServerTotals(res.items);
    retryMs = RETRY_BASE_MS;
  } catch (e) {
    const err = e as RigApiError & { tableSql?: string };
    if (err.status === 503) {
      useCollectionInventoryStore.setState({ tableMissing: true, tableSql: err.tableSql ?? null });
    }
    if (err.status === 0 || err.status >= 500) {
      // Falha transitória (rede/5xx/tabela ausente): devolve o lote à fila e re-tenta com backoff.
      for (const { itemKey, qty } of batch) {
        pending.set(itemKey, (pending.get(itemKey) ?? 0) + qty);
      }
      console.warn(
        `[Inventário] Coleta ainda não salva (${err.message}); nova tentativa em ${Math.round(retryMs / 1000)}s.`,
      );
      inFlight = false;
      scheduleFlush(retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      return; // o finally abaixo não re-agenda: o timer de retry já está marcado
    }
    // 4xx (sem sessão / payload inválido): não insistir — descarta este lote.
    console.warn('[Inventário] Coleta descartada pelo servidor:', err.message);
  } finally {
    inFlight = false;
    if (pending.size > 0) scheduleFlush(FLUSH_MS);
  }
}
