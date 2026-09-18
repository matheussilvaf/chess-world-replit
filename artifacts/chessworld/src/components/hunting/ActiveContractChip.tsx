import { useEffect } from 'react';
import { Crosshair } from 'lucide-react';
import { useHuntingStore } from '../../stores/huntingStore';

export function ActiveContractChip() {
  const active = useHuntingStore((s) => s.active);
  const now = useHuntingStore((s) => s.now);
  const notice = useHuntingStore((s) => s.notice);
  useEffect(() => {
    const timer = window.setInterval(() => useHuntingStore.getState().tick(), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => useHuntingStore.getState().clearNotice(), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!active && !notice) return null;
  const seconds = active ? Math.max(0, Math.ceil((active.deadline - now) / 1000)) : 0;
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {active && (
        <button type="button" onClick={() => useHuntingStore.getState().setModalOpen(true)} className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold shadow-xl backdrop-blur ${seconds < 60 && !active.complete ? 'border-red-400 bg-red-950/90 text-red-100' : 'border-amber-500/70 bg-slate-950/90 text-amber-100'}`}>
          <Crosshair className="h-4 w-4" />
          {active.complete ? 'Completo — volte ao caçador' : `${active.animalName} ${active.killed}/${active.quantity} · ${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`}
        </button>
      )}
      {notice && <div className="rounded-lg border border-amber-500/50 bg-slate-950/95 px-4 py-2 text-center text-xs text-amber-100 shadow-xl">{notice}</div>}
    </div>
  );
}