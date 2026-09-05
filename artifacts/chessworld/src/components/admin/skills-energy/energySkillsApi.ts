/**
 * HTTP client da página /admin/skills-energy (Supabase JWT, admin):
 *   GET {base}/api/admin/energy-skills-config → { config, updatedAt, tableMissing, tableSql?, progressTableSql }
 *   PUT {base}/api/admin/energy-skills-config → { config }
 */
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import type { EnergySkillsConfig } from '../../../shared/progress/EnergySkillsShapes';
import { RigApiError } from '../rig-editor/rigApi';

export interface EnergySkillsConfigResponse {
  config: EnergySkillsConfig;
  updatedAt: string | null;
  tableMissing: boolean;
  tableSql?: string;
  /** SQL da tabela de progresso por jogador (player_progress) — sempre presente. */
  progressTableSql: string;
}

function baseUrl(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new RigApiError('Servidor Colyseus não configurado (VITE_COLYSEUS_URL).', 0);
  return `${httpUrl.replace(/\/api$/, '')}/api/admin/energy-skills-config`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RigApiError('Faça login no site para configurar energia e habilidades (nenhuma sessão ativa).', 401);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: 'GET' | 'PUT', body?: unknown): Promise<T> {
  const headers = await authHeaders();
  let response: Response;
  try {
    response = await fetch(baseUrl(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new RigApiError(`Sem conexão com o servidor (${error instanceof Error ? error.message : 'rede'}).`, 0);
  }
  const text = await response.text();
  let data: Record<string, unknown> | null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new RigApiError(
      `O servidor respondeu ${response.status} sem JSON — o endpoint de energia/habilidades ainda não existe nesse servidor (deploy pendente?).`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new RigApiError(typeof data?.error === 'string' ? data.error : `Falha na requisição (${response.status})`, response.status, {
      tableMissing: data?.tableMissing === true,
      tableSql: typeof data?.tableSql === 'string' ? data.tableSql : undefined,
      details: Array.isArray(data?.details) ? (data.details as string[]) : undefined,
    });
  }
  return data as T;
}

export const energySkillsApi = {
  get: (): Promise<EnergySkillsConfigResponse> => request('GET'),
  save: (config: EnergySkillsConfig): Promise<{ config: EnergySkillsConfig }> => request('PUT', config),
};
