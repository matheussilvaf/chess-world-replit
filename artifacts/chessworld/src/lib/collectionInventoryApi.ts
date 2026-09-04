/**
 * HTTP do inventário de coleta (jogador autenticado; não exige admin).
 *
 *   GET  {base}/api/collection/inventory → { items, tableMissing?, tableSql?,
 *                                            durabilityColumnMissing?, durabilitySql? }
 *   POST {base}/api/collection/collect   → { items }  body: { items: [{itemKey, qty}] }
 *   POST {base}/api/collection/tool-wear → { items, broken }  body: { wear: [{itemKey, hits}] }
 *
 * Mesmo modelo de auth do playerCharacterApi (Bearer JWT da sessão Supabase).
 */
import { getColyseusHttpUrl } from '../config/colyseus';
import { supabase } from './supabase';
import { RigApiError } from '../components/admin/rig-editor/rigApi';

export interface InventoryItemDto {
  itemKey: string;
  qty: number;
  /** Ferramentas: durabilidade restante da cópia em uso; ausente/null = cheia. */
  durability?: number | null;
}

export interface InventoryResponse {
  items: InventoryItemDto[];
  tableMissing?: boolean;
  tableSql?: string;
  /** Coluna `durability` ainda não migrada no Supabase (desgaste não persiste). */
  durabilityColumnMissing?: boolean;
  durabilitySql?: string;
}

export interface ToolWearDto {
  itemKey: string;
  hits: number;
}

export interface ToolWearResponse extends InventoryResponse {
  /** Cópias que quebraram neste lote. */
  broken: Array<{ itemKey: string; count: number }>;
}

function baseUrl(path: string): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  // A base local de dev pode já terminar com /api — nunca gerar /api/api/…
  return `${httpUrl.replace(/\/api$/, '')}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RigApiError('Faça login para usar o inventário (nenhuma sessão ativa).', 401);
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function doFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(baseUrl(path), opts);
  } catch (e) {
    throw new RigApiError(`Sem conexão com o servidor (${e instanceof Error ? e.message : 'rede'}).`, 0);
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${res.status} sem JSON — endpoints do inventário ausentes nesse servidor (deploy pendente?).`,
      res.status,
    );
  }
  if (!res.ok) {
    const obj = (data ?? {}) as Record<string, unknown>;
    const msg = typeof obj.error === 'string' ? obj.error : `Erro ${res.status} do servidor.`;
    const err = new RigApiError(msg, res.status);
    // 503 com tableMissing/durabilityColumnMissing carrega o SQL para o aviso da UI.
    const detailed = err as RigApiError & { tableSql?: string; durabilitySql?: string };
    if (typeof obj.tableSql === 'string') detailed.tableSql = obj.tableSql;
    if (typeof obj.durabilitySql === 'string') detailed.durabilitySql = obj.durabilitySql;
    throw err;
  }
  return data as T;
}

/** Inventário completo do usuário logado. */
export async function fetchInventory(): Promise<InventoryResponse> {
  const headers = await authHeaders();
  const res = await doFetch('/api/collection/inventory', { headers });
  return parseJson<InventoryResponse>(res);
}

/** Registra coletas (lote agregado). Retorna os totais atualizados das chaves enviadas. */
export async function postCollect(items: InventoryItemDto[]): Promise<{ items: InventoryItemDto[] }> {
  const headers = await authHeaders();
  const res = await doFetch('/api/collection/collect', {
    method: 'POST',
    headers,
    body: JSON.stringify({ items }),
  });
  return parseJson<{ items: InventoryItemDto[] }>(res);
}

/** Registra golpes de ferramenta (lote agregado). Retorna o snapshot completo + quebras. */
/**
 * `requestId` identifica o lote: re-tentar com o MESMO id depois de uma resposta
 * perdida não gasta a ferramenta duas vezes (o servidor lembra os lotes aplicados).
 */
export async function postToolWear(wear: ToolWearDto[], requestId: string): Promise<ToolWearResponse> {
  const headers = await authHeaders();
  const res = await doFetch('/api/collection/tool-wear', {
    method: 'POST',
    headers,
    body: JSON.stringify({ wear, requestId }),
  });
  return parseJson<ToolWearResponse>(res);
}
