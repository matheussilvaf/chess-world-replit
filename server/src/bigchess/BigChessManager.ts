/**
 * Big Chess Board (autoritativo). Regras puras em shared/bigchess; aqui fica o
 * estado vivo da sala, a persistência e a validação das mensagens. O
 * WorldRoom só encaminha:
 *
 *   bigchess_place   {requestId, itemKey, square}  → inventory_changed {square} | inventory_error
 *   bigchess_collect {requestId, square}           → inventory_changed {crowns, collected} | inventory_error
 *   bigchess_equip   {requestId, square, itemKey}  → inventory_changed {square} | inventory_error
 *   bigchess_attack  {requestId, square}           → inventory_changed {square, damage, destroyed} | inventory_error
 *
 * Só salas `craft:*` (Mundo de Coleta) têm tabuleiro. A carteira de Crowns
 * viaja fora do inventário: `wallet_update {crowns}` no join e após coletar.
 *
 * Persistência: toda mutação pedida por jogador é gravada ANTES de ser
 * confirmada — se o banco recusar, a memória volta ao snapshot anterior e o
 * pedido falha (nada de peça paga que some no restart). Posicionar é INSERT
 * (a PK da casa é a trava entre salas/processos); o resto é UPDATE por dono.
 * O tick só acumula tempo (renda/pontos/regen) e grava em write-behind.
 *
 * Ataque: o cliente não escolhe modo nem dano. Um acerto só vale se a sessão
 * tem um golpe (`attack`) recém-aceito pelo CombatResolver; o tipo do golpe
 * ('shoot' → flecha, senão corpo a corpo) define alcance e dano, e cada
 * golpe atinge cada casa no máximo uma vez.
 */
import type { Client } from '@colyseus/core';
import { BigChessPieceState } from '../schemas/BigChessPieceState.js';
import type { WorldState } from '../schemas/WorldState.js';
import type { PlayerState } from '../schemas/PlayerState.js';
import type { SwingRecord } from '../combat/combatResolver.js';
import {
  BADGE_COVER,
  BADGE_DEFENSE_PIECE,
  BIGCHESS_ARROW_FAMILY_ID,
  BIGCHESS_ARROW_HIT_SLACK_MS,
  BIGCHESS_ARROW_RANGE,
  BIGCHESS_INTERACT_DISTANCE,
  BIGCHESS_MELEE_HIT_SLACK_MS,
  BIGCHESS_MELEE_RANGE,
  BIGCHESS_TYPE_LABELS,
  advanceBigChessPiece,
  applyBigChessDamage,
  bigChessCollectableCrowns,
  bigChessPieceFor,
  bigChessPieceView,
  bigChessSquareCenter,
  bigChessSquareRect,
  bigChessStartingPieceAt,
  cloneBigChessPieceRecord,
  equipBigChessItem,
  isBigChessSquare,
  newBigChessPieceRecord,
  parseBigChessSlots,
  restoreBigChessPieceRecord,
  serializeBigChessSlots,
  type BigChessConfig,
  type BigChessPieceRecord,
} from '../shared/bigchess/BigChessShapes.js';
import { distanceToRect } from '../shared/craft/PlaceableStations.js';
import { itemHasBadge } from '../shared/craft/CraftBadges.js';
import { isInventoryItemId } from '../shared/craft/CraftShapes.js';
import { parseWeaponRef } from '../shared/characters/PlayerCharacterShapes.js';
import { WEAPON_CATEGORY, getWeaponVariantProjectile, resolveWeaponLevelStats } from '../shared/combat/WeaponShapes.js';
import { getCraftItemsCached } from '../craft/craftRepository.js';
import { getCraftBadgesCached } from '../craft/craftBadgeRepository.js';
import { applyInventoryDeltas, getInventory } from '../collection/inventoryRepository.js';
import { getWeaponFamiliesCached } from '../rigs/weaponFamilyRepository.js';
import {
  BIGCHESS_SCHEMA_MISSING,
  addCrowns,
  deleteBigChessPiece,
  getBigChessConfigCached,
  getWallet,
  insertBigChessPiece,
  loadBigChessPieces,
  updateBigChessPiece,
} from './bigChessRepository.js';

