/**
 * StationRepository — estações de criação + vínculo item→estação
 * (spec: /admin/stations).
 *
 * Storage (service-role, mesmo padrão de craft_items):
 *   - `craft_stations`        station_id text PK, config jsonb, updated_at
 *   - `craft_station_members` item_id text PK, station_id text, updated_at
 *
 * As 4 estações padrão NÃO são semeadas por INSERT: o merge com os defaults
 * de código acontece na leitura (mergeStationsWithDefaults) — tabela vazia ou
 * ausente ainda rende as 4 estações no GET, e o primeiro PUT persiste.
 */
import {
  isStationId,
  mergeStationsWithDefaults,
  validateStationConfig,
  type StationConfig,
} from '../shared/craft/StationShapes.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const STATION_TABLES_SQL = `CREATE TABLE IF NOT EXISTS craft_stations (
  station_id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE craft_stations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS craft_station_members (
  item_id text PRIMARY KEY,
  station_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE craft_station_members ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

export interface StationListResult {
  records: Record<string, StationConfig>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  error: string | null;
  invalidIds: string[];
}

export interface StationMembersResult {
  /** itemId → stationId. */
  records: Record<string, string>;
  tableMissing: boolean;
  error: string | null;
  invalidIds: string[];
}

export interface StationWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

interface StationRow {
  station_id: string;
  config: unknown;
  updated_at?: string;
}

interface MemberRow {
  item_id: string;
  station_id: string;
}

const emptyStations = (over: Partial<StationListResult> = {}): StationListResult => ({
  records: {},
  updatedAt: {},
  tableMissing: false,
  error: null,
  invalidIds: [],
  ...over,
});

const emptyMembers = (over: Partial<StationMembersResult> = {}): StationMembersResult => ({
  records: {},
  tableMissing: false,
  error: null,
  invalidIds: [],
  ...over,
});

// ---------------------------------------------------------------- stations

export async function listStations(): Promise<StationListResult> {
  const client = getServiceClient();
  if (!client) return emptyStations({ error: PERSISTENCE_UNAVAILABLE });
  const { data, error } = await client
    .from('craft_stations')
    .select('station_id, config, updated_at')
    .order('station_id');
  if (error) {
    if (isTableMissing(error.code)) return emptyStations({ tableMissing: true });
    return emptyStations({ error: error.message });
  }
  const result = emptyStations();
  for (const row of (data ?? []) as StationRow[]) {
    const validated = validateStationConfig(row.config);
    const config = row.config as StationConfig;
    if (validated.ok && config.stationId === row.station_id) {
      result.records[row.station_id] = config;
      if (row.updated_at) result.updatedAt[row.station_id] = row.updated_at;
    } else {
      console.warn(`[stations] stored station "${row.station_id}" is invalid; skipping`);
      result.invalidIds.push(row.station_id);
    }
  }
  return result;
}

export async function saveStation(config: StationConfig): Promise<StationWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { station_id: config.stationId, config, updated_at: new Date().toISOString() };
  const { error } = await client.from('craft_stations').upsert(row, { onConflict: 'station_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateStationCaches();
  return { ok: true, tableMissing: false, error: null };
}

// ----------------------------------------------------------------- members

export async function listStationMembers(): Promise<StationMembersResult> {
  const client = getServiceClient();
  if (!client) return emptyMembers({ error: PERSISTENCE_UNAVAILABLE });
  const { data, error } = await client
    .from('craft_station_members')
    .select('item_id, station_id')
    .order('item_id');
  if (error) {
    if (isTableMissing(error.code)) return emptyMembers({ tableMissing: true });
    return emptyMembers({ error: error.message });
  }
  const result = emptyMembers();
  for (const row of (data ?? []) as MemberRow[]) {
    // Estação desconhecida (ex.: linha antiga de um id removido) não some em
    // silêncio — vai para invalidIds e o admin enxerga.
    if (isStationId(row.station_id)) {
      result.records[row.item_id] = row.station_id;
    } else {
      console.warn(`[stations] member "${row.item_id}" points at unknown station "${row.station_id}"`);
      result.invalidIds.push(row.item_id);
    }
  }
  return result;
}

export async function saveStationMember(itemId: string, stationId: string): Promise<StationWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const row = { item_id: itemId, station_id: stationId, updated_at: new Date().toISOString() };
  const { error } = await client
    .from('craft_station_members')
    .upsert(row, { onConflict: 'item_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateStationCaches();
  return { ok: true, tableMissing: false, error: null };
}

export async function deleteStationMember(itemId: string): Promise<StationWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } = await client.from('craft_station_members').delete().eq('item_id', itemId);
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateStationCaches();
  return { ok: true, tableMissing: false, error: null };
}

// ------------------------------------------------------------------- cache

export interface StationsPublicData {
  /** Lista já mesclada com os defaults, na ordem oficial. */
  stations: StationConfig[];
  /** itemId → stationId. */
  members: Record<string, string>;
}

let publicCache: { data: StationsPublicData; expiresAt: number } | null = null;

export function invalidateStationCaches(): void {
  publicCache = null;
}

/** Snapshot cacheado para clientes do jogo. Erros resolvem para defaults. */
export async function getStationsDataCached(): Promise<StationsPublicData> {
  if (publicCache && Date.now() < publicCache.expiresAt) return publicCache.data;
  const [stations, members] = await Promise.all([listStations(), listStationMembers()]);
  const data: StationsPublicData = {
    stations: mergeStationsWithDefaults(stations.error ? {} : stations.records),
    members: members.error ? {} : members.records,
  };
  publicCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}
