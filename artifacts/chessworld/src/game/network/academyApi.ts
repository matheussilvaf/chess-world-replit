import { getColyseusHttpUrl } from '../../config/colyseus';
import { supabase } from '../../lib/supabase';
import type { AcademyBotsResponse, AcademyBotsUpdateRequest, BotGameRecord } from '../../shared/academy/AcademyShapes';

function url(path: string): string {
  const base = getColyseusHttpUrl();
  if (!base) throw new Error('Servidor Colyseus não configurado.');
  return `${base.replace(/\/api$/, '')}/api/${path}`;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET' || path.endsWith('/me')) {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('Faça login para continuar.');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await response.text();
  let result: T & { error?: string };
  try { result = JSON.parse(text) as T & { error?: string }; }
  catch { throw new Error(`A API da Academia não está disponível (${response.status}); verifique o servidor.`); }
  if (!response.ok) throw new Error(result.error || `Falha na requisição (${response.status}).`);
  return result;
}

export const academyApi = {
  getBots: () => request<AcademyBotsResponse>('academy/bots'),
  saveBots: (bots: AcademyBotsUpdateRequest['bots']) => request<AcademyBotsResponse>('admin/academy/bots', 'PUT', { bots }),
  listMyBotGames: () => request<{ games: BotGameRecord[]; schemaMissing: boolean }>('academy/bot-games/me'),
};