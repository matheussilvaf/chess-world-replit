/**
 * ProgressService — energia e habilidades de cada jogador, em processo.
 *
 * Um estado por usuário (carregado do `player_progress` na 1ª consulta),
 * mutações SERIALIZADAS por usuário (fila de promessas), gravação write-
 * through com debounce curto e flush ao sair. Quem quiser ser avisado das
 * mudanças (a WorldRoom, para empurrar `progress_update` ao cliente e matar
 * de fome) assina com `subscribe(userId, listener)`.
 *
 * Toda regra de custo/XP lê a config efetiva (admin → cache 30 s) na hora da
 * mutação; a energia nunca bloqueia ação nenhuma — só desce até 0 (a condição
 * "morrer" cuida do resto).
 */
import { applyInventoryDeltas, getInventory, type InventoryItem } from '../collection/inventoryRepository.js';
import { getCraftBadgesCached } from '../craft/craftBadgeRepository.js';
import { BADGE_FOOD, BADGE_FORGING, BADGE_SMELTING, isEdibleItem, itemHasBadge } from '../shared/craft/CraftBadges.js';
import { placeableStationFor } from '../shared/craft/PlaceableStations.js';
import { isStationId } from '../shared/craft/StationShapes.js';
import {
  DEFAULT_CRAFT_XP,
  DEFAULT_COOKING_XP,
  DEFAULT_NODE_XP,
  ENERGY_TOOL_KINDS,
  SKILL_IDS,
  evaluateEnergyState,
  skillProgressFromXp,
  type ActivityEvent,
  type ActivityKind,
  type EnergySkillsConfig,
  type EnergyToolKind,
  type FightingXp,
  type ProgressSnapshot,
  type SkillId,
  type SkillProgress,
} from '../shared/progress/EnergySkillsShapes.js';
import { getEnergySkillsConfigCached } from './energySkillsRepository.js';
import {
  getPlayerProgress,
  isPersistableUserId,
  savePlayerProgress,
  type PlayerProgressRecord,
} from './playerProgressRepository.js';

export type ProgressListener = (snapshot: ProgressSnapshot) => void;

const SAVE_DEBOUNCE_MS = 1_500;
const IDLE_EVICT_MS = 10 * 60_000;

/**
 * Teto de plausibilidade dos eventos reportados pelo cliente, por jogador e
 * por janela deslizante de 60 s. O mapa de coleta roda no cliente (como o
 * /collect), então o servidor não enxerga cada golpe — mas limita a TAXA:
 * o cooldown de ataque dá ~2 golpes/s e um nó leva vários golpes, logo
 * nada legítimo passa disto; o excesso é descartado (não é erro).
 */
const ACTIVITY_WINDOW_MS = 60_000;
const ACTIVITY_CAPS: Record<ActivityKind, number> = {
  tool_strike: 240,
  creature_strike: 240,
  node_broken: 60,
};

interface PlayerProgressState {
  userId: string;
  record: PlayerProgressRecord;
  loaded: boolean;
  /** false = tabela ausente (só memória). */
  persisted: boolean;
  dirty: boolean;
  queue: Promise<unknown>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<ProgressListener>;
  lastTouched: number;
  /** Janela deslizante de eventos aceitos por tipo (só memória; anti-farm). */
  activityWindow: Record<ActivityKind, { since: number; count: number }>;
  /**
   * `seq` do último snapshot construído. Só memória, ancorado no relógio
   * (nunca menor que Date.now()): depois de um restart o processo novo parte
   * do relógio atual, acima de tudo que o anterior emitiu — o cliente guarda
   * o último `seq` visto e descarta os menores. Só relógio atrasado no
   * servidor novo prende o cliente, e apenas pelo tamanho do atraso.
   */
  seq: number;
}

export interface CraftProgressInfo {
  stationId: string;
  targetId: string;
  /** Execuções da receita (o "quantity" do craft). */
  quantity: number;
}

export type EatResult =
  | { ok: true; eaten: number; items: InventoryItem[]; snapshot: ProgressSnapshot }
  | { ok: false; message: string };

type Gains = Array<{ skill: SkillId; xp: number }>;

class ProgressService {
  private readonly states = new Map<string, PlayerProgressState>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  // ------------------------------------------------------------ assinatura

  /** Avisa `listener` a cada mudança (e uma vez logo após carregar). Devolve o cancelamento. */
  subscribe(userId: string, listener: ProgressListener): () => void {
    const state = this.stateFor(userId);
    state.listeners.add(listener);
    void this.run(state, async () => {
      const config = await this.ensureLoaded(state);
      listener(this.snapshot(state, config, []));
    });
    return () => {
      state.listeners.delete(listener);
      if (state.listeners.size === 0) void this.flush(state);
    };
  }

