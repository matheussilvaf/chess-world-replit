import { useEffect, useState } from 'react';
import { getColyseusHttpUrl } from '../../../config/colyseus';
import { supabase } from '../../../lib/supabase';
import { ACADEMY_POINTS_MAX, type AcademyPointKey, type AcademyPointsItem, type AcademyPointsResponse } from '../../../shared/academy/StatsShapes';

const SQL_PATH = 'server/supabase/tactics_academy_stats.sql';
async function request(method: 'GET' | 'PUT', points?: Record<AcademyPointKey, number>): Promise<AcademyPointsResponse> {
  const base = getColyseusHttpUrl();
  if (!base) throw new Error('Servidor da Academia não configurado.');
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Faça login para configurar os pontos.');
  const response = await fetch(`${base.replace(/\/api$/, '')}/api/admin/academy/points`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: points ? JSON.stringify({ points }) : undefined,
  });
  const result = await response.json() as AcademyPointsResponse & { error?: string; sql?: string };
  if (!response.ok) {
    if (result.schemaMissing) throw new Error(`${result.error || 'Tabela de pontos indisponível.'} Execute ${result.sql || SQL_PATH} no SQL Editor do Supabase.`);
    throw new Error(result.error || `Falha ao carregar pontos (${response.status}).`);
  }
  return result;
}

export function PointsConfigAdmin() {
  const [items, setItems] = useState<AcademyPointsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    let active = true;
    request('GET').then((result) => {
      if (!active) return;
      setItems(result.items); setLoading(false);
      if (result.schemaMissing) setError(`Execute ${SQL_PATH} no SQL Editor do Supabase.`);
    }).catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } });
    return () => { active = false; };
  }, []);
  const valid = items.length > 0 && items.every((item) => Number.isInteger(item.points) && item.points >= 0 && item.points <= ACADEMY_POINTS_MAX);
  async function save() {
    if (!valid) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const points = Object.fromEntries(items.map((item) => [item.key, item.points])) as Record<AcademyPointKey, number>;
      const result = await request('PUT', points);
      setItems(result.items);
      if (result.schemaMissing) setError(`Execute ${SQL_PATH} no SQL Editor do Supabase.`);
      else setSuccess('Pontos salvos com sucesso.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">Pontos do ranking</h2>
    <p className="text-sm text-slate-400">Os pontos definem o quadro 'Pontos' do painel de estatísticas da Academia; os outros quadros são contagens (puzzles resolvidos, batalhas vencidas, temas concluídos...).</p>
    {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}
    {success && <p role="status" className="rounded-lg border border-green-700 bg-green-950/50 p-3 text-sm text-green-200">{success}</p>}
    {loading ? <p className="text-sm text-slate-400">Carregando pontos…</p> : <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900">
      <table className="w-full min-w-[490px] text-left text-sm">
        <thead className="border-b border-slate-700 text-xs uppercase text-slate-400"><tr><th className="p-4">Ação</th><th className="p-4">Pontos</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.key} className="border-b border-slate-800 last:border-0">
          <td className="p-4"><strong className="text-slate-100">{item.label}</strong><p className="text-xs text-slate-400">{item.description}</p></td>
          <td className="p-4"><input type="number" min={0} max={ACADEMY_POINTS_MAX} step={1} disabled={saving}
            aria-label={`Pontos: ${item.label}`} value={Number.isNaN(item.points) ? '' : item.points}
            onChange={(event) => { setSuccess(''); setItems((prev) => prev.map((entry) => entry.key === item.key ? { ...entry, points: event.target.value === '' ? NaN : Number(event.target.value) } : entry)); }}
            className="w-24 rounded border border-slate-600 bg-slate-950 p-2 text-slate-100" />
            <p className="mt-1 whitespace-nowrap text-xs text-slate-400">padrão: {item.defaultPoints}</p>
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={saving || !valid} onClick={() => void save()} className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button>
      <button type="button" disabled={saving || !items.length} onClick={() => { setItems((prev) => prev.map((item) => ({ ...item, points: item.defaultPoints }))); setSuccess(''); }}
        className="rounded-lg bg-slate-700 px-5 py-2 text-sm font-semibold hover:bg-slate-600 disabled:opacity-50">Restaurar padrões</button>
    </div>
    {!valid && items.length > 0 && <p className="text-sm text-amber-300">Use números inteiros de 0 a {ACADEMY_POINTS_MAX}.</p>}
  </section>;
}