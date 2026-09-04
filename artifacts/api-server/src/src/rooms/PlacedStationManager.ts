/**
 * Estações portáteis posicionadas no mapa (autoritativo). Ver as regras em
 * shared/craft/PlaceableStations. O WorldRoom só encaminha as mensagens:
 *
 *   station_place          {requestId, itemKey, x, y}      → inventory_changed {placedId} | inventory_error
 *   station_pickup         {requestId, placedId}           → inventory_changed | inventory_error
 *   craft_item             {..., placedId}                 → craft_result | craft_error  (via handleCraft)
 *   station_request_access {placedId}                      → dono recebe station_access_request;
 *                                                            requerente recebe station_access_update {status:'sent'|'error'}
 *   station_respond_access {placedId, requesterId, allow}  → requerente recebe station_access_update {status:'granted'|'denied'}
 *
 * A varredura periódica converte estações vencidas em drops comuns (qualquer
 * um recolhe, com a durabilidade que restou).
 */
import type { Client } from '@colyseus/core';
import { nanoid } from 'nanoid';
import { WorldDropState } from '../schemas/WorldDropState.js';
import { PlacedStationState } from '../schemas/PlacedStationState.js';
import type { WorldState } from '../schemas/WorldState.js';
import type { PlayerState } from '../schemas/PlayerState.js';
import { INVENTORY_DROP_MAX_DISTANCE, WORLD_DROP_TTL_MS } from '../shared/collection/CollectionShapes.js';
import {
  PLACEABLE_STACK_LIMIT,
  PLACED_STATION_CLEARANCE,
  PLACED_STATION_PICKUP_DISTANCE,
  PLACED_STATION_TTL_MS,
  PLACED_STATION_USE_DISTANCE,
  PUBLIC_STATION_RECTS,
  distanceToRect,
  joinAllowedIds,
  parseAllowedIds,
  placeableStationFor,
  placedStationRect,
  pointInRect,
  rectsOverlap,
  type PlaceableStationDef,
} from '../shared/craft/PlaceableStations.js';
import { isToolItemKey } from '../shared/collection/ToolWear.js';
import { getCraftItemsCached } from '../craft/craftRepository.js';
import { executePlayerCraft } from '../craft/craftService.js';
import { applyInventoryDeltas, giveWithDurability, takeWithDurability, type DurabilityKind } from '../collection/inventoryRepository.js';
import { toolMaxDurability } from '../collection/inventoryRoutes.js';
import { getWeaponFamiliesCached } from '../rigs/weaponFamilyRepository.js';

export type PlacedReply = { event: 'inventory_changed' | 'inventory_error' | 'craft_result' | 'craft_error'; payload: Record<string, unknown> };

export interface PlacedStationHost {
  readonly state: WorldState;
  readonly region: string;
  clientByPlayerId(playerId: string): Client | undefined;
  /** Serializa operações sobre a mesma entidade (mesmo lock dos drops). */
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Recalcula se a sala deve ficar viva sem jogadores (drops/estações). */
  updateRoomHold(): void;
  inventorySnapshot(userId: string): Promise<PlacedReply>;
}

const inventoryError = (message: string): PlacedReply => ({ event: 'inventory_error', payload: { message } });
const craftError = (message: string): PlacedReply => ({ event: 'craft_error', payload: { message } });

/** Nome configurado no admin (ou o padrão) de uma estação portátil. */
async function displayNameFor(def: PlaceableStationDef): Promise<string> {
  return (await getCraftItemsCached())[def.itemId]?.name ?? def.name;
}

/** Durabilidade máxima configurada de qualquer item com durabilidade (ferramenta ou estação). */
export async function maxDurabilityForItem(itemKey: string): Promise<{ kind: DurabilityKind; max: number } | null> {
  const def = placeableStationFor(itemKey);
  if (def) {
    const configured = (await getCraftItemsCached())[def.itemId]?.durability;
    return { kind: 'station', max: typeof configured === 'number' && configured >= 1 ? configured : def.defaultDurability };
  }
  if (isToolItemKey(itemKey)) return { kind: 'tool', max: toolMaxDurability(await getWeaponFamiliesCached(), itemKey) };
  return null;
}