export type BigChessReply = { event: 'inventory_changed' | 'inventory_error'; payload: Record<string, unknown> };
/** Resposta do snapshot de inventário do host (mesmo tipo das estações portáteis). */
export type BigChessSnapshotReply = { event: 'inventory_changed' | 'inventory_error' | 'craft_result' | 'craft_error'; payload: Record<string, unknown> };

export interface BigChessHost {
  readonly state: WorldState;
  readonly region: string;
  clientByPlayerId(playerId: string): Client | undefined;
  /** Serializa operações sobre a mesma entidade (mesmo lock dos drops/estações). */
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
  inventorySnapshot(userId: string): Promise<BigChessSnapshotReply>;
  broadcast(event: string, payload: Record<string, unknown>): void;
  /** Dano de fonte não-jogador (contra-ataque); null = não aplicado. */
  damagePlayer(sessionId: string, damage: number, attackerName: string): number | null;
  /** Jogador está morto (KO) — não ataca nem sofre contra-ataque. */
  isDead(sessionId: string): boolean;
  /** Último golpe (`attack`) aceito da sessão pelo CombatResolver. */
  lastSwing(sessionId: string): SwingRecord | null;
}

const inventoryError = (message: string): BigChessReply => ({ event: 'inventory_error', payload: { message } });
const isAnonId = (playerId: string): boolean => playerId.startsWith('anon:');
const lockKey = (square: string): string => `bigchess:${square}`;

/** Intervalo do tick da sala (regen/renda/pontos/expirações). */
export const BIGCHESS_TICK_MS = 5_000;
/** Contra-ataque: pulso de dano por segundo a cada intruso — relógio próprio, mais fino que o tick. */
export const BIGCHESS_COUNTER_TICK_MS = 1_000;
/** Intervalo do write-behind das peças sujas sem ação do jogador. */
const FLUSH_INTERVAL_MS = 60_000;

export class BigChessManager {
  private readonly pieces = new Map<string, BigChessPieceRecord>();
  private readonly dirty = new Set<string>();
  /** Contador de mutações por casa: um write só limpa `dirty` se nada mudou enquanto ele voava. */
  private readonly revision = new Map<string, number>();
  /** Casas já atingidas pelo golpe corrente de cada sessão (uma vez por casa por golpe). */
  private readonly swingHits = new Map<string, { swingAt: number; squares: Set<string> }>();
  private readonly counterPulseAt = new Map<string, number>();
  private lastFlushAt = Date.now();
  private loaded = false;
  private persistenceWarned = false;

  constructor(private readonly host: BigChessHost) {}

  get enabled(): boolean {
    return this.host.region.startsWith('craft:');
  }

  // ----------------------------------------------------------------- carga

  async load(): Promise<void> {
    if (!this.enabled) return;
    const config = await getBigChessConfigCached();
    const result = await loadBigChessPieces(this.host.region);
    if (result.tableMissing) {
      console.warn('[bigchess] tabela bigchess_pieces ausente — posicionar/equipar/coletar vão falhar até rodar o SQL do admin');
    } else if (result.error) {
      console.warn(`[bigchess] falha ao carregar peças: ${result.error}`);
    }
    const now = Date.now();
    for (const record of result.pieces) {
      // Catch-up do tempo em que a sala esteve fechada: renda, pontos, regen e expirações.
      const advanced = advanceBigChessPiece(record, config, now);
      this.pieces.set(record.square, record);
      if (advanced.changed) this.markDirty(record.square);
      this.host.state.bigChessPieces.set(record.square, this.toState(record, config, now));
    }
    this.loaded = true;
    if (this.pieces.size > 0) console.log(`[bigchess] ${this.pieces.size} peça(s) carregada(s) em ${this.host.region}`);
  }

  private toState(record: BigChessPieceRecord, config: BigChessConfig, now: number): BigChessPieceState {
    const state = new BigChessPieceState();
    this.applyView(state, record, config, now);
    return state;
  }

