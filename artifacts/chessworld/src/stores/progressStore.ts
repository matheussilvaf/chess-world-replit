/**
 * Energia + habilidades do jogador no cliente.
 *
 * O servidor é a fonte da verdade: a sala empurra `progress_update` (a cada
 * mudança) e o HTTP `/api/progress/me` cobre o carregamento fora da sala.
 * O runtime do mapa reporta o que só ele enxerga — golpes de ferramenta,
 * golpes em animal e nós quebrados — com `queueActivity(...)`: agregado num
 * lote e enviado com `requestId` (re-tentativa idempotente), mesmo desenho
 * da fila de desgaste de ferramentas.
 *
 * A config pública (limiares, velocidade fraco, comidas) é carregada uma vez
 * para o HUD saber as cores/mensagens antes do 1º snapshot.
 */
import { create } from 'zustand';
import type { RigApiError } from '../components/admin/rig-editor/rigApi';
import { fetchMyProgress, fetchPublicEnergySkillsConfig, postActivity } from '../lib/progressApi';
import {
  ACTIVITY_MAX_COUNT,
  ACTIVITY_MAX_ENTRIES,
  DEFAULT_ENERGY_SKILLS_CONFIG,
  SKILL_LABELS,
  type ActivityEvent,
  type ActivityKind,
  type EnergySkillsConfig,
  type ProgressSnapshot,
  type SkillId,
} from '../shared/progress/EnergySkillsShapes';
import { useAuthStore } from './authStore';

export interface XpGainTick {
  id: number;
  skill: SkillId;
  label: string;
  xp: number;
  /** Nível alcançado nesta atualização (quando subiu). */
  levelUp: number | null;
}

interface ProgressState {
  snapshot: ProgressSnapshot | null;
  config: EnergySkillsConfig;
  configLoaded: boolean;
  /** Item sendo comido no momento (itemKey) — o slot mostra o loader. */
  eatingKey: string | null;
  ticks: XpGainTick[];
  /** Aviso curto do HUD (ex.: "Fraco demais para usar a picareta"). */
  notice: string | null;
  applySnapshot: (snapshot: ProgressSnapshot) => void;
  setEating: (itemKey: string | null) => void;
  setNotice: (notice: string | null) => void;
  dismissTick: (id: number) => void;
  reset: () => void;
}

let tickSeq = 0;
const TICK_TTL_MS = 2_600;
const NOTICE_TTL_MS = 2_200;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export const useProgressStore = create<ProgressState>((set, get) => ({
  snapshot: null,
  config: DEFAULT_ENERGY_SKILLS_CONFIG,
  configLoaded: false,
  eatingKey: null,
  ticks: [],
  notice: null,
  applySnapshot: (snapshot) => {
    const previous = get().snapshot;
    const ticks = [...get().ticks];
    for (const gain of snapshot.gains ?? []) {
      const before = previous?.skills[gain.skill]?.level ?? 1;
      const after = snapshot.skills[gain.skill]?.level ?? 1;
      const tick: XpGainTick = { id: ++tickSeq, skill: gain.skill, label: SKILL_LABELS[gain.skill], xp: gain.xp, levelUp: after > before ? after : null };
      ticks.push(tick);
      setTimeout(() => get().dismissTick(tick.id), TICK_TTL_MS);
    }
    set({ snapshot, ticks: ticks.slice(-6) });
  },
  setEating: (eatingKey) => set({ eatingKey }),
  setNotice: (notice) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    set({ notice });
    if (notice) {
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        set({ notice: null });
      }, NOTICE_TTL_MS);
    }
  },
  dismissTick: (id) => set((s) => ({ ticks: s.ticks.filter((t) => t.id !== id) })),
  reset: () => {
    pendingActivity = new Map();
    unconfirmed = null;
    set({ snapshot: null, eatingKey: null, ticks: [], notice: null });
  },
}));

// ------------------------------------------------------------ carregamento

let configPromise: Promise<void> | null = null;

/** Config pública (idempotente; erro só loga — os defaults servem ao HUD). */
export function ensureProgressConfig(): Promise<void> {
  if (!configPromise) {
    configPromise = fetchPublicEnergySkillsConfig()
      .then((config) => useProgressStore.setState({ config, configLoaded: true }))
      .catch((e) => {
        console.warn('[Progresso] Config de energia/skills indisponível:', e instanceof Error ? e.message : e);
        configPromise = null;
      });
  }
  return configPromise;
}