  async getSnapshot(userId: string): Promise<ProgressSnapshot> {
    const state = this.stateFor(userId);
    return this.run(state, async () => this.snapshot(state, await this.ensureLoaded(state), []));
  }

  // -------------------------------------------------------------- mutações

  /** Eventos reportados pelo cliente (golpes de ferramenta, golpes em animal, nós quebrados). */
  applyActivity(userId: string, events: ActivityEvent[]): Promise<ProgressSnapshot> {
    return this.mutate(userId, (state, config, gains) => {
      const { energy, skills } = config;
      let dropped = 0;
      for (const event of events) {
        const count = this.admitActivity(state, event.kind, event.count);
        dropped += event.count - count;
        if (count <= 0) continue;
        if (event.kind === 'tool_strike') {
          const kind = event.key as EnergyToolKind;
          if (!(ENERGY_TOOL_KINDS as readonly string[]).includes(kind)) continue;
          this.chargeEvery(state, `tool:${kind}`, energy.toolStrike[kind], count);
        } else if (event.kind === 'creature_strike') {
          this.chargeEvery(state, 'creature', energy.creatureStrike, count);
        } else if (event.kind === 'node_broken') {
          if (event.key.startsWith('mineral:')) {
            this.addXp(state, gains, 'mining', (skills.mining[event.key] ?? DEFAULT_NODE_XP) * count);
          } else if (event.key.startsWith('tree:')) {
            this.addXp(state, gains, 'woodcutting', (skills.woodcutting[event.key] ?? DEFAULT_NODE_XP) * count);
          }
        }
      }
      if (dropped > 0) console.warn(`[progress] ${userId}: ${dropped} evento(s) acima do teto por minuto descartado(s)`);
    });
  }

  /** Quantos dos `count` eventos ainda cabem na janela de 60 s deste tipo. */
  private admitActivity(state: PlayerProgressState, kind: ActivityKind, count: number): number {
    const now = Date.now();
    const window = state.activityWindow[kind];
    if (now - window.since >= ACTIVITY_WINDOW_MS) {
      window.since = now;
      window.count = 0;
    }
    const admitted = Math.max(0, Math.min(count, ACTIVITY_CAPS[kind] - window.count));
    window.count += admitted;
    return admitted;
  }

  /** Craft concluído (estação pública ou portátil): energia por estação + construir estação + XP por badge. */
  async recordCraft(userId: string, info: CraftProgressInfo): Promise<void> {
    const badges = await getCraftBadgesCached();
    await this.mutate(userId, (state, config, gains) => {
      const { energy, skills } = config;
      const quantity = Math.max(1, info.quantity);
      if (isStationId(info.stationId)) this.spend(state, config, energy.craftByStation[info.stationId] * quantity);
      if (placeableStationFor(info.targetId)) this.spend(state, config, energy.buildStation * quantity);
      if (itemHasBadge(badges, info.targetId, BADGE_FORGING)) {
        this.addXp(state, gains, 'forging', (skills.forging[info.targetId] ?? DEFAULT_CRAFT_XP) * quantity);
      }
      if (itemHasBadge(badges, info.targetId, BADGE_SMELTING)) {
        this.addXp(state, gains, 'smelting', (skills.smelting[info.targetId] ?? DEFAULT_CRAFT_XP) * quantity);
      }
      // Culinária: qualquer item com a badge `food` (prato ou ingrediente), em qualquer estação.
      if (itemHasBadge(badges, info.targetId, BADGE_FOOD)) {
        this.addXp(state, gains, 'cooking', (skills.cooking.items[info.targetId] ?? DEFAULT_COOKING_XP) * quantity);
      }
    });
  }

  /** Golpe de arma/mão que acertou outra criatura (atacante). */
  recordCreatureHit(userId: string): Promise<ProgressSnapshot> {
    return this.mutate(userId, (state, config) => this.chargeEvery(state, 'creature', config.energy.creatureStrike, 1));
  }

  /** Levou dano de qualquer criatura. */
  recordDamageTaken(userId: string): Promise<ProgressSnapshot> {
    return this.mutate(userId, (state, config) => this.spend(state, config, config.energy.damageTaken));
  }

  /** Resultado de luta: XP de combate. */
  recordFightResult(userId: string, result: keyof FightingXp): Promise<ProgressSnapshot> {
    return this.mutate(userId, (state, config, gains) => this.addXp(state, gains, 'fighting', config.skills.fighting[result]));
  }

  /** Itens coletados do chão: os com badge `food` dão XP de culinária. */
  async recordPickup(userId: string, items: InventoryItem[]): Promise<void> {
    const badges = await getCraftBadgesCached();
    const foods = items.filter((item) => item.qty > 0 && itemHasBadge(badges, item.itemKey, BADGE_FOOD));
    if (foods.length === 0) return;
    await this.mutate(userId, (state, config, gains) => {
      for (const item of foods) {
        this.addXp(state, gains, 'cooking', (config.skills.cooking.items[item.itemKey] ?? DEFAULT_COOKING_XP) * item.qty);
      }
    });
  }

