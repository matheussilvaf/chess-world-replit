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
 *
 * Durabilidade: `queueToolWear(toolRef)` a cada golpe que conecta — a barra
 * desce na hora e os golpes vão em lote ao servidor, que é quem quebra a
 * ferramenta (qty − 1) e devolve o snapshot com o restante da próxima cópia.
 */
import { create } from 'zustand';
import { fetchInventory, postCollect, postToolWear, type InventoryItemDto, type ToolWearDto } from '../lib/collectionInventoryApi';
import type { RigApiError } from '../components/admin/rig-editor/rigApi';
import { useAuthStore } from './authStore';
import { usePlayerCharacterStore } from './playerCharacterStore';
import { loadCollectionWorldConfig } from '../game/config/collectionConfigLoader';
import { DEFAULT_INVENTORY_SLOTS, resolveInventorySlots } from '../shared/collection/CollectionShapes';
import { TOOL_WEAR_MAX_ENTRIES, TOOL_WEAR_MAX_HITS_PER_ENTRY, isToolItemKey } from '../shared/collection/ToolWear';
import { inventoryEntry, inventoryFallbackName, loadInventoryVisualCatalog } from '../lib/inventory/inventoryVisualCatalog';
import { hasDurabilityBar, loadToolMaxDurability } from '../lib/inventory/toolDurability';
import { notifyBeforeSlotsChange } from '../lib/inventory/slotChangeSignal';
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
  /** Ferramentas: durabilidade restante da cópia em uso (ausente = cheia). */
  durability: Record<string, number>;
  /** Ferramentas: durabilidade máxima configurada (resolvida sob demanda). */
  toolMax: Record<string, number>;
  /** Servidor sem a coluna `durability` (barras ocultas; SQL para o admin). */
  durabilityColumnMissing: boolean;
  durabilitySql: string | null;
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
  applyServerTotals: (items: InventoryItemDto[]) => void;
  /** Desconto otimista de 1 golpe na barra (o servidor confirma no snapshot). */
  wearLocal: (itemKey: string) => void;
  moveSlot: (from: number, to: number) => void;
  selectItem: (itemKey: string | null) => void;
  setCapacity: (capacity: number) => void;
  hydrateSlots: () => void;
  setInventoryError: (message: string | null) => void;
}