export class PlacedStationManager {
  /** Pedidos de permissão pendentes: placedId → requesterId → nome. */
  private readonly pending = new Map<string, Map<string, string>>();

  constructor(private readonly host: PlacedStationHost) {}

  get size(): number {
    return this.host.state.placedStations.size;
  }

  // ------------------------------------------------------------ posicionar

  /**
   * Posicionar. Todo o caminho (validar lugar → debitar → inserir) roda sob um
   * único lock da sala: dois jogadores posicionando ao mesmo tempo no mesmo
   * lugar nunca passam os dois pela checagem de sobreposição.
   */
  handlePlace(player: PlayerState | undefined, data: unknown): Promise<PlacedReply> {
    return this.host.withLock('placed:place', () => this.placeLocked(player, data));
  }

  private async placeLocked(player: PlayerState | undefined, data: unknown): Promise<PlacedReply> {
    const body = data as { itemKey?: unknown; x?: unknown; y?: unknown };
    if (!player || player.id.startsWith('anon:')) return inventoryError('Autenticação obrigatória');
    if (!this.host.region.startsWith('craft:')) return inventoryError('Estações portáteis só podem ser posicionadas no Mundo de Coleta');
    const def = placeableStationFor(body?.itemKey);
    if (!def) return inventoryError('Este item não pode ser posicionado');
    if (typeof body.x !== 'number' || typeof body.y !== 'number' || !Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      return inventoryError('Posição inválida');
    }
    const x = Math.round(body.x);
    const y = Math.round(body.y);
    if (Math.hypot(x - player.x, y - player.y) > INVENTORY_DROP_MAX_DISTANCE) return inventoryError('Posição distante demais');
    const rect = placedStationRect(def, x, y);
    for (const fixed of Object.values(PUBLIC_STATION_RECTS)) {
      if (rectsOverlap(rect, fixed, PLACED_STATION_CLEARANCE)) return inventoryError('Não dá para posicionar em cima de uma estação');
    }
    let blocked: string | null = null;
    this.host.state.placedStations.forEach((other) => {
      if (blocked) return;
      const otherDef = placeableStationFor(other.itemKey);
      if (otherDef && rectsOverlap(rect, placedStationRect(otherDef, other.x, other.y), PLACED_STATION_CLEARANCE)) {
        blocked = 'Já existe uma estação nesse lugar';
      }
    });
    if (!blocked) {
      this.host.state.players.forEach((other) => {
        if (!blocked && pointInRect(other.x, other.y, rect)) blocked = 'Há um jogador nesse lugar';
      });
    }
    if (blocked) return inventoryError(blocked);
    const limits = await maxDurabilityForItem(def.itemId);
    const max = limits?.max ?? def.defaultDurability;
    const taken = await takeWithDurability(player.id, def.itemId, 1, { kind: 'station', max, allowBroken: false });
    if (!taken.ok) return inventoryError(taken.error ?? 'Não foi possível posicionar a estação');
    if (!taken.durabilityPersisted) {
      // Sem a coluna `durability` no Supabase a estação voltaria sempre cheia
      // (recolher + posicionar = durabilidade infinita). Devolve a cópia e recusa.
      await applyInventoryDeltas(player.id, [{ itemKey: def.itemId, qty: 1 }]);
      console.warn('[WorldRoom] estação recusada: coluna collection_inventory.durability ausente (rode a migração)');
      return inventoryError('Durabilidade indisponível no servidor — o admin precisa aplicar a migração do inventário');
    }
    const durability = taken.carried ?? max;
    const placed = new PlacedStationState();
    placed.id = nanoid();
    placed.itemKey = def.itemId;
    placed.stationId = def.stationId;
    placed.ownerId = player.id;
    placed.ownerName = player.username;
    placed.x = x;
    placed.y = y;
    placed.durability = durability;
    placed.maxDurability = max;
    placed.placedAt = Date.now();
    placed.expiresAt = placed.placedAt + PLACED_STATION_TTL_MS;
    placed.allowed = '';
    this.host.state.placedStations.set(placed.id, placed);
    this.host.updateRoomHold();
    console.log(`[WorldRoom] estação posicionada: ${def.itemId} por ${player.username} em (${x}, ${y}) dur ${durability}/${max} (${placed.id})`);
    const reply = await this.host.inventorySnapshot(player.id);
    return reply.event === 'inventory_changed' ? { event: reply.event, payload: { ...reply.payload, placedId: placed.id } } : reply;
  }

