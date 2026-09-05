/**
 * Painel de habilidades do personagem (botão "Skills" ao lado da bolsa):
 * nível, barra de progresso e XP de cada habilidade. Mesma moldura de madeira
 * do inventário, arrastável pelo cabeçalho, e exclusivo com ele (abrir um
 * fecha o outro — ver progressStore). O snapshot vem da sala
 * (`progress_update`); fora dela, do HTTP `/api/progress/me`.
 */
import { useEffect } from 'react';
import { GripVertical, Sparkles, X } from 'lucide-react';
import { usePanelPlacement } from '../../hooks/usePanelPlacement';
import { SKILL_NOTES } from '../../lib/progress/skillNotes';
import { SKILL_IDS, skillName } from '../../shared/progress/EnergySkillsShapes';
import { refreshMyProgress, useProgressStore } from '../../stores/progressStore';

export function SkillsPanel() {
  const snapshot = useProgressStore((s) => s.snapshot);
  const skillsConfig = useProgressStore((s) => s.config.skills);
  const ticks = useProgressStore((s) => s.ticks);
  const closeSkills = useProgressStore((s) => s.closeSkills);

  const placement = usePanelPlacement({
    storageKey: 'chessworld:skills-panel',
    defaultWidth: 320,
    defaultHeight: 460,
    minW: 280,
    minH: 320,
  });

  useEffect(() => {
    if (!snapshot) void refreshMyProgress();
  }, [snapshot]);

  // Esc fecha (como no inventário).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSkills();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSkills]);

  const totalLevel = snapshot ? SKILL_IDS.reduce((sum, id) => sum + (snapshot.skills[id]?.level ?? 1), 0) : 0;

  return (
    <div
      ref={placement.panelRef}
      style={placement.style}
      data-testid="skills-panel"
      className={`fixed z-[500] w-[min(320px,calc(100vw-16px))] ${placement.style ? '' : 'bottom-[84px] right-3'}`}
    >
      <div
        className={`overflow-hidden rounded-xl border-[3px] bg-[#2a1a0e] shadow-[0_0_0_1px_#1a0f07,0_18px_40px_rgba(0,0,0,.7)] ${
          placement.dragging ? 'border-amber-400/80' : 'border-[#8a5a2b]'
        }`}
      >
        {/* Cabeçalho — alça de arrasto */}
        <div
          {...placement.dragHandleProps}
          className={`flex select-none items-center justify-between gap-2 border-b border-[#8a5a2b] bg-gradient-to-b from-[#4a2e15] to-[#33200f] px-3 py-2.5 ${
            placement.dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          title="Arraste para mover"
        >
          <div className="flex min-w-0 items-center gap-2">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-amber-200/50" />
            <Sparkles className="h-4 w-4 shrink-0 text-amber-300" />
            <span className="truncate text-sm font-bold uppercase tracking-[0.12em] text-amber-100">Habilidades</span>
          </div>
          <div className="flex items-center gap-2">
            {snapshot && (
              <span
                className="whitespace-nowrap rounded-md border border-[#8a5a2b]/70 bg-[#1e130a] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-200/90"
                title="Nível total: soma dos níveis de todas as habilidades"
              >
                Total {totalLevel}
              </span>
            )}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={closeSkills}
              className="flex h-7 w-7 items-center justify-center rounded-md text-amber-200/80 transition-colors hover:bg-black/30 hover:text-white"
              title="Fechar (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {snapshot && !snapshot.persisted && (
          <div className="border-b border-amber-900/60 bg-[#3a2a12] px-3 py-2 text-xs text-amber-100">
            O progresso ainda não está sendo salvo neste servidor — o XP some ao reiniciar.
          </div>
        )}

        {/* Lista (rolável) */}
        <div className="max-h-[min(56vh,420px)] overflow-y-auto overscroll-contain p-2.5 [scrollbar-color:#6b4a26_#1a0f07]">
          {!snapshot ? (
            <div className="py-10 text-center text-xs text-amber-200/70">Carregando habilidades…</div>
          ) : (
            <ul className="space-y-1.5" data-testid="skills-panel-list">
              {SKILL_IDS.map((id) => {
                const skill = snapshot.skills[id];
                const level = skill?.level ?? 1;
                const into = skill?.intoLevel ?? 0;
                const needed = skill?.needed ?? 0;
                const ratio = needed > 0 ? Math.min(1, into / needed) : 1;
                const note = SKILL_NOTES[id];
                const justLeveled = ticks.some((tick) => tick.skill === id && tick.levelUp !== null);
                const gaining = ticks.some((tick) => tick.skill === id);
                return (
                  <li
                    key={id}
                    data-testid={`skill-row-${id}`}
                    className={`rounded-lg border px-2.5 py-2 transition-colors ${
                      justLeveled
                        ? 'border-emerald-400/70 bg-emerald-900/30'
                        : gaining
                          ? 'border-amber-400/60 bg-[#3b2411]'
                          : 'border-[#8a5a2b]/50 bg-[#1e130a]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 font-semibold text-amber-50">
                        <span className="truncate">{skillName(skillsConfig, id)}</span>
                        {note && <span className="shrink-0 text-[9px] font-normal uppercase tracking-wide text-amber-200/40">{note}</span>}
                      </span>
                      <span
                        className={`shrink-0 rounded-md border px-1.5 py-px text-[11px] font-bold tabular-nums ${
                          justLeveled ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-[#8a5a2b]/70 bg-[#2a1a0e] text-amber-300'
                        }`}
                      >
                        Nv {level}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-[#8a5a2b]/60 bg-[#120a04]">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${justLeveled ? 'bg-emerald-400' : 'bg-amber-400'}`}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] tabular-nums text-amber-200/60">
                      {needed > 0 ? `${into}/${needed} XP para o nível ${level + 1}` : 'Nível máximo'} · total {skill?.xp ?? 0} XP
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-[#8a5a2b]/60 bg-[#22150b] px-3 py-2 text-[10px] leading-relaxed text-amber-200/60">
          Cada habilidade sobe sozinha: minerar, cortar árvores, lutar, forjar, fundir e cozinhar dão XP na hora.
        </div>
      </div>
    </div>
  );
}
