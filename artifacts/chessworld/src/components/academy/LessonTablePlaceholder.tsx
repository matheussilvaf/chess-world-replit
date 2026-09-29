import { X } from 'lucide-react';
import { useGameStore } from '../../stores/gameStore';

/** Sala de Lições (fase 3): as mesas já existem no mapa, o conteúdo chega na próxima entrega. */
export function LessonTablePlaceholder() {
  const close = () => { useGameStore.getState().setSelectedBoard(null); useGameStore.getState().setBoardLocked(false); };
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-slate-700 p-5">
        <h3 className="text-lg font-bold">Sala de Lições</h3>
        <button type="button" onClick={close} aria-label="Fechar" className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-3 p-5 text-sm text-slate-300">
        <p>Em breve: lições interativas de tática e finais, com explicações passo a passo.</p>
        <button type="button" onClick={close} className="w-full rounded-xl bg-slate-700 py-2.5 font-semibold text-white hover:bg-slate-600">Voltar</button>
      </div>
    </div>
  </div>;
}
