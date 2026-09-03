/**
 * Ponte React ↔ Phaser/Colyseus para o inventário: conversão de coordenadas,
 * posição do jogador, feedback visual do drop (anel de alcance + marcador) e
 * envio do drop para a sala. `null` fora do mundo (sem cena/sala).
 */
export interface InventoryDropRequest {
  requestId: string;
  itemKey: string;
  qty: number;
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export type InventoryBridge = {
  /** Coordenada de tela (clientX/Y) → mundo; null se o canvas não existe. */
  screenToWorld: (clientX: number, clientY: number) => WorldPoint | null;
  /** Coordenada do mundo → tela (clientX/Y). */
  worldToScreen: (x: number, y: number) => WorldPoint | null;
  /** Posição do sprite do jogador local (a mesma que o servidor conhece). */
  getPlayerPosition: () => WorldPoint | null;
  /** Anel com o alcance máximo do drop ao redor do jogador. */
  setDropRadiusVisible: (visible: boolean) => void;
  /** Marcador no ponto escolhido (null = remove). */
  setDropMarker: (point: WorldPoint | null) => void;
  sendDrop: (request: InventoryDropRequest) => void;
};

let bridge: InventoryBridge | null = null;

export function setInventoryBridge(next: InventoryBridge | null) {
  bridge = next;
}

export function getInventoryBridge() {
  return bridge;
}
