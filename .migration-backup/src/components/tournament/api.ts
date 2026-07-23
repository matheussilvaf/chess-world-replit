import { getColyseusHttpUrl, isColyseusConfigured } from '../../config/colyseus';
import { supabase } from '../../lib/supabase';

function getBaseUrl(): string {
  const httpUrl = getColyseusHttpUrl();
  if (!httpUrl) throw new Error('Colyseus endpoint not configured');
  return `${httpUrl}/api/tournament`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

async function request(method: string, path: string, body?: any) {
  const base = getBaseUrl();
  const headers = await getAuthHeaders();
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function requestNoAuth(method: string, path: string) {
  const base = getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const tournamentApi = {
  isConfigured: () => isColyseusConfigured(),
  getHealthStatus: () => requestNoAuth('GET', '/health'),
  getEngineDiagnostics: () => requestNoAuth('GET', '/engine-diagnostics'),
  getEngineStatus: () => request('GET', '/engine-status'),
  listPresets: () => request('GET', '/presets'),
  listTournaments: () => request('GET', '/tournaments'),
  getTournament: (id: string) => request('GET', `/tournaments/${id}`),
  createTournament: (name: string) => request('POST', '/tournaments', { name }),
  deleteTournament: (id: string) => request('DELETE', `/tournaments/${id}`),
  addPlayer: (id: string, name: string, rating: number) =>
    request('POST', `/tournaments/${id}/players`, { name, rating }),
  removePlayer: (id: string, playerId: string) =>
    request('DELETE', `/tournaments/${id}/players/${playerId}`),
  updatePlayer: (id: string, playerId: string, name: string, rating: number) =>
    request('PUT', `/tournaments/${id}/players/${playerId}`, { name, rating }),
  clearPlayers: (id: string) => request('DELETE', `/tournaments/${id}/players`),
  loadPreset: (id: string, presetIndex: number) =>
    request('POST', `/tournaments/${id}/load-preset`, { presetIndex }),
  setRoundMode: (id: string, mode: string, manualCount?: number) =>
    request('POST', `/tournaments/${id}/round-mode`, { mode, manualCount }),
  setInitialColor: (id: string, color: string) =>
    request('POST', `/tournaments/${id}/initial-color`, { color }),
  getRoundInfo: (id: string) => request('GET', `/tournaments/${id}/round-info`),
  startTournament: (id: string) => request('POST', `/tournaments/${id}/start`),
  generateNextRound: (id: string) => request('POST', `/tournaments/${id}/next-round`),
  setResult: (id: string, round: number, board: number, result: string, isPlayed: boolean) =>
    request('POST', `/tournaments/${id}/rounds/${round}/boards/${board}/result`, { result, isPlayed }),
  finalizeRound: (id: string, round: number) =>
    request('POST', `/tournaments/${id}/rounds/${round}/finalize`),
  withdrawPlayer: (id: string, playerId: string) =>
    request('POST', `/tournaments/${id}/players/${playerId}/withdraw`),
  correctRound: (id: string, round: number) =>
    request('POST', `/tournaments/${id}/rounds/${round}/correct`),
  getHistories: (id: string) => request('GET', `/tournaments/${id}/histories`),
  importTournament: (data: any) => request('POST', '/tournaments/import', data),
};
