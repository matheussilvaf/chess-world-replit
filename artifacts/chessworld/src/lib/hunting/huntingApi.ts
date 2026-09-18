import { getColyseusHttpUrl } from '../../config/colyseus';
import { supabase } from '../supabase';
import type { HuntingConfig, HuntingManifest } from '../../shared/hunting/HuntingShapes';
import { HUNTING_MANIFEST_PATH } from '../../shared/hunting/HuntingShapes';
import { RigApiError } from '../../components/admin/rig-editor/rigApi';

export interface HuntingConfigResponse {
  config: HuntingConfig | null;
  saved: boolean;
  tableMissing: boolean;
  tableSql: string;
  playerTableSql: string;
}

function configUrl(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return `${httpUrl.replace(/\/api$/, '')}/api/admin/hunting-config`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RigApiError('Faça login no site para configurar a caça.', 401);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: 'GET' | 'PUT', body?: unknown): Promise<T> {
  const headers = await authHeaders();
  let response: Response;
  try {
    response = await fetch(configUrl(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (cause) {
    throw new RigApiError(`Sem conexão com o servidor (${cause instanceof Error ? cause.message : 'rede'}).`, 0);
  }
  const text = await response.text();
  let data: Record<string, unknown> | null;
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    throw new RigApiError(`O servidor respondeu ${response.status} sem JSON.`, response.status);
  }
  if (!response.ok) {
    throw new RigApiError(typeof data?.error === 'string' ? data.error : `Falha na requisição (${response.status})`, response.status, {
      tableMissing: response.status === 503 || data?.tableMissing === true,
      tableSql: typeof data?.tableSql === 'string' ? data.tableSql : undefined,
    });
  }
  return data as T;
}

export const huntingApi = {
  get: (): Promise<HuntingConfigResponse> => request('GET'),
  save: (config: HuntingConfig): Promise<{ config: HuntingConfig; saved: true }> => request('PUT', config),
  manifest: async (): Promise<HuntingManifest> => {
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const response = await fetch(`${base}${HUNTING_MANIFEST_PATH}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Manifesto de animais indisponível (${response.status}).`);
    return response.json() as Promise<HuntingManifest>;
  },
};