  // -------------------------------------------------------------- recolher

  async handlePickup(player: PlayerState | undefined, data: unknown): Promise<PlacedReply> {
    const body = data as { placedId?: unknown };
    if (!player || player.id.startsWith('anon:')) return inventoryError('Autenticação obrigatória');
    if (typeof body?.placedId !== 'string') return inventoryError('Estação inválida');
    const placedId = body.placedId;
    return this.host.withLock(`placed:${placedId}`, async () => {
      const placed = this.host.state.placedStations.get(placedId);
      if (!placed) return inventoryError('Esta estação não está mais aqui');
      if (placed.ownerId !== player.id) return inventoryError('Só o dono pode recolher esta estação');
      const def = placeableStationFor(placed.itemKey);
      if (!def) return inventoryError('Estação desconhecida');
      if (distanceToRect(player.x, player.y, placedStationRect(def, placed.x, placed.y)) > PLACED_STATION_PICKUP_DISTANCE) {
        return inventoryError('Chegue mais perto para recolher');
      }
      // Sai do mapa primeiro (um só dono do estado); volta igual se o crédito falhar.
      this.host.state.placedStations.delete(placedId);
      const credit = await giveWithDurability(player.id, placed.itemKey, 1, placed.durability, {
        kind: 'station', max: placed.maxDurability, limit: PLACEABLE_STACK_LIMIT,
        limitMessage: `Você já carrega uma ${await displayNameFor(def)} — solte ou posicione a que está com você antes de recolher`,
      });
      if (!credit.ok) {
        if (!this.host.state.placedStations.has(placedId)) this.host.state.placedStations.set(placedId, placed);
        return inventoryError(credit.error ?? 'Não foi possível recolher a estação');
      }
      this.pending.delete(placedId);
      this.host.updateRoomHold();
      return this.host.inventorySnapshot(player.id);
    });
  }

  // ----------------------------------------------------------------- craft

  /** Craft numa estação portátil: dono ou autorizado, perto, com durabilidade; cada craft gasta 1. */
  async handleCraft(player: PlayerState, placedId: string, body: { stationId?: unknown; targetId?: unknown; quantity?: unknown }): Promise<PlacedReply> {
    return this.host.withLock(`placed:${placedId}`, async () => {
      const placed = this.host.state.placedStations.get(placedId);
      if (!placed) return craftError('Esta estação não está mais aqui');
      if (placed.stationId !== body.stationId) return craftError('Esta estação não cria esse tipo de item');
      if (placed.ownerId !== player.id && !parseAllowedIds(placed.allowed).includes(player.id)) {
        return craftError('Você não tem permissão para usar esta estação');
      }
      if (placed.durability <= 0) return craftError('Esta estação está sem durabilidade');
      const def = placeableStationFor(placed.itemKey);
      if (!def || distanceToRect(player.x, player.y, placedStationRect(def, placed.x, placed.y)) > PLACED_STATION_USE_DISTANCE) {
        return craftError('Você precisa estar perto da estação');
      }
      const result = await executePlayerCraft(player.id, body.stationId, body.targetId, body.quantity);
      if (!result.ok) return craftError(result.message);
      const still = this.host.state.placedStations.get(placedId);
      if (still) still.durability = Math.max(0, still.durability - 1);
      return { event: 'craft_result', payload: { items: result.items, placedId, durability: still?.durability ?? 0 } };
    });
  }

