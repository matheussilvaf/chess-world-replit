import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { CollectionWorldConfig } from '../../../shared/collection/CollectionShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface CollectionWorldConfigResponse {
  config: CollectionWorldConfig | null;
  updatedAt: string | null;
  tableMissing: boolean;
  tableSql?: string;
}

function baseUrl(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) {
    throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  }
  return `${httpUrl.replace(/\/api$/, '')}/api/admin/collection-world-config`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RigApiError(
      'Faça login no site para configurar o mundo de coleta (nenhuma sessão ativa).',
      401,
    );
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: 'GET' | 'PUT', body?: unknown): Promise<T> {
  const headers = await authHeaders();
  let response: Response;
  try {
    response = await fetch(baseUrl(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new RigApiError(
      `Sem conexão com o servidor (${error instanceof Error ? error.message : 'rede'}).`,
      0,
    );
  }

  const text = await response.text();
  let data: Record<string, unknown> | null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${response.status} sem JSON — o endpoint do mundo de coleta ainda não existe nesse servidor.`,
      response.status,
    );
  }

  if (!response.ok) {
    throw new RigApiError(
      typeof data?.error === 'string' ? data.error : `Falha na requisição (${response.status})`,
      response.status,
      {
        tableMissing: data?.tableMissing === true,
        tableSql: typeof data?.tableSql === 'string' ? data.tableSql : undefined,
        details: Array.isArray(data?.details) ? (data.details as string[]) : undefined,
      },
    );
  }
  return data as T;
}

export const collectionApi = {
  get: (): Promise<CollectionWorldConfigResponse> => request('GET'),
  save: (config: CollectionWorldConfig): Promise<{ config: CollectionWorldConfig }> =>
    request('PUT', config),
};