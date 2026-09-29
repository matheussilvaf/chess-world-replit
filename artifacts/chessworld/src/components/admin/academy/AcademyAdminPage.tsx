import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BOT_ENGINE_PARAMS, BOT_LEVELS, BOT_NAME_MAX_LEN, DEFAULT_ACADEMY_BOTS, type AcademyBot, type BotLevel } from '../../../shared/academy/AcademyShapes';
import { academyApi } from '../../../game/network/academyApi';
import { LevelBars } from '../../academy/LevelBars';
import { ACADEMY_SQL } from './academySql';

export function AcademyAdminPage() {
  const [bots, setBots] = useState<AcademyBot[]>(DEFAULT_ACADEMY_BOTS);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    const elements = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean) as HTMLElement[];
    const previous = elements.map((el) => el.style.overflow);
    elements.forEach((el) => { el.style.overflow = 'auto'; });
    academyApi.getBots().then((data) => { setBots(data.bots); setSchemaMissing(data.schemaMissing); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => elements.forEach((el, index) => { el.style.overflow = previous[index]; });
  }, []);
  function update(index: number, patch: Partial<AcademyBot>) {
    setBots((prev) => prev.map((bot, at) => at === index ? { ...bot, ...patch } : bot));
    setSuccess('');
  }
  async function save() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await academyApi.saveBots(bots);
      setBots(response.bots);
      setSchemaMissing(response.schemaMissing);
      setSuccess('Bots salvos com sucesso.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  }
  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/admin" className="text-sm text-cyan-400 hover:text-cyan-300">← Voltar ao painel</Link>
      <header><h1 className="text-2xl font-bold">Tactics Academy — Bots</h1>
        <p className="mt-1 text-sm text-slate-400">Configure os nomes e os níveis dos quatro adversários de treino.</p></header>
      {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}
      {success && <p role="status" className="rounded-lg border border-green-700 bg-green-950/50 p-3 text-sm text-green-200">{success}</p>}
      {schemaMissing && <section className="rounded-lg border border-amber-600 bg-amber-950/40 p-4">
        <h2 className="font-semibold text-amber-200">Tabela da Academia ainda não criada</h2>
        <p className="my-2 text-sm text-amber-100">Execute server/supabase/tactics_academy_phase1.sql no SQL Editor do Supabase antes de salvar.</p>
        <pre className="max-h-72 overflow-auto whitespace-pre rounded bg-slate-950 p-3 text-xs text-slate-300">{ACADEMY_SQL}</pre>
      </section>}
      <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900">
        <table className="w-full min-w-[690px] text-left text-sm">
          <thead className="border-b border-slate-700 text-xs uppercase text-slate-400"><tr>
            <th className="p-4">Bot</th><th className="p-4">Nome</th><th className="p-4">Nível</th><th className="p-4">Força do motor</th>
          </tr></thead>
          <tbody>{bots.map((bot, index) => {
            const params = BOT_ENGINE_PARAMS[bot.level];
            return <tr key={bot.id} className="border-b border-slate-800 last:border-0">
              <td className="p-4 font-mono text-slate-400">{bot.id}</td>
              <td className="p-4"><input aria-label={`Nome do ${bot.id}`} maxLength={BOT_NAME_MAX_LEN} value={bot.name}
                onChange={(event) => update(index, { name: event.target.value })} className="w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-100" /></td>
              <td className="p-4"><div className="flex items-center gap-3"><select aria-label={`Nível do ${bot.id}`} value={bot.level}
                onChange={(event) => update(index, { level: Number(event.target.value) as BotLevel })}
                className="rounded border border-slate-600 bg-slate-950 p-2">
                {BOT_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
              </select><LevelBars level={bot.level} /></div></td>
              <td className="p-4 font-mono text-xs text-slate-400">UCI_Elo {params.uciElo} · MultiPV {params.multiPv} · movetime {params.movetimeMs} ms</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <button type="button" onClick={() => void save()} disabled={saving || bots.some((b) => !b.name.trim())}
        className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
        {saving ? 'Salvando…' : 'Salvar bots'}
      </button>
    </div>
  </main>;
}