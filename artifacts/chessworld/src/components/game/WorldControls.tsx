import type { WorldScene } from '../../game/scenes/WorldScene';
import { useAtChessBoard } from '../../hooks/useAtChessBoard';
import { AttackButton } from './AttackButton';
import { ToolHotbar } from './ToolHotbar';
import { VirtualJoystick } from './VirtualJoystick';

/**
 * Controles do mundo (ataque, joystick, hotbar com energia e acesso rápido).
 * Somem inteiros enquanto o jogador está num tabuleiro — não são usados numa
 * partida, num puzzle ou numa batalha, e só poluíam a tela.
 */
export function WorldControls({ getScene }: { getScene: () => WorldScene | null }) {
  const atBoard = useAtChessBoard();
  if (atBoard) return null;
  return (
    <>
      <AttackButton getScene={getScene} />
      <VirtualJoystick getScene={getScene} />
      <ToolHotbar />
    </>
  );
}
