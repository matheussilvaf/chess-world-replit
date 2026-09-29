import { useEffect } from 'react';
import { X } from 'lucide-react';
import { dailyRewardFor, puzzleDifficultyLabel, puzzleMainThemes, puzzleThemeLabel, type DailySlot } from '../../../shared/academy/PuzzleShapes';
import { useNow } from '../../../hooks/useNow';
import { useGameStore } from '../../../stores/gameStore';
import { usePuzzleSessionStore } from '../../../stores/puzzleSessionStore';
import { usePuzzleStore } from '../../../stores/puzzleStore';
import { leaveDailyTable, sendDailySit, sendDailyStart } from '../../../game/network/puzzleHandlers';

/** Transporte alternativo apenas para a bancada local; o fluxo real usa a sala academy. */
export interface DailyPuzzleTransport {
  sit: (boardId: string) => void;
  start: (slot: DailySlot) => void;
  leave: () => void;
}

/**
 * Painel "Puzzles do dia": ao abrir, o jogador senta na mesa (cadeira livre) e
 * escolhe um slot; o puzzle em si é resolvido no tabuleiro da mesa (o painel
 * fecha quando o servidor inicia a sessão). Fechar sem puzzle em andamento
 * levanta da mesa.
 */
export function DailyPuzzlePanel({ boardId, transport, onClose }: { boardId: string; transport?: DailyPuzzleTransport; onClose?: () => void }) {
  const daily = usePuzzleStore((s) => s.daily);
  const loading = usePuzzleStore((s) => s.dailyLoading);
  const active = usePuzzleStore((s) => s.activePuzzle);
  const feedback = usePuzzleStore((s) => s.lastFeedback);
  const phase = usePuzzleSessionStore((s) => s.phase);
  const now = useNow(60_000);
  useEffect(() => {
    usePuzzleStore.getState().setDailyOpen(true);
    (transport?.sit ?? sendDailySit)(boardId);
    return () => usePuzzleStore.getState().setDailyOpen(false);
    // Só ao abrir o painel para esta mesa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const puzzleFinished = !active || feedback?.solved || feedback?.dailyStatus === 'failed' || !!feedback?.solutionMoves || phase === 'solved';
  const close = () => {
    if (puzzleFinished) (transport?.leave ?? leaveDailyTable)();
    useGameStore.getState().setSelectedBoard(null);
    useGameStore.getState().setBoardLocked(false);
    onClose?.();
  };
  const remaining = daily ? Math.max(0, daily.nextResetAt - now) : 0;
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const dateLabel = daily?.date ? new Date(`${daily.date}T12:00:00Z`).toLocaleDateString('pt-BR') : '';

  return <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4" data-testid="daily-puzzles-panel">
    <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between border-b border-slate-700 px-4 py-3">
        <div><h3 className="text-lg font-bold">Puzzles do dia</h3>
          {daily && <p className="text-xs text-slate-400">{dateLabel} · novos puzzles em {hours}h {minutes}m · prêmios em Gambitos</p>}</div>
        <button type="button" aria-label="Fechar" onClick={close} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-4">
        {daily?.schemaMissing && <p role="alert" className="rounded-lg border border-amber-700 bg-amber-900/30 p-3 text-sm text-amber-200">Sala de Puzzles ainda não configurada no servidor (rode o SQL da fase 2)</p>}
        {!daily && <p role="status" className="text-sm text-slate-300">{loading ? 'Sentando à mesa…' : 'Aguardando os puzzles do dia…'}</p>}
        {daily?.slots.map((item) => {
          const label = item.status === 'solved' ? `Resolvido (+${item.earnedGambits} Gambitos)` : item.status === 'failed' ? 'Reprovado'
            : item.status === 'in_progress' ? `Em andamento (${item.livesLeft} ${item.livesLeft === 1 ? 'vida' : 'vidas'})` : 'Disponível';
          const available = !daily.schemaMissing && (item.status === 'available' || item.status === 'in_progress');
          const theme = daily.showThemes ? puzzleMainThemes(item.themes, 1)[0] : undefined;
          return <div key={item.slot} data-testid={`daily-slot-${item.slot}`} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex justify-between gap-3"><div><strong className="text-sm">Slot {item.slot} · {puzzleDifficultyLabel(item.rating)}</strong>
              <p className="text-xs text-slate-400">Rating {item.rating}{theme ? ` · ${puzzleThemeLabel(theme)}` : ''}</p></div>
              <span className="text-sm font-semibold text-amber-300">{item.rewardGambits} Gambitos</span></div>
            <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-300">{label}</span>
              <button type="button" data-testid={`daily-resolve-${item.slot}`} disabled={!available}
                onClick={() => { usePuzzleStore.getState().setActivePuzzle(null); usePuzzleSessionStore.getState().clear(); (transport?.start ?? sendDailyStart)(item.slot); }}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{item.status === 'in_progress' ? 'Continuar' : 'Resolver'}</button></div>
            {available && <p className="mt-1.5 text-[11px] text-slate-400">Com {item.livesLeft} vidas: até {dailyRewardFor(item.rewardGambits, item.livesLeft)} Gambitos · resolve-se no tabuleiro da mesa</p>}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
