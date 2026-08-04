/**
 * HTTP client do personagem do jogador (criação de personagem).
 *
 * Mesmo modelo de auth do craftApi: os endpoints /api/me/character exigem
 * sessão Supabase (Bearer JWT); o catálogo de categorias de assets é público.
 *
 *   GET {base}/api/me/character        → { character|null, tableMissing?, tableSql? }
 *   PUT {base}/api/me/character        → { character }   (cria/substitui)
 *   GET {base}/api/asset-category-data → { categories }  (público, cacheado)
 */
import { getColyseusHttpUrl } from '../config/colyseus';
import { supabase } from './supabase';
import { RigApiError } from '../components/admin/rig-editor/rigApi';
import type {
  AssetCategoryLike,
  CharacterAppearanceV1,
  PlayerCharacterConfigV1,
  PlayerClassId,
} from '../shared/characters/PlayerCharacterShapes';

export interface MyCharacterResponse {
  character: PlayerCharacterConfigV1 | null;
  tableMissing?: boolean;
  tableSql?: string;
}

function baseUrl(path: string): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  // A base local de dev pode já terminar com /api — nunca gerar /api/api/…
  return `${httpUrl.replace(/\/api$/, '')}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RigApiError('Faça login para criar seu personagem (nenhuma sessão ativa).', 401);
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function doFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(baseUrl(path), opts);
  } catch (e) {
    throw new RigApiError(`Sem conexão com o servidor (${e instanceof Error ? e.message : 'rede'}).`, 0);
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${res.status} sem JSON — os endpoints do personagem ainda não existem nesse servidor (deploy pendente?).`,
      res.status,
    );
  }
  if (!res.ok) {
    const obj = (data ?? {}) as Record<string, unknown>;
    const msg = typeof obj.error === 'string' ? obj.error : `Erro ${res.status} do servidor.`;
    const errors = Array.isArray(obj.errors)
      ? obj.errors.filter((x): x is string => typeof x === 'string')
      : [];
    const err = new RigApiError(errors.length ? `${msg} ${errors.join('; ')}` : msg, res.status);
    // 503 com tableMissing carrega o SQL para o aviso da UI.
    if (typeof obj.tableSql === 'string') (err as RigApiError & { tableSql?: string }).tableSql = obj.tableSql;
    throw err;
  }
  return data as T;
}

/** Busca o personagem salvo do usuário logado (null = ainda não criou). */
export async function fetchMyCharacter(): Promise<MyCharacterResponse> {
  const headers = await authHeaders();
  const res = await doFetch('/api/me/character', { headers });
  return parseJson<MyCharacterResponse>(res);
}

/** Cria/substitui o personagem do usuário logado. */
export async function saveMyCharacter(
  classId: PlayerClassId,
  appearance: CharacterAppearanceV1,
): Promise<{ character: PlayerCharacterConfigV1 }> {
  const headers = await authHeaders();
  const res = await doFetch('/api/me/character', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ classId, appearance }),
  });
  return parseJson<{ character: PlayerCharacterConfigV1 }>(res);
}

// ------------------------------------------------ categorias públicas (cache)

let categoriesPromise: Promise<Record<string, AssetCategoryLike>> | null = null;

function normalizeCategories(raw: unknown): Record<string, AssetCategoryLike> {
  const out: Record<string, AssetCategoryLike> = {};
  const push = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    const cat = c as Record<string, unknown>;
    const categoryId = typeof cat.categoryId === 'string' ? cat.categoryId : null;
    if (!categoryId) return;
    out[categoryId] = {
      categoryId,
      name: typeof cat.name === 'string' ? cat.name : categoryId,
      parentId: typeof cat.parentId === 'string' ? cat.parentId : null,
      assetRefs: Array.isArray(cat.assetRefs)
        ? cat.assetRefs.filter((r): r is string => typeof r === 'string')
        : [],
    };
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw && typeof raw === 'object') Object.values(raw).forEach(push);
  return out;
}

/** Catálogo público de categorias, cacheado por sessão (falha permite retry). */
export function fetchPublicAssetCategories(): Promise<Record<string, AssetCategoryLike>> {
  if (!categoriesPromise) {
    categoriesPromise = (async () => {
      const res = await doFetch('/api/asset-category-data');
      const body = await parseJson<{ categories: unknown }>(res);
      return normalizeCategories(body.categories);
    })().catch((e) => {
      categoriesPromise = null;
      throw e;
    });
  }
  return categoriesPromise;
}
