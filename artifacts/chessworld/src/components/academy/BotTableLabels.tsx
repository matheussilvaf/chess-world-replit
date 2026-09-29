import { useEffect, useState } from 'react';
import { useAcademyStore } from '../../stores/academyStore';
import { useGameStore } from '../../stores/gameStore';
import { ACADEMY_BOT_TABLES } from '../../shared/academy/AcademyShapes';
import { LevelBars } from './LevelBars';

type TableRect = { x: number; y: number; width: number; height: number };

export function BotTableLabels() {
  const inAcademy = useAcademyStore((s) => s.inAcademy);
  const bots = useAcademyStore((s) => s.bots);
  const boards = useGameStore((s) => s.colyseusBoards);
  const [rects, setRects] = useState<Record<string, TableRect>>({});
  useEffect(() => {
    if (!inAcademy) { setRects({}); return; }
    let frame: number;
    const poll = () => {
      const next = (window as any).__tableScreenRects;
      if (next) setRects({ ...next });
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [inAcademy]);
  if (!inAcademy) return null;
  return <>{Object.entries(ACADEMY_BOT_TABLES).map(([tableId, botId]) => {
    const rect = rects[tableId];
    const bot = bots.find((b) => b.id === botId);
    if (!rect || rect.width < 10 || !bot) return null;
    const playing = boards.find((b) => b.id === tableId)?.status === 'playing';
    return <div key={tableId} className="pointer-events-none fixed z-[500] flex justify-center"
      style={{ left: rect.x, top: rect.y - 35, width: rect.width }}>
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-500/40 bg-slate-900/90 px-2 py-1 text-[10px] text-white shadow-lg">
        <span className="font-bold">{bot.name}</span><span className="scale-75 origin-left"><LevelBars level={bot.level} /></span>
        <span className={playing ? 'text-amber-300' : 'text-emerald-300'}>{playing ? 'Jogando' : 'Disponível'}</span>
      </div>
    </div>;
  })}</>;
}