export const useCollectionInventoryStore = create<CollectionInventoryState>((set, get) => ({
  items: {},
  durability: {},
  toolMax: {},
  durabilityColumnMissing: false,
  durabilitySql: null,
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
        durability: durabilityFrom(res.items),
        slots,
        capacity,
        loaded: true,
        loading: false,
        tableMissing: !!res.tableMissing,
        tableSql: res.tableSql ?? null,
        durabilityColumnMissing: !!res.durabilityColumnMissing,
        durabilitySql: res.durabilitySql ?? null,
      });
      ensureToolMax(Object.keys(items));
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

  addLocal: (itemKey, qty) => {
    set((s) => {
      const items = { ...s.items, [itemKey]: Math.max(0, (s.items[itemKey] ?? 0) + qty) };
      const slots = reconcileSlots(s.slots, items, s.capacity);
      persistSlots(slots);
      return { items, slots };
    });
    ensureToolMax([itemKey]);
  },

  applyServerTotals: (items) => {
    set((s) => {
      const next: Record<string, number> = {};
      for (const it of items) if (it.qty > 0) next[it.itemKey] = it.qty;
      const slots = reconcileSlots(s.slots, next, s.capacity);
      persistSlots(slots);
      return {
        items: next,
        durability: durabilityFrom(items),
        slots,
        selectedItemKey: s.selectedItemKey && next[s.selectedItemKey] > 0 ? s.selectedItemKey : null,
      };
    });
    ensureToolMax(Object.keys(get().items));
  },

  wearLocal: (itemKey) =>
    set((s) => {
      if (!isToolItemKey(itemKey) || (s.items[itemKey] ?? 0) <= 0 || s.durabilityColumnMissing) return s;
      const max = s.toolMax[itemKey];
      const current = s.durability[itemKey] ?? max;
      if (typeof current !== 'number') return s; // máximo ainda não resolvido: espera o snapshot
      return { durability: { ...s.durability, [itemKey]: Math.max(0, current - 1) } };
    }),

  moveSlot: (from, to) => {
    const s = get();
    const slots = swapSlots(s.slots, from, to, s.capacity);
    if (slots === s.slots) return;
    // Quem anima a troca (FLIP) mede as posições atuais ANTES do DOM mudar.
    notifyBeforeSlotsChange();
    persistSlots(slots);
    set({ slots });
  },

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

/** Durabilidade restante por ferramenta a partir de um snapshot do servidor. */
function durabilityFrom(items: InventoryItemDto[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (it.qty > 0 && hasDurabilityBar(it.itemKey) && typeof it.durability === 'number') out[it.itemKey] = it.durability;
  }
  return out;
}

/** Resolve (uma vez por ref) a durabilidade máxima das ferramentas presentes. */
function ensureToolMax(itemKeys: string[]): void {
  for (const itemKey of itemKeys) {
    if (!hasDurabilityBar(itemKey) || itemKey in useCollectionInventoryStore.getState().toolMax) continue;
    void loadToolMaxDurability(itemKey).then((max) => {
      useCollectionInventoryStore.setState((s) => (s.toolMax[itemKey] === max ? s : { toolMax: { ...s.toolMax, [itemKey]: max } }));
    });
  }
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
    retryMs = RETRY_BASE_MS;
    // Trocou de conta enquanto o POST voava: o snapshot é da conta anterior.
    if (currentUserId() !== uid) return;
    useCollectionInventoryStore.getState().applyServerTotals(res.items);
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

// ------------------------ fila de desgaste (lote) ---------------------------
//
// Mesmo desenho da coleta (agrega golpes por ferramenta, um flush por vez,
// re-tenta em falha transitória, descarta em 4xx), com uma diferença: o lote
// enviado fica guardado com o seu `requestId` até o servidor confirmar, e a
// re-tentativa reenvia EXATAMENTE o mesmo lote/id — assim uma resposta perdida
// nunca cobra os golpes duas vezes (o servidor deduplica por conta+id). Golpes
// novos esperam na fila atrás do lote em voo.

interface WearBatch {
  requestId: string;
  userId: string | null;
  wear: ToolWearDto[];
}

let pendingWear = new Map<string, number>();
let pendingWearUserId: string | null = null;
let wearTimer: ReturnType<typeof setTimeout> | null = null;
let wearInFlight = false;
let wearRetryMs = RETRY_BASE_MS;
/** Lote enviado e ainda não confirmado (re-tentado com o mesmo requestId). */
let unconfirmedWear: WearBatch | null = null;

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Chamado pelo runtime do mapa a cada golpe de FERRAMENTA que conecta (fora do React). */
export function queueToolWear(toolRef: string): void {
  if (!isToolItemKey(toolRef)) return;
  const store = useCollectionInventoryStore.getState();
  if (store.durabilityColumnMissing) return; // servidor sem durabilidade: nada a registrar
  const uid = currentUserId();
  if (pendingWear.size > 0 && pendingWearUserId !== uid) pendingWear = new Map();
  pendingWearUserId = uid;
  store.wearLocal(toolRef);
  pendingWear.set(toolRef, (pendingWear.get(toolRef) ?? 0) + 1);
  scheduleWearFlush(FLUSH_MS);
}

function scheduleWearFlush(delayMs: number): void {
  if (wearTimer || wearInFlight) return;
  wearTimer = setTimeout(() => {
    wearTimer = null;
    void flushWear();
  }, delayMs);
}

/** Servidor sem suporte (coluna ausente ou rota inexistente): barras somem e a fila para. */
function disableDurability(sql: string | null): void {
  useCollectionInventoryStore.setState({ durabilityColumnMissing: true, durabilitySql: sql, durability: {} });
  pendingWear = new Map();
  unconfirmedWear = null;
}

/** Tira da fila o próximo lote (limites do servidor: 999 golpes por entrada, 40 entradas). */
function takeWearBatch(): ToolWearDto[] {
  const batch: ToolWearDto[] = [];
  for (const [itemKey, total] of pendingWear) {
    for (let h = total; h > 0 && batch.length < TOOL_WEAR_MAX_ENTRIES; h -= TOOL_WEAR_MAX_HITS_PER_ENTRY) {
      batch.push({ itemKey, hits: Math.min(TOOL_WEAR_MAX_HITS_PER_ENTRY, h) });
    }
    if (batch.length >= TOOL_WEAR_MAX_ENTRIES) break;
  }
  for (const { itemKey, hits } of batch) {
    const left = (pendingWear.get(itemKey) ?? 0) - hits;
    if (left > 0) pendingWear.set(itemKey, left);
    else pendingWear.delete(itemKey);
  }
  return batch;
}

async function flushWear(): Promise<void> {
  if (wearInFlight) return;
  const uid = currentUserId();
  // Lote de outra conta (trocou de usuário com envio pendente): morre com a sessão.
  if (unconfirmedWear && unconfirmedWear.userId !== uid) unconfirmedWear = null;
  if (!unconfirmedWear) {
    if (pendingWear.size === 0) return;
    if (uid !== pendingWearUserId) {
      pendingWear = new Map();
      pendingWearUserId = uid;
      return;
    }
    unconfirmedWear = { requestId: newRequestId(), userId: uid, wear: takeWearBatch() };
  }
  const batch = unconfirmedWear;
  wearInFlight = true;
  try {
    const res = await postToolWear(batch.wear, batch.requestId);
    unconfirmedWear = null;
    wearRetryMs = RETRY_BASE_MS;
    // Trocou de conta enquanto o POST voava: snapshot e quebras são da conta anterior.
    if (currentUserId() !== batch.userId) return;
    useCollectionInventoryStore.getState().applyServerTotals(res.items);
    if (res.durabilityColumnMissing) disableDurability(res.durabilitySql ?? null);
    void announceBrokenTools(res.broken ?? [], res.items);
  } catch (e) {
    const err = e as RigApiError & { tableSql?: string; durabilitySql?: string };
    if (err.status === 503 && err.durabilitySql) {
      // Coluna ausente: para de contar até o admin migrar (o próximo refresh re-liga).
      disableDurability(err.durabilitySql);
      return;
    }
    if (err.status === 404) {
      // Servidor antigo sem a rota (deploy pendente): não insistir nem poluir o console.
      console.warn('[Inventário] Servidor sem durabilidade de ferramentas ainda:', err.message);
      disableDurability(null);
      return;
    }
    if (err.status === 503) {
      useCollectionInventoryStore.setState({ tableMissing: true, tableSql: err.tableSql ?? null });
    }
    if (err.status === 0 || err.status >= 500) {
      // Falha transitória: o lote continua em `unconfirmedWear` e volta com o mesmo id.
      console.warn(`[Inventário] Desgaste ainda não salvo (${err.message}); nova tentativa em ${Math.round(wearRetryMs / 1000)}s.`);
      wearInFlight = false;
      scheduleWearFlush(wearRetryMs);
      wearRetryMs = Math.min(wearRetryMs * 2, RETRY_MAX_MS);
      return; // o finally abaixo não re-agenda: o timer de retry já está marcado
    }
    // 4xx (sem sessão / payload inválido): não insistir — descarta este lote.
    console.warn('[Inventário] Desgaste descartado pelo servidor:', err.message);
    unconfirmedWear = null;
  } finally {
    wearInFlight = false;
    if (unconfirmedWear || pendingWear.size > 0) scheduleWearFlush(FLUSH_MS);
  }
}

/** Aviso de quebra na hotbar + desequipa se a última cópia se foi. */
async function announceBrokenTools(broken: Array<{ itemKey: string; count: number }>, items: InventoryItemDto[]): Promise<void> {
  if (broken.length === 0) return;
  const gone = new Set(broken.filter((b) => !items.some((it) => it.itemKey === b.itemKey && it.qty > 0)).map((b) => b.itemKey));
  // A última cópia quebrou com ela equipada: o servidor ainda a considera em uso.
  const character = usePlayerCharacterStore.getState();
  if (character.liveWeapon && gone.has(character.liveWeapon)) character.equipSender?.(false);

  const catalog = await loadInventoryVisualCatalog().catch(() => null);
  const nameOf = (itemKey: string) => inventoryEntry(catalog, itemKey)?.name ?? inventoryFallbackName(itemKey);
  const message =
    broken.length === 1
      ? gone.has(broken[0].itemKey)
        ? `${nameOf(broken[0].itemKey)} quebrou — era a última cópia.`
        : `${nameOf(broken[0].itemKey)} quebrou — você pegou outra cópia da bolsa.`
      : `Ferramentas quebraram: ${broken.map((b) => nameOf(b.itemKey)).join(', ')}.`;
  useCollectionInventoryStore.getState().setInventoryError(message);
}
