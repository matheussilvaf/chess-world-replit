/**
 * HTTP client da página /admin/bigchess (Supabase JWT, admin):
 *   GET {base}/api/admin/bigchess-config → { config, saved, updatedAt, tableMissing, tableSql?, tablesSql }
 *   PUT {base}/api/admin/bigchess-config → { config }
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { BigChessConfig } from '../../../shared/bigchess/BigChessShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface BigChessConfigResponse {
  config: BigChessConfig | null;
  /** false = nada persistido ainda (a página mostra os defaults). */
  saved?: boolean;
  updatedAt: string | null;
  tableMissing: boolean;
  tableSql?: string;
  /** SQL das três tabelas (config, peças, carteiras) — sempre presente. */
  tablesSql?: string;
}

function baseUrl(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return `${httpUrl.replace(/\/api$/, '')}/api/admin/bigchess-config`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RigApiError('Faça login no site para configurar o Big Chessboard (nenhuma sessão ativa).', 401);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: 'GET' | 'PUT', body?: unknown): Promise<T> {
  const headers = await authHeaders();
  let response: Response;
  try {
    response = await fetch(baseUrl(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new RigApiError(`Sem conexão com o servidor (${error instanceof Error ? error.message : 'rede'}).`, 0);
  }
  const text = await response.text();
  let data: Record<string, unknown> | null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${response.status} sem JSON — o endpoint do Big Chessboard ainda não existe nesse servidor (deploy pendente?).`,
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

export const bigChessApi = {
  get: (): Promise<BigChessConfigResponse> => request('GET'),
  save: (config: BigChessConfig): Promise<{ config: BigChessConfig }> => request('PUT', config),
};
