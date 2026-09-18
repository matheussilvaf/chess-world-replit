import { getColyseusHttpUrl } from '../../config/colyseus';
import { supabase } from '../supabase';
import type { HuntingConfig, HuntingManifest } from '../../shared/hunting/HuntingShapes';
import { HUNTING_MANIFEST_PATH, parseHuntingConfig } from '../../shared/hunting/HuntingShapes';
import type { HuntingMotionConfig } from '../../shared/hunting/HuntingMotion';
import { RigApiError } from '../../components/admin/rig-editor/rigApi';

export interface HuntingConfigResponse {
  config: HuntingConfig | null;
  saved: boolean;
  tableMissing: boolean;
  tableSql: string;
  playerTableSql: string;
}

function serverBase(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return httpUrl.replace(/\/api$/, '');
}
function configUrl(): string { return `${serverBase()}/api/admin/hunting-config`; }

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RigApiError('Faça login no site para configurar a caça.', 401);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: 'GET' | 'PUT', body?: unknown, path = ''): Promise<T> {
  const headers = await authHeaders();
  let response: Response;
  try {
    response = await fetch(`${configUrl()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  /** Config as the game servers see it (public, cached ~30 s on the server) — no login needed. */
  publicConfig: async (): Promise<HuntingConfig> => {
    const response = await fetch(`${serverBase()}/api/hunting-config`, { cache: 'no-store' });
    if (!response.ok) throw new RigApiError(`Configuração da caça indisponível (${response.status}).`, response.status);
    const data = await response.json() as { config: unknown };
    return parseHuntingConfig(data.config);
  },
  /**
   * Saves only the leap (`motion`): the server merges it into the stored document, so the bench never
   * touches the rest of the config. A server deployed before this endpoint existed (404) gets the
   * whole document instead (read → merge → write from here).
   */
  saveMotion: async (motion: HuntingMotionConfig): Promise<{ config: HuntingConfig; saved: true }> => {
    try {
      return await request('PUT', motion, '/motion');
    } catch (cause) {
      if (!(cause instanceof RigApiError) || cause.status !== 404) throw cause;
    }
    const current = await request<HuntingConfigResponse>('GET');
    const base = current.config ? parseHuntingConfig(current.config) : parseHuntingConfig(null);
    return request('PUT', { ...base, motion });
  },
  manifest: async (): Promise<HuntingManifest> => {
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const response = await fetch(`${base}${HUNTING_MANIFEST_PATH}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Manifesto de animais indisponível (${response.status}).`);
    return response.json() as Promise<HuntingManifest>;
  },
};