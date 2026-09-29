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
  const puzzle = usePuzzleSessionStore((s) => s.puzzle);
  // Batalha encerrada (resultado aberto, jogador já de pé) cede a vez a uma cadeira nova.
  if (battle && !(battle.phase === 'finished' && dailySeat)) {
    const playerColor = puzzle?.boardId === battle.boardId && puzzle.context.kind === 'battle' &&
      puzzle.context.index === battle.me.index ? puzzle.playerColor : battle.me.color;
    return { kind: 'battle', boardId: battle.boardId, seat: battle.mySeat, battle, dailySeat: null,
      orientation: playerColor ?? (battle.mySeat === 'top' ? 'b' : 'w') };
  }
  if (dailySeat) {
    const playerColor = puzzle?.boardId === dailySeat.boardId ? puzzle.playerColor : undefined;
    return { kind: academyTableKind(dailySeat.boardId) === 'lesson' ? 'lesson' : 'daily', boardId: dailySeat.boardId, seat: dailySeat.seat, battle: null, dailySeat,
      orientation: playerColor ?? (dailySeat.seat === 'top' ? 'b' : 'w') };
  }
  return null;
}