  private applyView(state: BigChessPieceState, record: BigChessPieceRecord, config: BigChessConfig, now: number): void {
    const view = bigChessPieceView(record, config, now);
    state.square = view.square;
    state.itemKey = view.itemKey;
    state.ownerId = view.ownerId;
    state.ownerName = view.ownerName;
    state.hp = view.hp;
    state.maxHp = view.maxHp;
    state.placedAt = view.placedAt;
    state.nextRegenAt = view.nextRegenAt;
    state.incomeAccrued = view.incomeAccrued;
    state.incomeCollected = view.incomeCollected;
    state.incomePerDay = view.incomePerDay;
    state.points = view.points;
    state.pointsPerHour = view.pointsPerHour;
    state.coverItemKey = view.cover?.itemKey ?? '';
    state.coverExpiresAt = view.cover?.expiresAt ?? 0;
    state.defenses = serializeBigChessSlots(view.defenses);
    state.counterUntil = view.counterUntil;
    state.syncedAt = view.syncedAt;
    state.counterRadius = view.counterRadius;
  }

  private publish(record: BigChessPieceRecord, config: BigChessConfig, now: number): void {
    const existing = this.host.state.bigChessPieces.get(record.square);
    if (existing) this.applyView(existing, record, config, now);
    else this.host.state.bigChessPieces.set(record.square, this.toState(record, config, now));
  }

  // ----------------------------------------------------------------- tick

  /** Avança o tempo de todas as peças; chamado pelo relógio da sala. */
  async tick(): Promise<void> {
    if (!this.enabled || !this.loaded) return;
    const config = await getBigChessConfigCached();
    const now = Date.now();
    for (const record of this.pieces.values()) {
      const advanced = advanceBigChessPiece(record, config, now);
      if (advanced.changed) this.markDirty(record.square);
      this.publish(record, config, now);
    }
    if (now - this.lastFlushAt >= FLUSH_INTERVAL_MS) await this.flush();
  }

  /** Contra-ataques ativos: intrusos dentro do raio levam `damage` por segundo (relógio de 1 s). */
  async pulseCounters(): Promise<void> {
    if (!this.enabled || !this.loaded) return;
    const now = Date.now();
    let config: BigChessConfig | null = null;
    for (const record of this.pieces.values()) {
      if (record.counterUntil <= now) continue;
      config ??= await getBigChessConfigCached();
      this.pulseCounter(record, config, now);
    }
  }

  private pulseCounter(record: BigChessPieceRecord, config: BigChessConfig, now: number): void {
    const rules = record.counterItemKey ? config.defenses[record.counterItemKey]?.counterAttack : null;
    if (!rules || rules.damage <= 0 || rules.radius <= 0) return;
    const center = bigChessSquareCenter(record.square);
    const def = bigChessPieceFor(record.itemKey);
    const label = def ? def.name : 'Peça';
    this.host.state.players.forEach((player, sessionId) => {
      if (player.id === record.ownerId || isAnonId(player.id)) return;
      if (Math.hypot(player.x - center.x, player.y - center.y) > rules.radius) return;
      const key = `${record.square}:${sessionId}`;
      if (now < (this.counterPulseAt.get(key) ?? 0)) return;
      const hp = this.host.damagePlayer(sessionId, rules.damage, `${label} (contra-ataque)`);
      if (hp !== null) this.counterPulseAt.set(key, now + BIGCHESS_COUNTER_TICK_MS);
    });
  }

  // ----------------------------------------------------------- persistir

  private markDirty(square: string): void {
    this.dirty.add(square);
    this.revision.set(square, (this.revision.get(square) ?? 0) + 1);
  }

  private noteWriteFailure(context: string, error: string | null, tableMissing: boolean): void {
    if (tableMissing) {
      if (!this.persistenceWarned) {
        console.warn(`[bigchess] ${context}: tabela ausente — rode o SQL do Controlador do Big Chessboard`);
        this.persistenceWarned = true;
      }
      return;
    }
    if (error) console.warn(`[bigchess] ${context}: ${error}`);
  }

  private writeErrorMessage(action: string, result: { error: string | null; tableMissing: boolean }): string {
    return result.tableMissing ? BIGCHESS_SCHEMA_MISSING : `Não foi possível ${action} (${result.error ?? 'erro de persistência'})`;
  }

