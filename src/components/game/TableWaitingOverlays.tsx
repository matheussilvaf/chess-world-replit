import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { Clock } from 'lucide-react';

interface TableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function TableWaitingOverlays() {
  const { colyseusBoards } = useGameStore();
  const [tableRects, setTableRects] = useState<Record<string, TableRect>>({});

  useEffect(() => {
    let frameId: number;
    const poll = () => {
      const rects = (window as any).__tableScreenRects;
      if (rects) setTableRects({ ...rects });
      frameId = requestAnimationFrame(poll);
    };
    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const waitingBoards = colyseusBoards.filter(b => b.status === 'waiting');
  if (!waitingBoards.length) return null;

  return (
    <>
      {waitingBoards.map(board => {
        const rect = tableRects[board.id];
        if (!rect || rect.width < 10) return null;

        // Determine which seat is empty (where opponent should sit)
        // If challenger is white (whitePlayerId set), empty seat is top (black)
        // If challenger is black (blackPlayerId set), empty seat is bottom (white)
        const emptyIsTop = !!board.whitePlayerId;

        return (
          <div
            key={board.id}
            className="fixed z-[500] pointer-events-none"
            style={{
              left: rect.x,
              top: emptyIsTop ? rect.y - 12 : rect.y + rect.height - 4,
              width: rect.width,
            }}
          >
            <div className="flex justify-center">
              <div className="animate-pulse flex flex-col items-center">
                <div className="bg-amber-800/90 backdrop-blur-sm border border-amber-400/50 rounded px-2 py-1 shadow-lg shadow-amber-900/40 flex items-center gap-1.5">
                  <Clock className="w-2.5 h-2.5 text-amber-300" />
                  <span className="text-[9px] font-bold text-white leading-none whitespace-nowrap">
                    Waiting
                  </span>
                </div>
                <div className="bg-amber-900/80 border border-amber-500/30 rounded px-1.5 py-0.5 mt-0.5">
                  <span className="text-[7px] text-amber-200 leading-none whitespace-nowrap">
                    {board.waitingPlayerName} &middot; {board.timeLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
