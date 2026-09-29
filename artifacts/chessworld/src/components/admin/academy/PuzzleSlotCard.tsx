import { useEffect, useState } from 'react';
import { academyApi } from '../../../game/network/academyApi';
import { dailyRewardFor, puzzleThemeLabel, PUZZLE_RATING_MIN, PUZZLE_RATING_MAX, DAILY_REWARD_MAX_GAMBITS, type DailySlotConfig, type PuzzlePreviewResponse, type PuzzleThemesResponse } from '../../../shared/academy/PuzzleShapes';
import { PuzzlePreviewCard } from './PuzzlePreviewCard';

const field = 'w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-100';
const valid = (s: DailySlotConfig) => Number.isInteger(s.ratingMin) && s.ratingMin >= PUZZLE_RATING_MIN && s.ratingMin <= PUZZLE_RATING_MAX && Number.isInteger(s.ratingMax) && s.ratingMax >= s.ratingMin && s.ratingMax <= PUZZLE_RATING_MAX;

export function PuzzleSlotCard({ config, themes, date, onChange, onPin, pinning }: {
  config: DailySlotConfig; themes: PuzzleThemesResponse['themes']; date: string;
  onChange: (patch: Partial<DailySlotConfig>) => void;
  onPin: (puzzleId: string) => Promise<void>; pinning: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [countError, setCountError] = useState('');
  const [preview, setPreview] = useState<PuzzlePreviewResponse['puzzle']>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setCount(null);
    setCountError('');
    if (!valid(config)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      academyApi.countPuzzles({ theme: config.theme, ratingMin: config.ratingMin, ratingMax: config.ratingMax })
        .then((result) => { if (!cancelled) setCount(result.count); })
        .catch((cause) => { if (!cancelled) setCountError(cause instanceof Error ? cause.message : String(cause)); });
    }, 450);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [config.ratingMin, config.ratingMax, config.theme]);

  async function draw() {
    setPreviewing(true); setError(''); setPreview(null);
    try {
      const result = await academyApi.previewPuzzle({ theme: config.theme, ratingMin: config.ratingMin, ratingMax: config.ratingMax });
      setPreview(result.puzzle);
      if (!result.puzzle) setError('Nenhum puzzle encontrado para este filtro.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPreviewing(false); }
  }

  return <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
    <h3 className="mb-3 font-semibold">Slot {config.slot}</h3>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-sm">Rating mínimo<input type="number" min={PUZZLE_RATING_MIN} max={PUZZLE_RATING_MAX} value={config.ratingMin} onChange={(e) => onChange({ ratingMin: Number(e.target.value) })} className={field} /></label>
      <label className="text-sm">Rating máximo<input type="number" min={PUZZLE_RATING_MIN} max={PUZZLE_RATING_MAX} value={config.ratingMax} onChange={(e) => onChange({ ratingMax: Number(e.target.value) })} className={field} /></label>
      <label className="col-span-2 text-sm">Tema<select value={config.theme} onChange={(e) => onChange({ theme: e.target.value })} className={field}>
        <option value="">Qualquer tema</option>
        {themes.map((t) => <option key={t.theme} value={t.theme}>{puzzleThemeLabel(t.theme)} ({t.count.toLocaleString('pt-BR')})</option>)}
      </select></label>
      <label className="col-span-2 text-sm">Recompensa base (Gambitos)<input type="number" min={0} max={DAILY_REWARD_MAX_GAMBITS} value={config.rewardGambits}
        onChange={(e) => onChange({ rewardGambits: Number(e.target.value) })} className={field} /></label>
    </div>
    <p className="mt-2 text-xs text-slate-400">3 vidas = 100% ({dailyRewardFor(config.rewardGambits, 3)}), 2 = 70% ({dailyRewardFor(config.rewardGambits, 2)}), 1 = 40% ({dailyRewardFor(config.rewardGambits, 1)}) Gambitos</p>
    <p className={`mt-3 text-sm ${count === 0 ? 'text-red-400' : count !== null && count < 50 ? 'text-amber-400' : 'text-slate-300'}`}>
      {!valid(config) ? 'Informe uma faixa válida (400–3200).' : countError || (count === null ? 'Consultando quantidade de puzzles…' : `${count.toLocaleString('pt-BR')} puzzles atendem a este filtro`)}
    </p>
    <button type="button" disabled={previewing || !valid(config)} onClick={() => void draw()} className="mt-3 rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600 disabled:opacity-50">
      {previewing ? 'Sorteando…' : 'Sortear agora (prévia)'}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    {preview && <><p className="mt-3 text-xs text-slate-400">Prévia · fixar para {date.split('-').reverse().join('/')}</p>
      <PuzzlePreviewCard puzzle={preview} pinning={pinning} pinLabel={`Fixar este puzzle para ${date.split('-').reverse().join('/')}`} onPin={() => void onPin(preview.puzzleId)} /></>}
  </div>;
}