/** Snapshot via HTTP (fora da sala, ex.: aba Habilidades das configurações). */
export async function refreshMyProgress(): Promise<void> {
  if (!currentUserId()) return;
  try {
    useProgressStore.getState().applySnapshot(await fetchMyProgress());
  } catch (e) {
    console.warn('[Progresso] Não foi possível carregar o progresso:', e instanceof Error ? e.message : e);
  }
}

// ----------------------------------------------------------- fila de eventos

const FLUSH_MS = 800;
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60000;

interface ActivityBatch { requestId: string; userId: string | null; events: ActivityEvent[]; }

/** `${kind}|${key}` → contagem pendente. */
let pendingActivity = new Map<string, number>();
let pendingUserId: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let retryMs = RETRY_BASE_MS;
let unconfirmed: ActivityBatch | null = null;
let disabled = false;

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Chamado pelo runtime do mapa (fora do React). Sem sessão, nada é enviado. */
export function queueActivity(kind: ActivityKind, key: string, count = 1): void {
  if (disabled || count <= 0) return;
  const uid = currentUserId();
  if (!uid) return;
  if (pendingActivity.size > 0 && pendingUserId !== uid) pendingActivity = new Map();
  pendingUserId = uid;
  const mapKey = `${kind}|${key}`;
  pendingActivity.set(mapKey, (pendingActivity.get(mapKey) ?? 0) + count);
  scheduleFlush(FLUSH_MS);
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer || inFlight) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delayMs);
}

function takeBatch(): ActivityEvent[] {
  const batch: ActivityEvent[] = [];
  for (const [mapKey, total] of pendingActivity) {
    const [kind, key] = mapKey.split('|') as [ActivityKind, string];
    for (let n = total; n > 0 && batch.length < ACTIVITY_MAX_ENTRIES; n -= ACTIVITY_MAX_COUNT) {
      batch.push({ kind, key, count: Math.min(ACTIVITY_MAX_COUNT, n) });
    }
    if (batch.length >= ACTIVITY_MAX_ENTRIES) break;
  }
  for (const { kind, key, count } of batch) {
    const mapKey = `${kind}|${key}`;
    const left = (pendingActivity.get(mapKey) ?? 0) - count;
    if (left > 0) pendingActivity.set(mapKey, left);
    else pendingActivity.delete(mapKey);
  }
  return batch;
}

async function flush(): Promise<void> {
  if (inFlight) return;
  const uid = currentUserId();
  if (unconfirmed && unconfirmed.userId !== uid) unconfirmed = null;
  if (!unconfirmed) {
    if (pendingActivity.size === 0) return;
    if (uid !== pendingUserId) {
      pendingActivity = new Map();
      pendingUserId = uid;
      return;
    }
    unconfirmed = { requestId: newRequestId(), userId: uid, events: takeBatch() };
  }
  const batch = unconfirmed;
  inFlight = true;
  try {
    const snapshot = await postActivity(batch.events, batch.requestId);
    unconfirmed = null;
    retryMs = RETRY_BASE_MS;
    if (currentUserId() !== batch.userId) return;
    useProgressStore.getState().applySnapshot(snapshot);
  } catch (e) {
    const err = e as RigApiError;
    if (err.status === 404) {
      console.warn('[Progresso] Servidor sem energia/habilidades ainda (deploy pendente):', err.message);
      disabled = true;
      unconfirmed = null;
      pendingActivity = new Map();
      return;
    }
    if (err.status === 0 || err.status >= 500) {
      console.warn(`[Progresso] Atividade ainda não salva (${err.message}); nova tentativa em ${Math.round(retryMs / 1000)}s.`);
      inFlight = false;
      scheduleFlush(retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      return;
    }
    console.warn('[Progresso] Lote de atividade descartado pelo servidor:', err.message);
    unconfirmed = null;
  } finally {
    inFlight = false;
    if (unconfirmed || pendingActivity.size > 0) scheduleFlush(FLUSH_MS);
  }
}

// ------------------------------------------------------------- utilidades

/** Está fraco (condição "weak" ativa)? Sem snapshot = não. */
export function isPlayerWeak(): boolean {
  return useProgressStore.getState().snapshot?.state.weak ?? false;
}
