import { useEffect, useState } from 'react';
import { academyApi } from '../../../game/network/academyApi';
import {
  DAILY_PUZZLE_SLOTS, DEFAULT_DAILY_SLOT_CONFIGS, DEFAULT_BATTLE_REWARDS,
  PUZZLE_RATING_MIN, PUZZLE_RATING_MAX, DAILY_REWARD_MAX_GAMBITS, dailyPuzzleDate,
  puzzleThemeLabel, type BattleRewardConfig, type DailyConfigSet, type DailySlot,
  type DailySlotConfig, type DailyDrawResponse, type PuzzleAdminConfigResponse,
  type PuzzlePreviewResponse, type PuzzleThemesResponse,
} from '../../../shared/academy/PuzzleShapes';
import { ACADEMY_PUZZLES_SQL } from './academySql';
import { PuzzleSlotCard } from './PuzzleSlotCard';
import { PuzzlePreviewCard } from './PuzzlePreviewCard';

const DEFAULT_DATE = '0001-01-01';
const input = 'rounded border border-slate-600 bg-slate-950 p-2 text-slate-100';
const button = 'rounded bg-cyan-700 px-4 py-2 text-sm font-semibold hover:bg-cyan-600 disabled:opacity-50';
const describeError = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const missingSchema = (cause: unknown) => cause instanceof Error && (cause as Error & { schemaMissing?: boolean }).schemaMissing === true;
const copySlots = (slots: DailySlotConfig[]) => slots.map((s) => ({ ...s }));
const validReward = (n: number) => Number.isInteger(n) && n >= 0 && n <= DAILY_REWARD_MAX_GAMBITS;

function DrawSlot({ slot, date, drawn, item, pinnedId, busy, onPin }: {
  slot: DailySlot; date: string; drawn: boolean; item: DailyDrawResponse['slots'][number] | undefined;
  pinnedId: string; busy: boolean; onPin: (slot: DailySlot, id: string) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [lookup, setLookup] = useState<PuzzlePreviewResponse['puzzle']>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setId(''); setLookup(null); setError(''); }, [date, slot]);
  async function check() {
    if (!id.trim()) return;
    setChecking(true); setError(''); setLookup(null);
    try {
      const result = await academyApi.lookupPuzzle(id.trim());
      if (!result.puzzle) throw new Error('Puzzle não encontrado.');
      setLookup(result.puzzle);
    } catch (cause) { setError(describeError(cause)); }
    finally { setChecking(false); }
  }
  return <div className="rounded-lg border border-slate-700 bg-slate-950 p-4 text-sm">
    <h4 className="font-semibold">Slot {slot} · {drawn ? 'já sorteado' : 'projeção'}</h4>
    {item ? <p className="mt-1 text-slate-300">{item.puzzleId} · Rating {item.rating} · {item.themes.map(puzzleThemeLabel).join(', ') || 'Sem temas'} · {item.rewardGambits} Gambitos {item.pinned ? '· Fixado' : ''}</p>
      : <p className="mt-1 text-slate-400">Nenhum puzzle disponível.</p>}
    {pinnedId && <button type="button" disabled={busy} onClick={() => void onPin(slot, '')} className="mt-2 text-red-300 hover:underline disabled:opacity-50">Remover fixação ({pinnedId})</button>}
    <div className="mt-3 flex flex-wrap gap-2">
      <input aria-label={`Fixar puzzle por id no slot ${slot}`} placeholder="Fixar puzzle por id" value={id}
        onChange={(e) => { setId(e.target.value); setLookup(null); setError(''); }} className={`${input} min-w-0 flex-1`} />
      <button type="button" disabled={checking || !id.trim()} onClick={() => void check()} className={button}>{checking ? 'Validando…' : 'Validar id'}</button>
    </div>
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    {lookup && <PuzzlePreviewCard puzzle={lookup} pinning={busy} pinLabel={`Fixar este puzzle para ${date.split('-').reverse().join('/')}`} onPin={() => void onPin(slot, lookup.puzzleId)} />}
  </div>;
}

