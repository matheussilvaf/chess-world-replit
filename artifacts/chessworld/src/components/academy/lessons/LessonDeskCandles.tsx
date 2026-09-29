import { useEffect, useState } from 'react';
import { LESSON_CATEGORIES, lessonDeskBoardId } from '../../../shared/academy/LessonShapes';
import { useLessonStore } from '../../../stores/lessonStore';
import { useAcademyStore } from '../../../stores/academyStore';

type Rect = { x: number; y: number; width: number; height: number };
export function LessonDeskCandles({ rectOverride }: { rectOverride?: Rect | null }) {
  const inAcademy = useAcademyStore((s) => s.inAcademy);
  const progress = useLessonStore((s) => s.state.progress);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  useEffect(() => {
    if (!inAcademy && !rectOverride) return;
    let frame = 0;
    const ids = LESSON_CATEGORIES.map((category) => lessonDeskBoardId(category.id));
    const same = (a: Rect | undefined, b: Rect | undefined) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
    // Só re-renderiza quando alguma carteira se moveu na tela (a câmera parada não custa nada).
    const poll = () => {
      const all = (window as any).__tableScreenRects as Record<string, Rect> | undefined;
      if (all) setRects((prev) => ids.every((id) => same(prev[id], all[id])) ? prev : Object.fromEntries(ids.filter((id) => all[id]).map((id) => [id, all[id]])));
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [inAcademy, rectOverride]);
  if (!inAcademy && !rectOverride) return null;
  return <>{LESSON_CATEGORIES.map((category, index) => {
    const rect = rectOverride ? index === 0 ? rectOverride : null : rects[lessonDeskBoardId(category.id)];
    if (!rect || rect.width < 10) return null;
    const done = category.themes.filter((id) => progress.some((p) => p.theme === id && p.completed));
    return <div key={category.id} data-testid={`lesson-candles-${category.id}`} className="pointer-events-none fixed z-[190] flex justify-center" style={{ left: rect.x, top: rect.y - 38, width: rect.width }}>
      <div className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-amber-500/30 bg-slate-900/90 px-2 py-1 text-[10px] text-white shadow-lg">
        <span className="font-bold">{category.label}</span><span aria-label={`${done.length} de ${category.themes.length} concluídas`} className="flex gap-0.5">{category.themes.map((id) => <span key={id} className={done.includes(id) ? 'drop-shadow-[0_0_5px_#fbbf24] animate-pulse' : 'grayscale opacity-40'}>🕯️</span>)}</span><span className="text-amber-300">{done.length}/{category.themes.length}</span>
      </div>
    </div>;
  })}</>;
}