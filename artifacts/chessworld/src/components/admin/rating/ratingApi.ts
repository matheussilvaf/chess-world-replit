/**
 * HTTP client da página /admin/rating-gambits (Supabase JWT, admin):
 *   GET  {base}/api/admin/rating-config           → { config, saved, updatedAt, tableMissing, tableSql?, schemaReady, schemaCoreReady, schemaError, migrationSql }
 *   PUT  {base}/api/admin/rating-config           → { config }
 *   POST {base}/api/admin/rating-config/reset-all → { count }
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { RatingGambitsConfig } from '../../../shared/rating/RatingShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface RatingConfigResponse {
  config: RatingGambitsConfig | null;
  saved?: boolean;
  updatedAt: string | null;
  tableMissing: boolean;
  tableSql?: string;
  /** true = colunas Glicko-2/gambits, tabelas, liquidação e bônus de campeão prontos. */
  schemaReady: boolean;
  /** true = colunas + liquidação prontas (partidas avaliadas), mesmo que falte a função do bônus de campeão. Servidores antigos não mandam. */
  schemaCoreReady?: boolean;
  schemaError: string | null;
  /** Migração completa (idempotente) para colar no editor SQL do Supabase. */
  migrationSql: string;
}

export function adminApiBase(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return `${httpUrl.replace(/\/api$/, '')}/api/admin`;
}

export async function adminAuthHeaders(purpose: string): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RigApiError(`Faça login no site para ${purpose} (nenhuma sessão ativa).`, 401);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function adminRequest<T>(method: 'GET' | 'PUT' | 'POST', path: string, purpose: string, body?: unknown): Promise<T> {
  const headers = await adminAuthHeaders(purpose);
  let response: Response;
  try {
    response = await fetch(`${adminApiBase()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new RigApiError(`Sem conexão com o servidor (${error instanceof Error ? error.message : 'rede'}).`, 0);
  }
  const text = await response.text();
  let data: Record<string, unknown> | null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${response.status} sem JSON — este endpoint ainda não existe nesse servidor (deploy pendente?).`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new RigApiError(typeof data?.error === 'string' ? data.error : `Falha na requisição (${response.status})`, response.status, {
      tableMissing: data?.tableMissing === true,
      tableSql: typeof data?.tableSql === 'string' ? data.tableSql : undefined,
      details: Array.isArray(data?.details) ? (data.details as string[]) : undefined,
    });
  }
  return data as T;
}

const PURPOSE = 'configurar rating e gambits';

export const ratingApi = {
  get: (): Promise<RatingConfigResponse> => adminRequest('GET', '/rating-config', PURPOSE),
  save: (config: RatingGambitsConfig): Promise<{ config: RatingGambitsConfig }> => adminRequest('PUT', '/rating-config', PURPOSE, config),
  resetAll: (): Promise<{ count: number }> => adminRequest('POST', '/rating-config/reset-all', PURPOSE),
};
