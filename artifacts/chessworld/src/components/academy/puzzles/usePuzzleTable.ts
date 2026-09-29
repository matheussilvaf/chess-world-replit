import type { BattleStatePayload, PuzzleSeat } from '../../../shared/academy/PuzzleShapes';
import { useBattleStore } from '../../../stores/battleStore';
import { usePuzzleStore, type DailySeat } from '../../../stores/puzzleStore';
import { usePuzzleSessionStore } from '../../../stores/puzzleSessionStore';
import { academyTableKind } from '../../../shared/academy/AcademyShapes';

export interface PuzzleTable {
  kind: 'daily' | 'battle' | 'lesson';
  boardId: string;
  seat: PuzzleSeat;
  /** Lado que fica embaixo na tela: a cor do puzzle atual ou, sem puzzle, a da cadeira. */
  orientation: 'w' | 'b';
  battle: BattlePlacement | null;
  dailySeat: DailySeat | null;
}
type BattlePlacement = BattleStatePayload;

/** Mesa de puzzle em que o jogador local está sentado agora (batalha tem prioridade). */
export function usePuzzleTable(): PuzzleTable | null {
  const battle = useBattleStore((s) => (s.screenOpen ? s.battle : null));
  const dailySeat = usePuzzleStore((s) => s.seat);
  const playerColor = usePuzzleSessionStore((s) => s.puzzle?.playerColor);
  if (battle) {
    return { kind: 'battle', boardId: battle.boardId, seat: battle.mySeat, battle, dailySeat: null,
      orientation: playerColor ?? (battle.mySeat === 'top' ? 'b' : 'w') };
  }
  if (dailySeat) {
    return { kind: academyTableKind(dailySeat.boardId) === 'lesson' ? 'lesson' : 'daily', boardId: dailySeat.boardId, seat: dailySeat.seat, battle: null, dailySeat,
      orientation: playerColor ?? (dailySeat.seat === 'top' ? 'b' : 'w') };
  }
  return null;
}