  // ------------------------------------------------------------ permissões

  handleRequestAccess(client: Client, player: PlayerState | undefined, data: unknown): void {
    const body = data as { placedId?: unknown };
    const placedId = typeof body?.placedId === 'string' ? body.placedId : '';
    const fail = (message: string) => client.send('station_access_update', { placedId, status: 'error', message });
    if (!player || player.id.startsWith('anon:')) return fail('Autenticação obrigatória');
    const placed = this.host.state.placedStations.get(placedId);
    if (!placed) return fail('Esta estação não está mais aqui');
    if (placed.ownerId === player.id) return fail('Esta estação é sua');
    if (parseAllowedIds(placed.allowed).includes(player.id)) {
      client.send('station_access_update', { placedId, status: 'granted', stationId: placed.stationId, itemKey: placed.itemKey });
      return;
    }
    const owner = this.host.clientByPlayerId(placed.ownerId);
    if (!owner) return fail('O dono não está no mapa');
    let requests = this.pending.get(placedId);
    if (!requests) this.pending.set(placedId, (requests = new Map()));
    if (requests.has(player.id)) return fail('Pedido já enviado — aguarde a resposta do dono');
    if (requests.size >= 20) return fail('O dono tem pedidos demais pendentes');
    requests.set(player.id, player.username);
    owner.send('station_access_request', {
      placedId, stationId: placed.stationId, itemKey: placed.itemKey, requesterId: player.id, requesterName: player.username,
    });
    client.send('station_access_update', { placedId, status: 'sent', stationId: placed.stationId, itemKey: placed.itemKey });
  }

  handleRespondAccess(player: PlayerState | undefined, data: unknown): void {
    const body = data as { placedId?: unknown; requesterId?: unknown; allow?: unknown };
    if (!player || typeof body?.placedId !== 'string' || typeof body.requesterId !== 'string') return;
    const placed = this.host.state.placedStations.get(body.placedId);
    if (!placed || placed.ownerId !== player.id) return;
    const requests = this.pending.get(body.placedId);
    if (!requests?.has(body.requesterId)) return;
    requests.delete(body.requesterId);
    if (requests.size === 0) this.pending.delete(body.placedId);
    const allow = body.allow === true;
    if (allow) placed.allowed = joinAllowedIds([...parseAllowedIds(placed.allowed), body.requesterId]);
    this.host.clientByPlayerId(body.requesterId)?.send('station_access_update', {
      placedId: placed.id, status: allow ? 'granted' : 'denied', stationId: placed.stationId, itemKey: placed.itemKey,
    });
  }

  // -------------------------------------------------------------- varredura

  /** Estações vencidas deixam de ter dono: viram drops comuns na mesma posição. */
  sweep(now: number): void {
    if (this.host.state.placedStations.size === 0) return;
    const expired: string[] = [];
    this.host.state.placedStations.forEach((placed, id) => { if (placed.expiresAt > 0 && placed.expiresAt <= now) expired.push(id); });
    for (const id of expired) {
      void this.host.withLock(`placed:${id}`, async () => {
        const placed = this.host.state.placedStations.get(id);
        if (!placed || placed.expiresAt > Date.now()) return;
        this.host.state.placedStations.delete(id);
        this.pending.delete(id);
        const drop = new WorldDropState();
        drop.id = nanoid();
        drop.itemKey = placed.itemKey;
        drop.qty = 1;
        drop.x = placed.x;
        drop.y = placed.y;
        drop.expiresAt = Date.now() + WORLD_DROP_TTL_MS;
        drop.durability = placed.durability;
        this.host.state.worldDrops.set(drop.id, drop);
        console.log(`[WorldRoom] estação de ${placed.ownerName} virou drop: ${placed.itemKey} dur ${placed.durability}/${placed.maxDurability} (${id})`);
        this.host.updateRoomHold();
      });
    }
  }
}
