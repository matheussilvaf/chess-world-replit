/**
 * HTTP client for the rig admin API (server-side persistence, spec §19).
 *
 * All writes require a Supabase session (Bearer JWT) — there is no anonymous
 * write path. The server exposes:
 *   GET/POST   {base}/api/admin/rigs
 *   GET/PUT/DELETE {base}/api/admin/rigs/:rigId
 */
import { getColyseusHttpUrl, isColyseusConfigured } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { RigConfig } from '../../../shared/combat/RigShapes';

export interface RigListResponse {
  rigs: RigConfig[];
  /** rig_id → updated_at ISO (para "último salvamento"). */
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  invalidIds: string[];
  tableSql?: string;
}

export class RigApiError extends Error {
  status: number;
  tableMissing: boolean;
  tableSql?: string;
  details?: string[];

  constructor(
    message: string,
    status: number,
    opts: { tableMissing?: boolean; tableSql?: string; details?: string[] } = {},
  ) {
    super(message);
    this.name = 'RigApiError';
    this.status = status;
    this.tableMissing = opts.tableMissing ?? false;
    this.tableSql = opts.tableSql;
    this.details = opts.details;
  }
}

function getBaseUrl(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  // In local dev mode the base already ends with /api (same-origin proxy
  // path) — strip it so we never produce /api/api/… (double-prefix trap).
  return `${httpUrl.replace(/\/api$/, '')}/api/admin/rigs`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RigApiError('Faça login no site para editar rigs (nenhuma sessão ativa).', 401);
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, opts);
  } catch (e) {
    throw new RigApiError(
      `Sem conexão com o servidor de rigs (${e instanceof Error ? e.message : 'rede'}).`,
      0,
    );
  }

  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // Non-JSON body (e.g. HTML 404 page) → the deployed server doesn't have
    // the rig endpoints yet. Be explicit instead of failing cryptically.
    throw new RigApiError(
      `O servidor respondeu ${res.status} sem JSON — os endpoints de rig ainda não existem nesse servidor (deploy pendente?).`,
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

export const rigApi = {
  isConfigured: (): boolean => isColyseusConfigured(),
  list: (): Promise<RigListResponse> => request<RigListResponse>('GET', ''),
  get: (rigId: string): Promise<{ rig: RigConfig }> => request('GET', `/${rigId}`),
  create: (rig: RigConfig): Promise<{ rig: RigConfig }> => request('POST', '', rig),
  save: (rig: RigConfig): Promise<{ rig: RigConfig }> => request('PUT', `/${rig.rigId}`, rig),
  remove: (rigId: string): Promise<{ ok: boolean }> => request('DELETE', `/${rigId}`),
};
