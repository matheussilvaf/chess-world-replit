import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { dailyRewardFor, puzzleDifficultyLabel, puzzleMainThemes, puzzleThemeLabel, type DailySlot } from '../../../shared/academy/PuzzleShapes';
import { useGameStore } from '../../../stores/gameStore';
import { usePuzzleStore } from '../../../stores/puzzleStore';
import { sendDailyOpen, sendDailyStart, sendPuzzleMove } from '../../../game/network/puzzleHandlers';
import { PuzzleBoard } from './PuzzleBoard';

/** Transporte alternativo apenas para a bancada local; o fluxo real usa a sala academy. */
export interface DailyPuzzleTransport {
  open: () => void;
  start: (slot: DailySlot) => void;
  move: (sessionId: string, uci: string) => void;
}

export function DailyPuzzlesModal({ boardId, transport, onClose }: { boardId: string; transport?: DailyPuzzleTransport; onClose?: () => void }) {
  const daily = usePuzzleStore((s) => s.daily);
  const loading = usePuzzleStore((s) => s.dailyLoading);
  const puzzle = usePuzzleStore((s) => s.activePuzzle);
  const feedback = usePuzzleStore((s) => s.lastFeedback);
  const [slot, setSlot] = useState<DailySlot | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    usePuzzleStore.getState().setDailyOpen(true);
    (transport?.open ?? sendDailyOpen)();
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { window.clearInterval(interval); usePuzzleStore.getState().setDailyOpen(false); };
    // Only request the state on opening the modal, not on every transport render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);
  const close = () => {
    usePuzzleStore.getState().setDailyOpen(false);
    useGameStore.getState().setSelectedBoard(null);
    useGameStore.getState().setBoardLocked(false);
    onClose?.();
  };
  const current = slot && puzzle?.context.kind === 'daily' && puzzle.context.slot === slot ? puzzle : null;
  const currentFeedback = current && feedback?.sessionId === current.sessionId ? feedback : null;
  const finished = currentFeedback?.solved || currentFeedback?.dailyStatus === 'failed' || !!currentFeedback?.solutionMoves;
  const remaining = daily ? Math.max(0, daily.nextResetAt - now) : 0;
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const dateLabel = daily?.date ? new Date(`${daily.date}T12:00:00Z`).toLocaleDateString('pt-BR') : '';

  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4" data-testid="daily-puzzles-modal">
    <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-slate-700 p-5">
        <div><h3 className="text-xl font-bold">Puzzles do dia</h3>
          {daily && <p className="text-sm text-slate-400">{dateLabel} · novos puzzles em {hours}h {minutes}m</p>}</div>
        <button type="button" aria-label="Fechar" onClick={close} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="max-h-[75vh] space-y-3 overflow-y-auto p-5">
        {slot !== null ? <>
          <button type="button" onClick={() => setSlot(null)} className="text-sm text-amber-300 hover:underline">← Voltar à lista</button>
          {current ? <>
            <PuzzleBoard puzzle={current} feedback={currentFeedback} onMove={(uci) => (transport?.move ?? sendPuzzleMove)(current.sessionId, uci)} size={440} />
            {current.livesLeft !== undefined && !finished && <p className="text-sm text-slate-300">Vidas restantes: {currentFeedback?.livesLeft ?? current.livesLeft} · prêmio possível: {dailyRewardFor(daily?.slots.find((s) => s.slot === slot)?.rewardGambits ?? 0, currentFeedback?.livesLeft ?? current.livesLeft)} Gambitos</p>}
            {currentFeedback?.solved && <p className="font-semibold text-emerald-400">+{currentFeedback.rewardGambits ?? 0} Gambitos!</p>}
            {finished && <button type="button" onClick={() => setSlot(null)} className="w-full rounded-lg bg-amber-500 py-2 font-semibold text-slate-950">Voltar aos puzzles</button>}
          </> : <p role="status" className="text-slate-300">Preparando puzzle…</p>}
        </> : <>
          {daily?.schemaMissing && <p role="alert" className="rounded-lg border border-amber-700 bg-amber-900/30 p-3 text-sm text-amber-200">Sala de Puzzles ainda não configurada no servidor (rode o SQL da fase 2)</p>}
          {!daily && <p role="status" className="text-slate-300">{loading ? 'Carregando puzzles…' : 'Aguardando os puzzles do dia…'}</p>}
          {daily?.slots.map((item) => {
            const label = item.status === 'solved' ? `Resolvido (+${item.earnedGambits} Gambitos)` : item.status === 'failed' ? 'Reprovado'
              : item.status === 'in_progress' ? `Em andamento (${item.livesLeft} vidas)` : 'Disponível';
            const available = !daily.schemaMissing && (item.status === 'available' || item.status === 'in_progress');
            const theme = puzzleMainThemes(item.themes, 1)[0];
            return <div key={item.slot} data-testid={`daily-slot-${item.slot}`} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="flex justify-between gap-3"><div><strong>Slot {item.slot} · {puzzleDifficultyLabel(item.rating)}</strong>
                <p className="text-xs text-slate-400">Rating {item.rating}{theme ? ` · ${puzzleThemeLabel(theme)}` : ''}</p></div>
                <span className="text-sm font-semibold text-amber-300">{item.rewardGambits} Gambitos</span></div>
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm text-slate-300">{label}</span>
                <button type="button" data-testid={`daily-resolve-${item.slot}`} disabled={!available}
                  onClick={() => { usePuzzleStore.getState().setActivePuzzle(null); setSlot(item.slot); (transport?.start ?? sendDailyStart)(item.slot); }}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{item.status === 'in_progress' ? 'Continuar' : 'Resolver'}</button></div>
              {available && <p className="mt-2 text-xs text-slate-400">Com {item.livesLeft} vidas: até {dailyRewardFor(item.rewardGambits, item.livesLeft)} Gambitos</p>}
            </div>;
          })}
        </>}
      </div>
    </div>
  </div>;
}