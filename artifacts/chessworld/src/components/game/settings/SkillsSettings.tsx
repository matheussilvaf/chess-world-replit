/**
 * Aba "Habilidades" (somente leitura): nível e XP de cada habilidade do
 * personagem mais o estado de energia. O snapshot vem da sala
 * (`progress_update`); fora dela, do HTTP `/api/progress/me`.
 */
import { useEffect } from 'react';
import { Drumstick } from 'lucide-react';
import { refreshMyProgress, useProgressStore } from '../../../stores/progressStore';
import { SKILL_IDS, SKILL_LABELS } from '../../../shared/progress/EnergySkillsShapes';
import { energyTone } from '../EnergyBar';

const SKILL_NOTES: Partial<Record<(typeof SKILL_IDS)[number], string>> = {
  hunting: 'Em breve',
  alchemy: 'Em breve',
  trading: 'Em breve',
};

export function SkillsSettings() {
  const snapshot = useProgressStore((s) => s.snapshot);

  useEffect(() => {
    if (!snapshot) void refreshMyProgress();
  }, [snapshot]);

  if (!snapshot) {
    return <p className="text-sm text-slate-400">Carregando progresso…</p>;
  }
  const tone = energyTone(snapshot.state);
  const toneClass = tone === 'weak' ? 'text-red-300' : tone === 'hungry' ? 'text-amber-300' : 'text-emerald-300';
  const toneLabel = tone === 'weak' ? 'Fraco' : tone === 'hungry' ? 'Com fome' : 'Bem alimentado';

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Drumstick className="h-4 w-4 text-amber-400" /> Energia
          </h3>
          <span className={`text-xs font-bold uppercase tracking-wide ${toneClass}`}>{toneLabel}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900">
          <div
            className={`h-full rounded-full ${tone === 'weak' ? 'bg-red-500' : tone === 'hungry' ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ width: `${Math.max(0, Math.min(100, snapshot.state.percent))}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {snapshot.energy}/{snapshot.maxEnergy} · vida máxima {snapshot.maxHp}
          {snapshot.persisted ? '' : ' · progresso ainda não persistido neste servidor'}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-white">Habilidades</h3>
        <ul className="space-y-2" data-testid="skills-list">
          {SKILL_IDS.map((id) => {
            const skill = snapshot.skills[id];
            const level = skill?.level ?? 1;
            const into = skill?.intoLevel ?? 0;
            const needed = skill?.needed ?? 0;
            const ratio = needed > 0 ? Math.min(1, into / needed) : 1;
            const note = SKILL_NOTES[id];
            return (
              <li key={id} className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-white">
                    {SKILL_LABELS[id]}
                    {note && <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-slate-500">{note}</span>}
                  </span>
                  <span className="text-amber-300">Nível {level}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-900">
                  <div className="h-full rounded-full bg-amber-400 transition-[width] duration-300" style={{ width: `${ratio * 100}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {needed > 0 ? `${into}/${needed} XP para o nível ${level + 1}` : 'Nível máximo'} · total {skill?.xp ?? 0} XP
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
