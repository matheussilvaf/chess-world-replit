import { useGameStore } from '../../stores/gameStore';
import { Clock, Swords } from 'lucide-react';

export function TableStatusOverlays() {
  const { colyseusBoards } = useGameStore();

  const activeBoards = colyseusBoards.filter(b => b.status !== 'idle');
  if (!activeBoards.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[600] flex flex-col gap-2 max-w-[220px]">
      {activeBoards.map(board => (
        <TableStatusBadge key={board.id} board={board} />
      ))}
    </div>
  );
}

function TableStatusBadge({ board }: { board: { id: string; name: string; status: string; waitingPlayerName: string; timeLabel: string; matchId: string } }) {
  if (board.status === 'waiting') {
    return (
      <div className="bg-amber-900/90 backdrop-blur-sm border border-amber-500/40 rounded-lg px-3 py-2 shadow-lg animate-fade-in-up">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-300">Waiting for duel</span>
        </div>
        <p className="text-white text-xs font-semibold">{board.waitingPlayerName}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-amber-300/80">{board.name?.replace(/_/g, ' ')}</span>
          <span className="text-[10px] text-amber-200/60">{board.timeLabel}</span>
        </div>
      </div>
    );
  }

  if (board.status === 'playing') {
    return (
      <div className="bg-emerald-900/90 backdrop-blur-sm border border-emerald-500/40 rounded-lg px-3 py-2 shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <Swords className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-medium text-emerald-300">Match in progress</span>
        </div>
        <p className="text-white text-xs">{board.name?.replace(/_/g, ' ')}</p>
      </div>
    );
  }

  return null;
}
