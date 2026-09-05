/**
 * Badges dos itens da página de receitas (`craft_item_badges`): uma linha por
 * item com a lista de badges em jsonb. Service-role only (RLS sem políticas).
 */
import { normalizeCraftBadges, type CraftBadgeMap } from '../shared/craft/CraftBadges.js';
import { PERSISTENCE_UNAVAILABLE, getServiceClient, isTableMissing } from '../rigs/serviceSupabase.js';

export const CRAFT_BADGES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS craft_item_badges (
  item_id text PRIMARY KEY,
  badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE craft_item_badges ENABLE ROW LEVEL SECURITY;`;

const CACHE_TTL_MS = 30_000;

export interface CraftBadgesResult {
  records: CraftBadgeMap;
  tableMissing: boolean;
  error: string | null;
}

export interface CraftBadgesWriteResult {
  ok: boolean;
  tableMissing: boolean;
  error: string | null;
}

interface BadgeRow {
  item_id: string;
  badges: unknown;
}

export async function listCraftBadges(): Promise<CraftBadgesResult> {
  const client = getServiceClient();
  if (!client) return { records: {}, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { data, error } = await client.from('craft_item_badges').select('item_id, badges').order('item_id');
  if (error) {
    if (isTableMissing(error.code)) return { records: {}, tableMissing: true, error: null };
    return { records: {}, tableMissing: false, error: error.message };
  }
  const records: CraftBadgeMap = {};
  for (const row of (data ?? []) as BadgeRow[]) {
    const normalized = normalizeCraftBadges(row.badges);
    if (!normalized.ok) {
      console.warn(`[craft] badges inválidas para "${row.item_id}" ignoradas: ${normalized.error}`);
      continue;
    }
    if (normalized.badges.length > 0) records[row.item_id] = normalized.badges;
  }
  return { records, tableMissing: false, error: null };
}

/** Lista vazia apaga a linha (item sem badges não ocupa tabela). */
export async function saveCraftBadges(itemId: string, badges: string[]): Promise<CraftBadgesWriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, tableMissing: false, error: PERSISTENCE_UNAVAILABLE };
  const { error } =
    badges.length === 0
      ? await client.from('craft_item_badges').delete().eq('item_id', itemId)
      : await client
          .from('craft_item_badges')
          .upsert({ item_id: itemId, badges, updated_at: new Date().toISOString() }, { onConflict: 'item_id' });
  if (error) {
    if (isTableMissing(error.code)) return { ok: false, tableMissing: true, error: null };
    return { ok: false, tableMissing: false, error: error.message };
  }
  invalidateCraftBadgeCache();
  return { ok: true, tableMissing: false, error: null };
}

// ------------------------------------------------------------------- cache

let cache: { map: CraftBadgeMap; expiresAt: number } | null = null;

export function invalidateCraftBadgeCache(): void {
  cache = null;
}

/** itemId → badges, cacheado para o jogo e para o progressService. Erros resolvem para {}. */
export async function getCraftBadgesCached(): Promise<CraftBadgeMap> {
  if (cache && Date.now() < cache.expiresAt) return cache.map;
  const result = await listCraftBadges();
  cache = { map: result.records, expiresAt: Date.now() + CACHE_TTL_MS };
  return result.records;
}
