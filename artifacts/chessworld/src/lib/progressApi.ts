/**
 * HTTP de energia + habilidades do jogador (autenticado; não exige admin).
 *
 *   GET  {base}/api/progress/me        → ProgressSnapshot
 *   POST {base}/api/progress/activity  → ProgressSnapshot  body: { events, requestId }
 *   GET  {base}/api/energy-skills-config → { config } (público, cacheado)
 *
 * Mesmo modelo de auth do collectionInventoryApi (Bearer JWT da sessão Supabase).
 */
import { getColyseusHttpUrl } from '../config/colyseus';
import { supabase } from './supabase';
import { RigApiError } from '../components/admin/rig-editor/rigApi';
import type { ActivityEvent, EnergySkillsConfig, ProgressSnapshot } from '../shared/progress/EnergySkillsShapes';

function baseUrl(path: string): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return `${httpUrl.replace(/\/api$/, '')}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RigApiError('Faça login para registrar progresso (nenhuma sessão ativa).', 401);
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
      `O servidor respondeu ${res.status} sem JSON — endpoints de progresso ausentes nesse servidor (deploy pendente?).`,
      res.status,
    );
  }
  if (!res.ok) {
    const obj = (data ?? {}) as Record<string, unknown>;
    const msg = typeof obj.error === 'string' ? obj.error : `Erro ${res.status} do servidor.`;
    throw new RigApiError(msg, res.status);
  }
  return data as T;
}

export async function fetchMyProgress(): Promise<ProgressSnapshot> {
  const headers = await authHeaders();
  return parseJson<ProgressSnapshot>(await doFetch('/api/progress/me', { headers }));
}

/** Lote de golpes/nós do mapa; `requestId` torna a re-tentativa idempotente. */
export async function postActivity(events: ActivityEvent[], requestId: string): Promise<ProgressSnapshot> {
  const headers = await authHeaders();
  const res = await doFetch('/api/progress/activity', { method: 'POST', headers, body: JSON.stringify({ events, requestId }) });
  return parseJson<ProgressSnapshot>(res);
}

/** Config pública (limiares, velocidade fraco, comidas) — sem login. */
export async function fetchPublicEnergySkillsConfig(): Promise<EnergySkillsConfig> {
  const res = await doFetch('/api/energy-skills-config');
  const data = await parseJson<{ config: EnergySkillsConfig }>(res);
  return data.config;
}