  /** Reviveu: energia volta ao máximo. */
  restoreEnergy(userId: string): Promise<ProgressSnapshot> {
    return this.mutate(userId, (state, config) => {
      state.record.energy = config.energy.maxEnergy;
    });
  }

  /**
   * Comer: consome do inventário só o necessário para encher a energia
   * (nunca desperdiça), credita a energia e o XP de culinária.
   */
  async eat(userId: string, itemKey: string): Promise<EatResult> {
    const badges = await getCraftBadgesCached();
    // `edible` decide; `food` sozinha é ingrediente (vira comida numa receita).
    if (!isEdibleItem(badges, itemKey)) {
      return {
        ok: false,
        message: itemHasBadge(badges, itemKey, BADGE_FOOD) ? 'Este item é um ingrediente — não dá para comer' : 'Este item não é comestível',
      };
    }
    const state = this.stateFor(userId);
    return this.run(state, async (): Promise<EatResult> => {
      const config = await this.ensureLoaded(state);
      const perUnit = config.energy.foods[itemKey] ?? 0;
      if (perUnit <= 0) return { ok: false, message: 'Este alimento ainda não tem energia configurada' };
      const missing = config.energy.maxEnergy - this.clampEnergy(state, config);
      if (missing <= 0) return { ok: false, message: 'Você não está com fome' };
      const inventory = await getInventory(userId);
      if (inventory.error || inventory.tableMissing) return { ok: false, message: inventory.error ?? 'Inventário indisponível' };
      const owned = inventory.items.find((item) => item.itemKey === itemKey)?.qty ?? 0;
      if (owned <= 0) return { ok: false, message: 'Você não tem esse alimento' };
      const eaten = Math.min(owned, Math.ceil(missing / perUnit));
      const changed = await applyInventoryDeltas(userId, [{ itemKey, qty: -eaten }]);
      if (!changed.ok) return { ok: false, message: changed.error ?? 'Falha no inventário' };
      const gains: Gains = [];
      state.record.energy = Math.min(config.energy.maxEnergy, state.record.energy + eaten * perUnit);
      this.addXp(state, gains, 'cooking', config.skills.cooking.eat);
      this.touch(state);
      const snapshot = this.snapshot(state, config, gains);
      this.notify(state, snapshot);
      const after = await getInventory(userId);
      return { ok: true, eaten, items: after.items, snapshot };
    });
  }

  // ------------------------------------------------------------- internos

  private stateFor(userId: string): PlayerProgressState {
    let state = this.states.get(userId);
    if (!state) {
      state = {
        userId,
        record: { energy: 0, skills: {}, counters: {} },
        loaded: false,
        persisted: true,
        dirty: false,
        queue: Promise.resolve(),
        saveTimer: null,
        listeners: new Set(),
        lastTouched: Date.now(),
        activityWindow: {
          tool_strike: { since: 0, count: 0 },
          creature_strike: { since: 0, count: 0 },
          node_broken: { since: 0, count: 0 },
        },
        seq: Date.now(),
      };
      this.states.set(userId, state);
      this.ensureSweep();
    }
    state.lastTouched = Date.now();
    return state;
  }

  /** Fila por usuário: uma mutação (ou leitura) de cada vez. */
  private run<T>(state: PlayerProgressState, task: () => Promise<T>): Promise<T> {
    const next = state.queue.then(task, task);
    state.queue = next.catch(() => undefined);
    return next;
  }

  private async ensureLoaded(state: PlayerProgressState): Promise<EnergySkillsConfig> {
    const config = await getEnergySkillsConfigCached();
    if (state.loaded) return config;
    if (!isPersistableUserId(state.userId)) {
      state.persisted = false;
      state.record.energy = config.energy.maxEnergy;
      state.loaded = true;
      return config;
    }
    try {
      const result = await getPlayerProgress(state.userId);
      if (result.tableMissing) state.persisted = false;
      if (result.error) console.warn(`[progress] load de ${state.userId} falhou: ${result.error}`);
      state.record = result.record ?? { energy: config.energy.maxEnergy, skills: {}, counters: {} };
    } catch (error) {
      console.warn(`[progress] load de ${state.userId} falhou: ${error instanceof Error ? error.message : String(error)}`);
      state.record = { energy: config.energy.maxEnergy, skills: {}, counters: {} };
    }
    state.loaded = true;
    return config;
  }