  /**
   * Grava o estado atual da peça (UPDATE por dono). Deve rodar sob o lock da
   * casa. `dirty` só é limpo se a peça não mudou enquanto o write voava.
   */
  private async persist(record: BigChessPieceRecord): Promise<{ ok: boolean; error: string | null; tableMissing: boolean }> {
    const revision = this.revision.get(record.square) ?? 0;
    const result = await updateBigChessPiece(record);
    if (result.ok) {
      if ((this.revision.get(record.square) ?? 0) === revision) this.dirty.delete(record.square);
    } else {
      this.noteWriteFailure(`salvar ${record.square}`, result.error, result.tableMissing);
    }
    return result;
  }

  /** Grava todas as peças sujas (write-behind e onDispose), casa a casa sob o lock de cada uma. */
  async flush(): Promise<void> {
    this.lastFlushAt = Date.now();
    if (this.dirty.size === 0) return;
    for (const square of [...this.dirty]) {
      await this.host.withLock(lockKey(square), async () => {
        const record = this.pieces.get(square);
        if (!record) {
          this.dirty.delete(square);
          return;
        }
        await this.persist(record);
      });
    }
  }

  /** Tira a peça da memória e do estado sincronizado (a linha do banco já foi apagada). */
  private forget(square: string): void {
    this.pieces.delete(square);
    this.dirty.delete(square);
    this.revision.delete(square);
    this.host.state.bigChessPieces.delete(square);
    for (const key of [...this.counterPulseAt.keys()]) if (key.startsWith(`${square}:`)) this.counterPulseAt.delete(key);
  }

  // ------------------------------------------------------------- carteira

  async walletFor(userId: string): Promise<{ crowns: number; tableMissing: boolean }> {
    const result = await getWallet(userId);
    if (result.error) console.warn(`[bigchess] carteira de ${userId}: ${result.error}`);
    return { crowns: result.crowns, tableMissing: result.tableMissing };
  }

  // ----------------------------------------------------------- posicionar

  handlePlace(player: PlayerState | undefined, data: unknown): Promise<BigChessReply> {
    const body = data as { itemKey?: unknown; square?: unknown };
    const square = typeof body?.square === 'string' ? body.square : '';
    return this.host.withLock(lockKey(square || 'place'), () => this.placeLocked(player, body));
  }

  private async placeLocked(player: PlayerState | undefined, body: { itemKey?: unknown; square?: unknown }): Promise<BigChessReply> {
    if (!player || isAnonId(player.id)) return inventoryError('Autenticação obrigatória');
    if (!this.enabled) return inventoryError('O Big Chess Board fica no Mundo de Coleta');
    if (!this.loaded) return inventoryError('Tabuleiro ainda carregando — tente de novo');
    const def = bigChessPieceFor(body.itemKey);
    if (!def) return inventoryError('Este item não é uma peça do Big Chess Board');
    if (!isBigChessSquare(body.square)) return inventoryError('Casa inválida');
    const square = body.square;
    const start = bigChessStartingPieceAt(square);
    if (!start || start.color !== def.color || start.type !== def.type) {
      return inventoryError(`${def.name} só pode ser posicionada na casa inicial dela`);
    }
    if (this.pieces.has(square)) return inventoryError('Essa casa já está ocupada');
    if (distanceToRect(player.x, player.y, bigChessSquareRect(square)) > BIGCHESS_INTERACT_DISTANCE) {
      return inventoryError('Chegue mais perto do tabuleiro');
    }
    // Confere o inventário antes de reservar a casa no banco (a reserva é o INSERT).
    const inventory = await getInventory(player.id);
    if (inventory.error) return inventoryError(inventory.error);
    if ((inventory.items.find((item) => item.itemKey === def.itemId)?.qty ?? 0) < 1) {
      return inventoryError(`Você não tem ${def.name}`);
    }
    const config = await getBigChessConfigCached();
    const now = Date.now();
    const record = newBigChessPieceRecord(
      { region: this.host.region, square, itemKey: def.itemId, ownerId: player.id, ownerName: player.username },
      config,
      now,
    );
    const inserted = await insertBigChessPiece(record);
    if (!inserted.ok) {
      if (inserted.conflict) return inventoryError('Essa casa acabou de ser ocupada');
      this.noteWriteFailure(`posicionar em ${square}`, inserted.error, inserted.tableMissing);
      return inventoryError(this.writeErrorMessage('posicionar a peça', inserted));
    }
    const taken = await applyInventoryDeltas(player.id, [{ itemKey: def.itemId, qty: -1 }]);
    if (!taken.ok) {
      // Casa reservada mas o item sumiu no meio: libera a casa de novo.
      const released = await deleteBigChessPiece(this.host.region, square);
      if (!released.ok) console.error(`[bigchess] casa ${square} ficou reservada sem débito de ${player.id}: ${released.error ?? 'tabela ausente'}`);
      return inventoryError(taken.error ?? `Você não tem ${def.name}`);
    }
    this.pieces.set(square, record);
    this.revision.set(square, 0);
    this.publish(record, config, now);
    console.log(`[bigchess] ${player.username} posicionou ${def.itemId} em ${square} (${this.host.region})`);
    return this.snapshotWith(player.id, { square });
  }

