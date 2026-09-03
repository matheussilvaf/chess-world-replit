/**
 * HTTP client do admin de estações (spec: /admin/stations).
 *
 * Mesmo modelo de auth do craftApi: toda chamada exige sessão Supabase
 * (Bearer JWT). Endpoints:
 *   GET {base}/api/admin/craft-stations
 *   PUT {base}/api/admin/craft-stations/:stationId
 *   PUT {base}/api/admin/craft-stations/members/:itemId   ({ stationId | null })
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { StationConfig } from '../../../shared/craft/StationShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface StationsAdminResponse {
  /** Sempre as 4 estações, já mescladas com os defaults e ordenadas. */
  stations: StationConfig[];
  /** itemId → stationId. */
  members: Record<string, string>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  invalidIds: string[];
  tableSql?: string;
}

function baseUrl(path: string): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  // Local dev base may already end with /api — never produce /api/api/…
  return `${httpUrl.replace(/\/api$/, '')}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RigApiError('Faça login no site para configurar as estações (nenhuma sessão ativa).', 401);
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${res.status} sem JSON — os endpoints de estações ainda não existem nesse servidor (deploy pendente?).`,
      res.status,
    );
  }
  if (!res.ok) {
    throw new RigApiError(
      typeof data?.error === 'string' ? data.error : `Falha na requisição (${res.status})`,
      res.status,
      {
        tableMissing: data?.tableMissing === true,
        tableSql: typeof data?.tableSql === 'string' ? data.tableSql : undefined,
        details: Array.isArray(data?.details) ? (data.details as string[]) : undefined,
      },
    );
  }
  return data as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(baseUrl(path), opts);
  } catch (e) {
    throw new RigApiError(`Sem conexão com o servidor (${e instanceof Error ? e.message : 'rede'}).`, 0);
  }
  return parseResponse<T>(res);
}

export const stationsApi = {
  list: (): Promise<StationsAdminResponse> =>
    request<StationsAdminResponse>('GET', '/api/admin/craft-stations'),
  saveStation: (config: StationConfig): Promise<{ station: StationConfig }> =>
    request<{ station: StationConfig }>(
      'PUT',
      `/api/admin/craft-stations/${encodeURIComponent(String(config.stationId))}`,
      config,
    ),
  setMember: (itemId: string, stationId: string | null): Promise<{ itemId: string; stationId: string | null }> =>
    request<{ itemId: string; stationId: string | null }>(
      'PUT',
      `/api/admin/craft-stations/members/${encodeURIComponent(itemId)}`,
      { stationId },
    ),
};
