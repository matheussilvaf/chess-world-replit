import { getColyseusHttpUrl } from '../../config/colyseus';
import { supabase } from '../../lib/supabase';
import { parseBoardResponse, type BoardId, type PeriodId, type SummaryResponse } from './academyStatsLayout';

async function get(path: string): Promise<unknown> {
  const base = getColyseusHttpUrl();
  if (!base) throw new Error('Servidor da Academia não configurado.');
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Faça login para ver as estatísticas.');
  const response = await fetch(`${base.replace(/\/api$/, '')}/api/academy/stats/${path}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.schemaMissing) return { schemaMissing: true };
    throw new Error(result.error || 'Não foi possível carregar as estatísticas.');
  }
  return result;
}
export const statsClient = {
  board: async (board: BoardId, period: PeriodId, page: number) =>
    parseBoardResponse(await get(`board?${new URLSearchParams({ board, period, page: String(page), size: '8' })}`)),
  summary: async () => {
    const value = await get('summary') as SummaryResponse;
    return value;
  },
};