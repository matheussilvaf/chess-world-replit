import { useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { ACADEMY_TABLE_PREFIX } from '../../../shared/academy/AcademyShapes';
import type { DailySlotView } from '../../../shared/academy/PuzzleShapes';
import { dailyTableSummary } from './dailyTableSummary';
import { sendDailyOpen } from '../../../game/network/puzzleHandlers';
import { getActiveRoomType } from '../../../game/network/colyseusClient';
import { useAcademyStore } from '../../../stores/academyStore';
import { usePuzzleStore } from '../../../stores/puzzleStore';

type TableRect = { x: number; y: number; width: number; height: number };
export const DAILY_TABLE_ID = `${ACADEMY_TABLE_PREFIX}puzzle_day`;

const DOT: Record<DailySlotView['status'], string> = {
  solved: 'bg-emerald-400', failed: 'bg-red-400', in_progress: 'bg-amber-300 animate-pulse', available: 'bg-slate-500',
};

/**
 * Aviso parado sobre a mesa do puzzle diário: quem passa pelo mapa vê que há
 * puzzles do dia e quanto já fez ("1 de 3 concluídos") sem precisar clicar.
 * Some quando o próprio jogador senta na mesa (o HUD do puzzle assume).
 */
export function DailyTableOverlay({ rectOverride }: { rectOverride?: TableRect | null } = {}) {
  // Bancada /dev/puzzles: recebe o retângulo da mesa direto, sem Phaser nem `inAcademy`.
  const inAcademy = useAcademyStore((s) => s.inAcademy) || !!rectOverride;
  const daily = usePuzzleStore((s) => s.daily);
  const seat = usePuzzleStore((s) => s.seat);
  const dailyOpen = usePuzzleStore((s) => s.dailyOpen);
  const [polled, setPolled] = useState<TableRect | null>(null);
  const rect = rectOverride ?? polled;
  useEffect(() => {
    if (!inAcademy || rectOverride) { setPolled(null); return; }
    const setRect = setPolled;
    let frame: number;
    const poll = () => {
      const next = (window as any).__tableScreenRects?.[DAILY_TABLE_ID] as TableRect | undefined;
      setRect((prev) => (next && prev && next.x === prev.x && next.y === prev.y && next.width === prev.width && next.height === prev.height) ? prev : next ?? null);
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [inAcademy, rectOverride]);
  // Virada do dia: pede o estado novo para o aviso não ficar com o progresso de ontem.
  useEffect(() => {
    if (!inAcademy || !daily?.nextResetAt) return;
    const delay = Math.max(1_000, daily.nextResetAt - Date.now() + 1_500);
    if (delay > 2_147_000_000) return;
    const timer = window.setTimeout(() => { if (getActiveRoomType() === 'academy') sendDailyOpen(); }, delay);
    return () => window.clearTimeout(timer);
  }, [inAcademy, daily?.nextResetAt]);

  if (!inAcademy || !rect || rect.width < 10 || dailyOpen || seat?.boardId === DAILY_TABLE_ID) return null;
  const summary = dailyTableSummary(daily?.slots, daily?.schemaMissing);
  return <>
    {summary.remaining && <div className="pointer-events-none fixed z-[120] rounded-md ring-2 ring-amber-400/50 shadow-[0_0_22px_6px_rgba(251,191,36,0.28)] animate-pulse"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-hidden />}
    <div className="pointer-events-none fixed z-[120] flex justify-center" data-testid="daily-table-overlay" style={{ left: rect.x - 60, top: rect.y - 38, width: rect.width + 120 }}>
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-500/40 bg-slate-900/90 px-2 py-1 text-[10px] text-white shadow-lg">
        <Puzzle className="h-3 w-3 flex-shrink-0 text-amber-300" />
        <span className="font-bold">{summary.text}</span>
        {daily && !daily.schemaMissing && daily.slots.length > 0 && <span className="ml-0.5 flex items-center gap-0.5" aria-hidden>
          {daily.slots.map((s) => <span key={s.slot} className={`h-1.5 w-1.5 rounded-full ${DOT[s.status] ?? 'bg-slate-500'}`} />)}
        </span>}
      </div>
    </div>
  </>;
}
