/**
 * HTTP client for the craft admin API (spec: /admin/craft).
 *
 * Same auth model as weaponApi: every call requires a Supabase session
 * (Bearer JWT). Endpoints:
 *   GET  {base}/api/admin/craft-items
 *   PUT  {base}/api/admin/craft-items/:itemId
 *   DELETE {base}/api/admin/craft-items/:itemId          (409 → usedBy)
 *   POST {base}/api/admin/craft-items/:itemId/image      (bytes crus image/* → { imageUrl })
 *   GET  {base}/api/admin/craft-recipes
 *   PUT  {base}/api/admin/craft-recipes/:targetId
 *   DELETE {base}/api/admin/craft-recipes/:targetId
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { CraftItemConfig, CraftRecipeConfig } from '../../../shared/craft/CraftShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface CraftItemsResponse {
  items: Record<string, CraftItemConfig>;
  updatedAt: Record<string, string>;
  tableMissing: boolean;
  invalidIds: string[];
  tableSql?: string;
}

export interface CraftRecipesResponse {
  recipes: Record<string, CraftRecipeConfig>;
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
    throw new RigApiError('Faça login no site para configurar o craft (nenhuma sessão ativa).', 401);
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function doFetch(path: string, opts: RequestInit): Promise<Response> {
  try {
    return await fetch(baseUrl(path), opts);
  } catch (e) {
    throw new RigApiError(
      `Sem conexão com o servidor (${e instanceof Error ? e.message : 'rede'}).`,
      0,
    );
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      res.status === 413
        ? 'Arquivo grande demais para o servidor (limite de 4MB por imagem).'
        : `O servidor respondeu ${res.status} sem JSON — os endpoints de craft ainda não existem nesse servidor (deploy pendente?).`,
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
        // DELETE 409 carries the recipes still using the item.
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return parseResponse<T>(await doFetch(path, opts));
}

/**
 * O ícone vai como BYTES CRUS (Content-Type image/*), nunca JSON/base64: o
 * @colyseus/tools registra um express.json() de 100kb antes de qualquer
 * middleware nosso, que derrubaria o payload com 413. O data URL (usado no
 * preview local) vira Blob aqui na fronteira da API.
 */
async function uploadImageRaw(itemId: string, dataUrl: string): Promise<{ imageUrl: string }> {
  const auth = await authHeaders();
  const blob = await (await fetch(dataUrl)).blob();
  const res = await doFetch(`/api/admin/craft-items/${encodeURIComponent(itemId)}/image`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  return parseResponse<{ imageUrl: string }>(res);
}

export const craftApi = {
  items: {
    list: (): Promise<CraftItemsResponse> => request<CraftItemsResponse>('GET', '/api/admin/craft-items'),
    save: (config: CraftItemConfig): Promise<{ item: CraftItemConfig }> =>
      request<{ item: CraftItemConfig }>('PUT', `/api/admin/craft-items/${encodeURIComponent(config.itemId)}`, config),
    remove: (itemId: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>('DELETE', `/api/admin/craft-items/${encodeURIComponent(itemId)}`),
    uploadImage: uploadImageRaw,
  },
  recipes: {
    list: (): Promise<CraftRecipesResponse> => request<CraftRecipesResponse>('GET', '/api/admin/craft-recipes'),
    save: (config: CraftRecipeConfig): Promise<{ recipe: CraftRecipeConfig }> =>
      request<{ recipe: CraftRecipeConfig }>('PUT', `/api/admin/craft-recipes/${encodeURIComponent(config.targetId)}`, config),
    remove: (targetId: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>('DELETE', `/api/admin/craft-recipes/${encodeURIComponent(targetId)}`),
  },
};
