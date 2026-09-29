import { getColyseusHttpUrl } from '../../config/colyseus';
import { supabase } from '../../lib/supabase';
import type { AcademyBotsResponse, AcademyBotsUpdateRequest, BotGameRecord } from '../../shared/academy/AcademyShapes';
import type { BattleRewardConfig, DailyConfigUpsertRequest, DailyPinUpsertRequest, DailyDrawResponse, PuzzleAdminConfigResponse, PuzzleCountResponse, PuzzleLookupResponse, PuzzlePreviewResponse, PuzzleThemesResponse } from '../../shared/academy/PuzzleShapes';

function url(path: string): string {
  const base = getColyseusHttpUrl();
  if (!base) throw new Error('Servidor Colyseus não configurado.');
  return `${base.replace(/\/api$/, '')}/api/${path}`;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET' || path.endsWith('/me') || path.startsWith('admin/')) {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('Faça login para continuar.');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await response.text();
  let result: T & { error?: string; schemaMissing?: boolean };
  try { result = JSON.parse(text) as T & { error?: string; schemaMissing?: boolean }; }
  catch { throw new Error(`A API da Academia não está disponível (${response.status}); verifique o servidor.`); }
  if (!response.ok) {
    const error = new Error(result.error || `Falha na requisição (${response.status}).`) as Error & { schemaMissing?: boolean };
    error.schemaMissing = response.status === 503 && result.schemaMissing === true;
    throw error;
  }
  return result;
}

export const academyApi = {
  getBots: () => request<AcademyBotsResponse>('academy/bots'),
  saveBots: (bots: AcademyBotsUpdateRequest['bots']) => request<AcademyBotsResponse>('admin/academy/bots', 'PUT', { bots }),
  listMyBotGames: () => request<{ games: BotGameRecord[]; schemaMissing: boolean }>('academy/bot-games/me'),
  getPuzzleThemes: () => request<PuzzleThemesResponse>('academy/puzzles/themes'),
  getPuzzleAdminConfig: () => request<PuzzleAdminConfigResponse>('admin/academy/puzzles/config'),
  saveDailyPuzzleConfig: (data: DailyConfigUpsertRequest) => request<PuzzleAdminConfigResponse>('admin/academy/puzzles/config/daily', 'PUT', data),
  deleteDailyPuzzleConfig: (effectiveFrom: string) => request<PuzzleAdminConfigResponse>(`admin/academy/puzzles/config/daily/${encodeURIComponent(effectiveFrom)}`, 'DELETE'),
  saveDailyPuzzlePin: (data: DailyPinUpsertRequest) => request<PuzzleAdminConfigResponse>('admin/academy/puzzles/pins', 'PUT', data),
  savePuzzleBattleRewards: (data: BattleRewardConfig) => request<PuzzleAdminConfigResponse>('admin/academy/puzzles/config/battles', 'PUT', data),
  countPuzzles: (filter: { theme: string; ratingMin: number; ratingMax: number }) => request<PuzzleCountResponse>(`admin/academy/puzzles/count?${new URLSearchParams({ theme: filter.theme, ratingMin: String(filter.ratingMin), ratingMax: String(filter.ratingMax) })}`),
  previewPuzzle: (filter: { theme: string; ratingMin: number; ratingMax: number }) => request<PuzzlePreviewResponse>('admin/academy/puzzles/preview', 'POST', filter),
  lookupPuzzle: (puzzleId: string) => request<PuzzleLookupResponse>(`admin/academy/puzzles/lookup/${encodeURIComponent(puzzleId)}`),
  getDailyPuzzleDraw: (date: string) => request<DailyDrawResponse>(`admin/academy/puzzles/daily/${encodeURIComponent(date)}`),
};