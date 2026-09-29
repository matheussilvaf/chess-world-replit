import { useBattleStore } from '../stores/battleStore';
import { useChessStore } from '../stores/chessStore';
import { usePuzzleStore } from '../stores/puzzleStore';

/**
 * Verdadeiro sempre que o jogador local está num tabuleiro: partida de xadrez,
 * mesa do puzzle diário, batalha de puzzles ou carteira da Sala de Lições (a
 * cadeira de lição também vive em `puzzleStore.seat`).
 *
 * Nessas horas o HUD do mundo some (badge do perfil, energia, inventário,
 * acesso rápido, joystick e botão de ataque) para deixar só o que importa
 * para a partida — pedido do usuário (set/2026).
 */
export function useAtChessBoard(): boolean {
  const inMatch = useChessStore((s) => !!s.matchId);
  const inBattle = useBattleStore((s) => s.screenOpen && !!s.battle);
  const seated = usePuzzleStore((s) => !!s.seat);
  return inMatch || inBattle || seated;
}