  /** Snapshot do inventário + campos extras (o host responde só inventory_changed/inventory_error aqui). */
  private async snapshotWith(userId: string, extra: Record<string, unknown>): Promise<BigChessReply> {
    const reply = await this.host.inventorySnapshot(userId);
    if (reply.event === 'inventory_changed') return { event: 'inventory_changed', payload: { ...reply.payload, ...extra } };
    return { event: 'inventory_error', payload: reply.payload };
  }

  // -------------------------------------------------------------- coletar

  handleCollect(player: PlayerState | undefined, data: unknown): Promise<BigChessReply> {
    const body = data as { square?: unknown };
    const square = typeof body?.square === 'string' ? body.square : '';
    return this.host.withLock(lockKey(square || 'collect'), async () => {
      if (!player || isAnonId(player.id)) return inventoryError('Autenticação obrigatória');
      const record = this.pieces.get(square);
      if (!record) return inventoryError('Não há peça nessa casa');
      if (record.ownerId !== player.id) return inventoryError('Essa peça não é sua');
      if (distanceToRect(player.x, player.y, bigChessSquareRect(square)) > BIGCHESS_INTERACT_DISTANCE) {
        return inventoryError('Chegue mais perto do tabuleiro para coletar');
      }
      const config = await getBigChessConfigCached();
      const now = Date.now();
      advanceBigChessPiece(record, config, now);
      const amount = bigChessCollectableCrowns(record);
      if (amount <= 0) return inventoryError('Ainda não há renda para coletar');
      const before = cloneBigChessPieceRecord(record);
      // 1) a peça "entrega" a renda no banco; 2) a carteira recebe (crédito atômico).
      record.incomeAccrued -= amount;
      record.incomeCollected += amount;
      this.markDirty(square);
      const saved = await this.persist(record);
      if (!saved.ok) {
        restoreBigChessPieceRecord(record, before);
        this.markDirty(square);
        return inventoryError(this.writeErrorMessage('coletar a renda', saved));
      }
      const wallet = await addCrowns(player.id, amount);
      if (!wallet.ok) {
        // Devolve a renda à peça (memória + banco); se nem isso gravar, fica registrado no log.
        restoreBigChessPieceRecord(record, before);
        this.markDirty(square);
        const restored = await this.persist(record);
        if (!restored.ok) console.error(`[bigchess] ${amount} Crowns de ${player.id} em ${square} não creditados nem devolvidos: ${restored.error ?? 'tabela ausente'}`);
        return inventoryError(wallet.tableMissing
          ? 'Carteira indisponível — o admin precisa rodar o SQL do Controlador do Big Chessboard (player_wallets + chessworld_add_crowns)'
          : (wallet.error ?? 'Não foi possível creditar as Crowns'));
      }
      this.publish(record, config, now);
      const client = this.host.clientByPlayerId(player.id);
      client?.send('wallet_update', { crowns: wallet.crowns });
      return { event: 'inventory_changed', payload: { square, collected: amount, crowns: wallet.crowns } };
    });
  }

  // -------------------------------------------------------------- equipar