  private mutate(
    userId: string,
    apply: (state: PlayerProgressState, config: EnergySkillsConfig, gains: Gains) => void,
  ): Promise<ProgressSnapshot> {
    const state = this.stateFor(userId);
    return this.run(state, async () => {
      const config = await this.ensureLoaded(state);
      const before = { energy: this.clampEnergy(state, config), skills: JSON.stringify(state.record.skills) };
      const gains: Gains = [];
      apply(state, config, gains);
      this.clampEnergy(state, config);
      const snapshot = this.snapshot(state, config, gains);
      if (before.energy !== state.record.energy || before.skills !== JSON.stringify(state.record.skills) || gains.length > 0) {
        this.touch(state);
        this.notify(state, snapshot);
      } else if (state.dirty) {
        this.scheduleSave(state); // só contadores mudaram: grava sem avisar o cliente
      }
      return snapshot;
    });
  }

  /** Energia a cada N ocorrências (contador persistido por chave). */
  private chargeEvery(state: PlayerProgressState, counterKey: string, cost: { amount: number; every: number }, count: number): void {
    const every = Math.max(1, cost.every);
    const total = (state.record.counters[counterKey] ?? 0) + count;
    const charges = Math.floor(total / every);
    state.record.counters[counterKey] = total % every;
    state.dirty = true;
    if (charges > 0 && cost.amount > 0) state.record.energy = Math.max(0, state.record.energy - charges * cost.amount);
  }

  private spend(state: PlayerProgressState, _config: EnergySkillsConfig, amount: number): void {
    if (amount <= 0) return;
    state.record.energy = Math.max(0, state.record.energy - amount);
  }

  private addXp(state: PlayerProgressState, gains: Gains, skill: SkillId, xp: number): void {
    const amount = Math.max(0, Math.floor(xp));
    if (amount <= 0) return;
    state.record.skills[skill] = (state.record.skills[skill] ?? 0) + amount;
    const existing = gains.find((gain) => gain.skill === skill);
    if (existing) existing.xp += amount;
    else gains.push({ skill, xp: amount });
  }

  private clampEnergy(state: PlayerProgressState, config: EnergySkillsConfig): number {
    const clamped = Math.max(0, Math.min(config.energy.maxEnergy, Math.floor(state.record.energy)));
    state.record.energy = clamped;
    return clamped;
  }

  /** Um snapshot por chamada, sempre com `seq` maior que o anterior (ver PlayerProgressState.seq). */
  private snapshot(state: PlayerProgressState, config: EnergySkillsConfig, gains: Gains): ProgressSnapshot {
    const energy = this.clampEnergy(state, config);
    const skills = {} as Record<SkillId, SkillProgress>;
    for (const id of SKILL_IDS) skills[id] = skillProgressFromXp(config.skills, state.record.skills[id] ?? 0);
    state.seq = Math.max(state.seq + 1, Date.now());
    return {
      seq: state.seq,
      energy,
      maxEnergy: config.energy.maxEnergy,
      maxHp: config.energy.maxHp,
      weakSpeedPercent: config.energy.weakSpeedPercent,
      state: evaluateEnergyState(config.energy, energy),
      skills,
      gains,
      persisted: state.persisted,
    };
  }

  private notify(state: PlayerProgressState, snapshot: ProgressSnapshot): void {
    for (const listener of state.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn(`[progress] listener falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private touch(state: PlayerProgressState): void {
    state.dirty = true;
    state.lastTouched = Date.now();
    this.scheduleSave(state);
  }

  private scheduleSave(state: PlayerProgressState): void {
    if (!state.persisted || state.saveTimer) return;
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      void this.flush(state);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Grava o estado atual (dentro da fila, para não competir com uma mutação). */
  private flush(state: PlayerProgressState): Promise<void> {
    return this.run(state, async () => {
      if (!state.dirty || !state.persisted || !state.loaded) return;
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      const snapshot: PlayerProgressRecord = {
        energy: state.record.energy,
        skills: { ...state.record.skills },
        counters: { ...state.record.counters },
      };
      state.dirty = false;
      try {
        const result = await savePlayerProgress(state.userId, snapshot);
        if (result.tableMissing) {
          state.persisted = false;
          console.warn('[progress] tabela player_progress ausente — progresso só em memória');
        } else if (!result.ok) {
          state.dirty = true;
          console.warn(`[progress] gravar progresso de ${state.userId} falhou: ${result.error}`);
        }
      } catch (error) {
        state.dirty = true;
        console.warn(`[progress] gravar progresso de ${state.userId} falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /** Estados sem assinantes e parados há tempo saem da memória (depois de gravar). */
  private ensureSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, state] of this.states) {
        if (state.listeners.size > 0 || now - state.lastTouched < IDLE_EVICT_MS) continue;
        void this.flush(state).then(() => {
          if (state.listeners.size === 0 && !state.dirty && this.states.get(userId) === state) this.states.delete(userId);
        });
      }
      if (this.states.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
      }
    }, 60_000);
    this.sweepTimer.unref?.();
  }
}

export const progressService = new ProgressService();
