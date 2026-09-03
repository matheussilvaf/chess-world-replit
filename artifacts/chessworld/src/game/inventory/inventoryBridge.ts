export interface InventoryDropRequest {
  requestId: string;
  itemKey: string;
  qty: number;
  x: number;
  y: number;
}

type InventoryBridge = {
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number } | null;
  sendDrop: (request: InventoryDropRequest) => void;
};

let bridge: InventoryBridge | null = null;

export function setInventoryBridge(next: InventoryBridge | null) {
  bridge = next;
}

export function getInventoryBridge() {
  return bridge;
}
