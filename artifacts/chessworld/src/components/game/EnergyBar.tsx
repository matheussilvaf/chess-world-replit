/**
 * Barra de energia do personagem, logo acima da hotbar.
 * Verde = normal, âmbar = com fome, vermelho = fraco (velocidade reduzida e
 * sem ferramentas). Ao lado sobem os ganhos de XP ("+5 XP Mineração") e o
 * aviso curto de energia (ex.: ferramenta bloqueada).
 */
import { Drumstick } from 'lucide-react';
import { useProgressStore } from '../../stores/progressStore';

export function energyTone(state: { weak: boolean; hungry: boolean; dead: boolean }): 'normal' | 'hungry' | 'weak' {
  if (state.dead || state.weak) return 'weak';
  if (state.hungry) return 'hungry';
  return 'normal';
}

const FILL: Record<ReturnType<typeof energyTone>, string> = {
  normal: 'bg-emerald-400',
  hungry: 'bg-amber-400',
  weak: 'bg-red-500 animate-pulse',
};

const LABEL: Record<ReturnType<typeof energyTone>, string> = {
  normal: 'Energia',
  hungry: 'Com fome',
  weak: 'Fraco',
};

export function EnergyBar() {
  const snapshot = useProgressStore((s) => s.snapshot);
  const ticks = useProgressStore((s) => s.ticks);
  const notice = useProgressStore((s) => s.notice);
  if (!snapshot) return null;
  const tone = energyTone(snapshot.state);
  const pct = Math.max(0, Math.min(100, snapshot.state.percent));
  return (
    <div className="pointer-events-none relative flex w-full flex-col items-center gap-1">
      {(ticks.length > 0 || notice) && (
        <div className="flex flex-col items-center gap-0.5 text-[11px] font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,.9)]">
          {ticks.map((tick) => (
            <span key={tick.id} className="animate-[energy-tick_2.6s_ease-out_forwards] text-amber-200" data-testid="xp-tick">
              +{tick.xp} XP {tick.label}
              {tick.levelUp ? <span className="ml-1 text-emerald-300">· Nível {tick.levelUp}!</span> : null}
            </span>
          ))}
          {notice && <span className="rounded bg-red-950/85 px-2 py-0.5 text-red-100 shadow" data-testid="energy-notice">{notice}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={LABEL[tone]}
        aria-valuemin={0}
        aria-valuemax={snapshot.maxEnergy}
        aria-valuenow={snapshot.energy}
        data-testid="energy-bar"
        data-tone={tone}
        title={`${LABEL[tone]} ${snapshot.energy}/${snapshot.maxEnergy}`}
        className="relative flex h-4 w-[min(92vw,300px)] items-center overflow-hidden rounded-full border-2 border-[#8a5a2b] bg-[#1a0f07] shadow-[0_0_0_1px_#1a0f07,0_4px_12px_rgba(0,0,0,.6)]"
      >
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out ${FILL[tone]}`} style={{ width: `${pct}%` }} />
        <span className="relative z-10 flex w-full items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide text-white drop-shadow-[0_1px_1px_rgba(0,0,0,.9)]">
          <Drumstick className="h-3 w-3" />
          {LABEL[tone]} {snapshot.energy}/{snapshot.maxEnergy}
        </span>
      </div>
    </div>
  );
}