  handleEquip(player: PlayerState | undefined, data: unknown): Promise<BigChessReply> {
    const body = data as { square?: unknown; itemKey?: unknown };
    const square = typeof body?.square === 'string' ? body.square : '';
    return this.host.withLock(lockKey(square || 'equip'), async () => {
      if (!player || isAnonId(player.id)) return inventoryError('Autenticação obrigatória');
      const record = this.pieces.get(square);
      if (!record) return inventoryError('Não há peça nessa casa');
      if (record.ownerId !== player.id) return inventoryError('Essa peça não é sua');
      if (!isInventoryItemId(body.itemKey)) return inventoryError('Item inválido');
      const itemKey = body.itemKey;
      const itemName = (await getCraftItemsCached())[itemKey]?.name ?? itemKey;
      const badges = await getCraftBadgesCached();
      const isCover = itemHasBadge(badges, itemKey, BADGE_COVER);
      const isDefense = itemHasBadge(badges, itemKey, BADGE_DEFENSE_PIECE);
      const config = await getBigChessConfigCached();
      let slot: 'cover' | 'defense';
      if (isCover && config.covers[itemKey]) slot = 'cover';
      else if (isDefense && config.defenses[itemKey]) slot = 'defense';
      else if (isCover || isDefense) return inventoryError(`${itemName} ainda não foi configurado no Controlador do Big Chessboard`);
      else return inventoryError(`${itemName} não é capa nem item de defesa`);
      if (distanceToRect(player.x, player.y, bigChessSquareRect(square)) > BIGCHESS_INTERACT_DISTANCE) {
        return inventoryError('Chegue mais perto do tabuleiro');
      }
      const now = Date.now();
      advanceBigChessPiece(record, config, now);
      // Valida antes de debitar: slot cheio/duplicado não consome o item.
      const preview = equipBigChessItem(cloneBigChessPieceRecord(record), config, itemKey, slot, now);
      if (!preview.ok) return inventoryError(preview.message);
      const taken = await applyInventoryDeltas(player.id, [{ itemKey, qty: -1 }]);
      if (!taken.ok) return inventoryError(taken.error ?? `Você não tem ${itemName}`);
      const before = cloneBigChessPieceRecord(record);
      const applied = equipBigChessItem(record, config, itemKey, slot, now);
      if (!applied.ok) {
        await this.refund(player.id, itemKey, square);
        return inventoryError(applied.message);
      }
      this.markDirty(square);
      const saved = await this.persist(record);
      if (!saved.ok) {
        restoreBigChessPieceRecord(record, before);
        this.markDirty(square);
        await this.refund(player.id, itemKey, square);
        return inventoryError(this.writeErrorMessage(`equipar ${itemName}`, saved));
      }
      this.publish(record, config, now);
      return this.snapshotWith(player.id, { square });
    });
  }

  private async refund(userId: string, itemKey: string, square: string): Promise<void> {
    const refunded = await applyInventoryDeltas(userId, [{ itemKey, qty: 1 }]);
    if (!refunded.ok) console.error(`[bigchess] ${itemKey} de ${userId} debitado sem equipar em ${square} e sem estorno: ${refunded.error ?? 'erro'}`);
  }

  // --------------------------------------------------------------- atacar

