/**
 * HTTP client do Assets Controller (spec: /admin/assets-controller).
 *
 * Mesmo modelo de auth do craftApi: toda chamada exige sessão Supabase
 * (Bearer JWT). Endpoints:
 *   GET    {base}/api/admin/asset-categories
 *   PUT    {base}/api/admin/asset-categories/:categoryId
 *   DELETE {base}/api/admin/asset-categories/:categoryId   (409 → usedBy)
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { AssetCategoryConfig } from '../../../shared/assets/AssetCategoryShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface AssetCategoriesResponse {
  categories: Record<string, AssetCategoryConfig>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  invalidIds: string[];
  tableSql?: string;
}

function baseUrl(path: string): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return `${httpUrl.replace(/\/api$/, '')}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RigApiError('Faça login no site para gerenciar as categorias (nenhuma sessão ativa).', 401);
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
      `O servidor respondeu ${res.status} sem JSON — os endpoints do assets controller ainda não existem nesse servidor (deploy pendente?).`,
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
        details: Array.isArray(data?.details)
          ? (data.details as string[])
          : Array.isArray(data?.usedBy)
            ? (data.usedBy as string[])
            : undefined,
      },
    );
  }
  return data as T;
}

export const assetsApi = {
  categories: {
    list: (): Promise<AssetCategoriesResponse> =>
      request<AssetCategoriesResponse>('GET', '/api/admin/asset-categories'),
    save: (config: AssetCategoryConfig): Promise<{ category: AssetCategoryConfig }> =>
      request<{ category: AssetCategoryConfig }>(
        'PUT',
        `/api/admin/asset-categories/${encodeURIComponent(config.categoryId)}`,
        config,
      ),
    remove: (categoryId: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>(
        'DELETE',
        `/api/admin/asset-categories/${encodeURIComponent(categoryId)}`,
      ),
  },
};