export function DailyPuzzlesAdmin({ section }: { section: 'daily' | 'battles' }) {
  const [data, setData] = useState<PuzzleAdminConfigResponse | null>(null);
  const [themes, setThemes] = useState<PuzzleThemesResponse['themes']>([]);
  const [selected, setSelected] = useState(DEFAULT_DATE);
  const [slots, setSlots] = useState<DailySlotConfig[]>(copySlots(DEFAULT_DAILY_SLOT_CONFIGS));
  const [showThemes, setShowThemes] = useState(true);
  const [rewards, setRewards] = useState<BattleRewardConfig>({ ...DEFAULT_BATTLE_REWARDS });
  const [date, setDate] = useState(dailyPuzzleDate());
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [draw, setDraw] = useState<DailyDrawResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawLoading, setDrawLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [schemaMissing, setSchemaMissing] = useState(false);
  const today = data?.today || dailyPuzzleDate();

  useEffect(() => {
    let active = true;
    Promise.all([academyApi.getPuzzleAdminConfig(), academyApi.getPuzzleThemes()])
      .then(([config, themeData]) => {
        if (!active) return;
        setData(config); setSchemaMissing(config.schemaMissing || themeData.schemaMissing);
        const initial = config.configSets.find((s) => s.effectiveFrom === DEFAULT_DATE) ?? config.activeToday;
        setSlots(copySlots(initial.slots));
        setShowThemes(initial.showThemes ?? true);
        setRewards({ ...config.battleRewards });
        setThemes([...themeData.themes].sort((a, b) => puzzleThemeLabel(a.theme).localeCompare(puzzleThemeLabel(b.theme), 'pt-BR')));
      }).catch((cause) => { if (active) { setError(describeError(cause)); setSchemaMissing(missingSchema(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!data || section !== 'daily' || !date) return;
    let active = true;
    setDrawLoading(true); setDraw(null);
    academyApi.getDailyPuzzleDraw(date).then((value) => { if (active) setDraw(value); })
      .catch((cause) => { if (active) { setError(describeError(cause)); if (missingSchema(cause)) setSchemaMissing(true); } })
      .finally(() => { if (active) setDrawLoading(false); });
    return () => { active = false; };
  }, [date, data, section]);

  function chooseSet(value: string) {
    setSelected(value); setSuccess(''); setError('');
    const set = data?.configSets.find((s) => s.effectiveFrom === value);
    if (set) { setSlots(copySlots(set.slots)); setShowThemes(set.showThemes ?? true); }
  }
  function updateSlot(slot: DailySlot, patch: Partial<DailySlotConfig>) {
    setSlots((prev) => prev.map((s) => s.slot === slot ? { ...s, ...patch } : s));
    setSuccess('');
  }
  async function action(fn: () => Promise<PuzzleAdminConfigResponse>, message: string) {
    setBusy(true); setError(''); setSuccess('');
    try {
      const next = await fn();
      setData(next); setSchemaMissing(next.schemaMissing);
      setSuccess(message);
      return next;
    } catch (cause) { setError(describeError(cause)); if (missingSchema(cause)) setSchemaMissing(true); return null; }
    finally { setBusy(false); }
  }
  async function pin(slot: DailySlot, puzzleId: string, pinDate = date) {
    const next = await action(() => academyApi.saveDailyPuzzlePin({ slot, date: pinDate, puzzleId }),
      puzzleId ? `Puzzle fixado para ${pinDate}, slot ${slot}.` : `Fixação removida do slot ${slot}.`);
    if (next && pinDate === date) {
      try { setDraw(await academyApi.getDailyPuzzleDraw(date)); }
      catch (cause) { setError(describeError(cause)); if (missingSchema(cause)) setSchemaMissing(true); }
    }
  }
  async function schedule() {
    if (!scheduleDate || scheduleDate <= today || data?.configSets.some((s) => s.effectiveFrom === scheduleDate)) {
      setError('Escolha uma data futura ainda não agendada.'); return;
    }
    const active = [...(data?.configSets ?? [])].filter((s) => s.effectiveFrom <= today).at(-1) ?? data?.activeToday;
    const copied = copySlots(active?.slots ?? slots);
    const copiedThemes = active?.showThemes ?? showThemes;
    const next = await action(() => academyApi.saveDailyPuzzleConfig({ effectiveFrom: scheduleDate, slots: copied, showThemes: copiedThemes }), `Agendamento criado para ${scheduleDate}.`);
    if (next) { setSelected(scheduleDate); setSlots(copied); setShowThemes(copiedThemes); setScheduleDate(''); setScheduling(false); }
  }
  const validSlots = slots.length === 3 && DAILY_PUZZLE_SLOTS.every((slot) => slots.some((s) => s.slot === slot && Number.isInteger(s.ratingMin) && s.ratingMin >= PUZZLE_RATING_MIN &&
    Number.isInteger(s.ratingMax) && s.ratingMax <= PUZZLE_RATING_MAX && s.ratingMax >= s.ratingMin && validReward(s.rewardGambits)));
  const validBattles = [rewards.winGambits, rewards.drawGambits, rewards.lossGambits].every(validReward) &&
    (rewards.dailyCapGambits === null || (Number.isInteger(rewards.dailyCapGambits) && rewards.dailyCapGambits >= 0));
  const sets: DailyConfigSet[] = data?.configSets ?? [];

  return <div className="space-y-6">
    {loading && <p role="status" className="text-slate-400">Carregando configuração de puzzles…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}
    {success && <p role="status" className="rounded-lg border border-green-700 bg-green-950/50 p-3 text-sm text-green-200">{success}</p>}
    {schemaMissing && <section className="rounded-lg border border-amber-600 bg-amber-950/40 p-4">
      <h2 className="font-semibold text-amber-200">Tabelas da Sala de Puzzles ainda não criadas</h2>
      <p className="my-2 text-sm text-amber-100">Execute server/supabase/tactics_academy_phase2.sql no SQL Editor do Supabase.</p>
      <pre className="max-h-72 overflow-auto whitespace-pre rounded bg-slate-950 p-3 text-xs text-slate-300">{ACADEMY_PUZZLES_SQL}</pre>
    </section>}
    {data && section === 'daily' && <>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Puzzles diários</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">Conjunto de configuração
            <select className={input} value={selected} onChange={(e) => chooseSet(e.target.value)}>
              {sets.map((s) => <option key={s.effectiveFrom} value={s.effectiveFrom}>{s.effectiveFrom === DEFAULT_DATE ? 'Padrão (sempre)' : `A partir de ${s.effectiveFrom}`}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setScheduling((v) => !v)} className={button}>Agendar para uma data…</button>
          {scheduling && <><input aria-label="Data do agendamento" type="date" min={new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className={input} />
            <button type="button" disabled={busy || !scheduleDate || scheduleDate <= today} onClick={() => void schedule()} className={button}>Criar conjunto</button></>}
        </div>
        <p className="text-sm text-slate-400">Alterações neste conjunto não mudam puzzles já sorteados. Agendamentos copiam o conjunto em vigor hoje.</p>
        <div className="grid gap-4 lg:grid-cols-3">
          {slots.map((config) => <PuzzleSlotCard key={`${selected}-${config.slot}`} config={config} themes={themes} date={date} onChange={(patch) => updateSlot(config.slot, patch)} pinning={busy} onPin={(id) => pin(config.slot, id)} />)}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="daily-show-themes" checked={showThemes} onChange={(e) => { setShowThemes(e.target.checked); setSuccess(''); }} />
          Mostrar tema dos puzzles aos jogadores (no painel do dia e no HUD da mesa)
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || !validSlots} onClick={() => void action(() => academyApi.saveDailyPuzzleConfig({ effectiveFrom: selected, slots, showThemes }), 'Configuração diária salva.')} className={button}>{busy ? 'Salvando…' : 'Salvar conjunto'}</button>
          {selected !== DEFAULT_DATE && selected > today && <button type="button" disabled={busy} onClick={() => void (async () => {
            const next = await action(() => academyApi.deleteDailyPuzzleConfig(selected), 'Agendamento removido.');
            if (next) { const fallback = next.configSets.find((s) => s.effectiveFrom === DEFAULT_DATE) ?? next.activeToday; setSelected(DEFAULT_DATE); setSlots(copySlots(fallback.slots)); setShowThemes(fallback.showThemes ?? true); }
          })()} className="rounded border border-red-700 px-4 py-2 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50">Remover agendamento</button>}
        </div>
      </section>
      <section className="space-y-3 border-t border-slate-700 pt-5">
        <h2 className="text-xl font-semibold">Puzzles de uma data</h2>
        <label className="flex flex-col items-start gap-1 text-sm">Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
        {drawLoading && <p role="status" className="text-sm text-slate-400">Consultando puzzles da data…</p>}
        {draw && <><p className="text-sm text-slate-400">{draw.drawn ? 'Já sorteado e gravado' : 'Projeção (ainda não sorteado)'}</p>
          <div className="grid gap-3 lg:grid-cols-3">{DAILY_PUZZLE_SLOTS.map((slot) =>
            <DrawSlot key={slot} slot={slot} date={date} drawn={draw.drawn} item={draw.slots.find((s) => s.slot === slot)}
              pinnedId={data.pins.find((p) => p.date === date && p.slot === slot)?.puzzleId ?? ''} busy={busy} onPin={pin} />)}</div></>}
      </section>
    </>}
    {data && section === 'battles' && <section className="space-y-4">
      <h2 className="text-xl font-semibold">Batalhas</h2>
      <p className="text-sm text-slate-400">Batalhas nunca dão XP nem Coroas. Se desativadas, não concedem Gambitos.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rewards.enabled} onChange={(e) => setRewards({ ...rewards, enabled: e.target.checked })} />Recompensar batalhas com Gambitos</label>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['winGambits', 'Vitória'], ['drawGambits', 'Empate'], ['lossGambits', 'Derrota']] as const).map(([key, label]) =>
          <label key={key} className="flex flex-col gap-1 text-sm">{label} (Gambitos)
            <input type="number" min={0} max={1000} value={rewards[key]} onChange={(e) => setRewards({ ...rewards, [key]: Number(e.target.value) })} className={input} /></label>)}
        <label className="flex flex-col gap-1 text-sm">Teto diário (vazio = sem teto)
          <input type="number" min={0} value={rewards.dailyCapGambits ?? ''} onChange={(e) => setRewards({ ...rewards, dailyCapGambits: e.target.value === '' ? null : Number(e.target.value) })} className={input} /></label>
      </div>
      <button type="button" disabled={busy || !validBattles} onClick={() => void (async () => {
        const next = await action(() => academyApi.savePuzzleBattleRewards(rewards), 'Recompensas das batalhas salvas.');
        if (next) setRewards({ ...next.battleRewards });
      })()} className={button}>{busy ? 'Salvando…' : 'Salvar batalhas'}</button>
    </section>}
  </div>;
}