/**
 * HTTP client for the weapon catalog admin API (spec §25).
 *
 * Same auth model as rigApi: every call requires a Supabase session (Bearer
 * JWT). Endpoints:
 *   GET  {base}/api/admin/weapon-families
 *   PUT  {base}/api/admin/weapon-families/:familyId
 *   GET/POST {base}/api/admin/weapon-hitbox-profiles
 *   GET/PUT/DELETE {base}/api/admin/weapon-hitbox-profiles/:profileId
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type {
  WeaponFamilyConfig,
  WeaponHitboxProfile,
} from '../../../shared/combat/WeaponShapes';
import { RigApiError } from './rigApi';

export interface WeaponFamiliesResponse {
  families: Record<string, WeaponFamilyConfig>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  invalidIds: string[];
  tableSql?: string;
}

export interface WeaponProfilesResponse {
  profiles: WeaponHitboxProfile[];
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  invalidIds: string[];
  tableSql?: string;
}

/** 409 payload of DELETE — profile still associated to families (spec §28). */
export interface ProfileInUseInfo {
  inUseBy: string[];
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
    throw new RigApiError('Faça login no site para editar perfis de arma (nenhuma sessão ativa).', 401);
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(baseUrl(path), opts);
  } catch (e) {
    throw new RigApiError(
      `Sem conexão com o servidor (${e instanceof Error ? e.message : 'rede'}).`,
      0,
    );
  }

  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${res.status} sem JSON — os endpoints de armas ainda não existem nesse servidor (deploy pendente?).`,
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
        // DELETE 409 carries the families still using the profile.
        details: Array.isArray(data?.details)
          ? (data.details as string[])
          : Array.isArray(data?.inUseBy)
            ? (data.inUseBy as string[])
            : undefined,
      },
    );
  }
  return data as T;
}

export const weaponApi = {
  families: {
    list: (): Promise<WeaponFamiliesResponse> =>
      request<WeaponFamiliesResponse>('GET', '/api/admin/weapon-families'),
    save: (config: WeaponFamilyConfig): Promise<{ family: WeaponFamilyConfig }> =>
      request('PUT', `/api/admin/weapon-families/${encodeURIComponent(config.familyId)}`, config),
  },
  profiles: {
    list: (): Promise<WeaponProfilesResponse> =>
      request<WeaponProfilesResponse>('GET', '/api/admin/weapon-hitbox-profiles'),
    create: (profile: WeaponHitboxProfile): Promise<{ profile: WeaponHitboxProfile }> =>
      request('POST', '/api/admin/weapon-hitbox-profiles', profile),
    save: (profile: WeaponHitboxProfile): Promise<{ profile: WeaponHitboxProfile }> =>
      request('PUT', `/api/admin/weapon-hitbox-profiles/${profile.id}`, profile),
    /** `mode: 'dissociate'` clears every family association before deleting. */
    remove: (profileId: string, mode?: 'dissociate'): Promise<{ ok: boolean; dissociated: string[] }> =>
      request('DELETE', `/api/admin/weapon-hitbox-profiles/${profileId}${mode ? `?mode=${mode}` : ''}`),
  },
};