  handleAttack(sessionId: string, player: PlayerState | undefined, data: unknown): Promise<BigChessReply> {
    const body = data as { square?: unknown };
    const square = typeof body?.square === 'string' ? body.square : '';
    return this.host.withLock(lockKey(square || 'attack'), async () => {
      if (!player || isAnonId(player.id)) return inventoryError('Autenticação obrigatória');
      const record = this.pieces.get(square);
      if (!record) return inventoryError('Não há peça nessa casa');
      if (record.ownerId === player.id) return inventoryError('Você não pode atacar a própria peça');
      if (player.currentBoardId) return inventoryError('Levante-se para atacar');
      if (this.host.isDead(sessionId)) return inventoryError('Você está fora de combate');
      const weapon = parseWeaponRef(player.equippedWeapon);
      if (!weapon || weapon.category !== WEAPON_CATEGORY) return inventoryError('Só armas principais danificam peças (ferramentas não)');
      // O acerto precisa estar ancorado num golpe que o servidor aceitou: o
      // tipo do golpe (não o cliente) decide flecha × corpo a corpo.
      const swing = this.host.lastSwing(sessionId);
      if (!swing) return inventoryError('Golpeie a peça com a arma equipada');
      const now = Date.now();
      const mode = swing.movement === 'shoot' ? 'arrow' : 'melee';
      const window = swing.until - swing.at + (mode === 'arrow' ? BIGCHESS_ARROW_HIT_SLACK_MS : BIGCHESS_MELEE_HIT_SLACK_MS);
      if (now - swing.at > window) return inventoryError('Golpe fora de tempo — ataque de novo');
      const hits = this.swingHits.get(sessionId);
      if (hits && hits.swingAt === swing.at && hits.squares.has(square)) return inventoryError('Essa peça já foi atingida neste golpe');
      const families = await getWeaponFamiliesCached();
      const variantId = weapon.variantId ?? 'default';
      const weaponStats = resolveWeaponLevelStats(families[weapon.familyId] ?? null, variantId, 1);
      let damage = weaponStats.damage;
      let range = BIGCHESS_MELEE_RANGE;
      if (mode === 'arrow') {
        const arrowFamily = families[BIGCHESS_ARROW_FAMILY_ID] ?? null;
        damage = resolveWeaponLevelStats(arrowFamily, variantId, 1, weaponStats.damage).damage;
        range = getWeaponVariantProjectile(arrowFamily, variantId)?.rangePx ?? BIGCHESS_ARROW_RANGE;
      }
      if (distanceToRect(player.x, player.y, bigChessSquareRect(square)) > range) return inventoryError('Longe demais da peça');
      if (damage <= 0) return inventoryError('Essa arma não causa dano');
      if (hits && hits.swingAt === swing.at) hits.squares.add(square);
      else this.swingHits.set(sessionId, { swingAt: swing.at, squares: new Set([square]) });
      const config = await getBigChessConfigCached();
      advanceBigChessPiece(record, config, now);
      const before = cloneBigChessPieceRecord(record);
      const result = applyBigChessDamage(record, config, damage, now);
      const def = bigChessPieceFor(record.itemKey);
      const pieceName = def ? def.name : record.itemKey;
      if (result.destroyed) {
        const removed = await deleteBigChessPiece(this.host.region, square);
        if (!removed.ok) {
          restoreBigChessPieceRecord(record, before);
          this.noteWriteFailure(`remover ${square}`, removed.error, removed.tableMissing);
          return inventoryError(this.writeErrorMessage('registrar o ataque', removed));
        }
        this.forget(square);
        this.host.broadcast('bigchess_destroyed', {
          square,
          itemKey: record.itemKey,
          pieceName,
          ownerId: record.ownerId,
          ownerName: record.ownerName,
          attackerName: player.username,
        });
        console.log(`[bigchess] ${player.username} destruiu ${record.itemKey} de ${record.ownerName} em ${square}`);
      } else {
        this.markDirty(square);
        const saved = await this.persist(record);
        if (!saved.ok) {
          restoreBigChessPieceRecord(record, before);
          this.markDirty(square);
          return inventoryError(this.writeErrorMessage('registrar o ataque', saved));
        }
        this.publish(record, config, now);
      }
      return {
        event: 'inventory_changed',
        payload: { square, damage: result.damage, hp: record.hp, destroyed: result.destroyed, counter: result.counter },
      };
    });
  }

  /** Limpa o rastro da sessão ao sair da sala. */
  clearSession(sessionId: string): void {
    this.swingHits.delete(sessionId);
    for (const key of [...this.counterPulseAt.keys()]) if (key.endsWith(`:${sessionId}`)) this.counterPulseAt.delete(key);
  }

  /** Rótulo PT do tipo (para logs/mensagens). */
  static typeLabel(itemKey: string): string {
    const def = bigChessPieceFor(itemKey);
    return def ? BIGCHESS_TYPE_LABELS[def.type] : itemKey;
  }

  /** Slots de defesa desserializados de um schema (uso em testes/diagnóstico). */
  static parseSlots(raw: string) {
    return parseBigChessSlots(raw);
  }
}
