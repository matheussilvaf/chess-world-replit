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

export interface StationPlaceRequest {
  requestId: string;
  itemKey: string;
  x: number;
  y: number;
}

export interface PlacementGhostView {
  itemKey: string;
  x: number;
  y: number;
  valid: boolean;
}

export interface ChessPlacementCheck {
  ok: boolean;
  /** Casa sob o ponto (mesmo quando inválida — para o fantasma vermelho). */
  square: string | null;
  reason?: string;
}

export interface ChessGhostView {
  itemKey: string;
  square: string | null;
  valid: boolean;
}

export type InventoryBridge = {
  /** Coordenada de tela (clientX/Y) → mundo; null se o canvas não existe. */
  screenToWorld: (clientX: number, clientY: number) => WorldPoint | null;
  /** Coordenada do mundo → tela (clientX/Y). */
  worldToScreen: (x: number, y: number) => WorldPoint | null;
  /** Posição do sprite do jogador local (a mesma que o servidor conhece). */
  getPlayerPosition: () => WorldPoint | null;
  /** Centro visual do sprite do jogador (alvo da comida que voa até ele ao comer). */
  getPlayerCenter: () => WorldPoint | null;
  /** Anel com o alcance máximo do drop ao redor do jogador (raio opcional em px). */
  setDropRadiusVisible: (visible: boolean, radius?: number) => void;
  /** Marcador no ponto escolhido (null = remove). */
  setDropMarker: (point: WorldPoint | null) => void;
  sendDrop: (request: InventoryDropRequest) => void;
  /** Estações portáteis: validação local do ponto, fantasma e envio do posicionamento. */
  validatePlacement: (itemKey: string, x: number, y: number) => { ok: boolean; reason?: string };
  setPlacementGhost: (ghost: PlacementGhostView | null) => void;
  sendPlace: (request: StationPlaceRequest) => void;
  sendStationPickup: (request: { requestId: string; placedId: string }) => void;
  sendStationAccessRequest: (placedId: string) => void;
  sendStationAccessResponse: (placedId: string, requesterId: string, allow: boolean) => void;
  /** Big Chess Board: casa sob um ponto do mundo, validação local, fantasma e mensagens da sala. */
  validateChessPlacement: (itemKey: string, x: number, y: number) => ChessPlacementCheck;
  setChessGhost: (ghost: ChessGhostView | null) => void;
  sendChessPlace: (request: { requestId: string; itemKey: string; square: string }) => void;
  sendChessCollect: (request: { requestId: string; square: string }) => void;
  sendChessEquip: (request: { requestId: string; square: string; itemKey: string }) => void;
};

let bridge: InventoryBridge | null = null;

export function setInventoryBridge(next: InventoryBridge | null) {
  bridge = next;
}

export function getInventoryBridge() {
  return bridge;
}
