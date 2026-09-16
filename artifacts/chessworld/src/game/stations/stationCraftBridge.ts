import type { CraftChoices } from '../../shared/craft/CraftShapes';

export interface CraftResult {
  items: Array<{ itemKey: string; qty: number }>;
  /** Craft feito numa estação portátil posicionada: id e durabilidade que restou. */
  placedId?: string;
  durability?: number;
}

export interface CraftPayload {
  requestId: string;
  stationId: string;
  targetId: string;
  quantity: number;
  /** Estação portátil posicionada (privada) usada no lugar da pública. */
  placedId?: string;
  /** Opção escolhida em cada card com alternativas ("ou"): id principal → id usado. */
  choices?: CraftChoices;
}

export interface CraftRequest {
  stationId: string;
  targetId: string;
  quantity: number;
  placedId?: string;
  choices?: CraftChoices;
  /**
   * Tempo de preparo esperado (s) — o SERVIDOR é quem espera; aqui só estica
   * o prazo de confirmação para o loader não estourar antes da resposta.
   */
  prepSeconds?: number;
}

export interface StationCraftSender {
  send: (payload: CraftPayload) => void;
  /** Desiste de um craft com tempo de preparo ainda em espera no servidor. */
  cancel: (requestId: string) => void;
}
type Pending = {
  resolve: (value: CraftResult) => void;
  reject: (reason: Error) => void;
  retryTimer: ReturnType<typeof setTimeout>;
  timeoutTimer: ReturnType<typeof setTimeout>;
};

const CONFIRM_TIMEOUT_MS = 10_000;

let sender: StationCraftSender | null = null;
const pending = new Map<string, Pending>();

export function setStationCraftSender(next: StationCraftSender | null) {
  sender = next;
}

export function craft(request: CraftRequest): Promise<CraftResult> {
  if (!sender) return Promise.reject(new Error('Estação indisponível: conexão com o mundo não está pronta.'));
  const requestId = crypto.randomUUID();
  const { stationId, targetId, quantity, placedId, choices, prepSeconds = 0 } = request;
  const payload: CraftPayload = {
    requestId,
    stationId,
    targetId,
    quantity,
    ...(placedId ? { placedId } : {}),
    ...(choices && Object.keys(choices).length > 0 ? { choices } : {}),
  };
  return new Promise<CraftResult>((resolve, reject) => {
    const retryTimer = setTimeout(() => {
      // The server de-duplicates by requestId. Retrying the identical payload
      // recovers from a lost websocket packet without creating another craft.
      if (pending.has(requestId)) sender?.send(payload);
    }, 5_000);
    const timeoutTimer = setTimeout(() => {
      pending.delete(requestId);
      clearTimeout(retryTimer);
      reject(new Error('A criação não foi confirmada. O estado será reconciliado; você pode reabrir a estação para conferir o inventário.'));
    }, CONFIRM_TIMEOUT_MS + Math.max(0, prepSeconds) * 1000);
    pending.set(requestId, { resolve, reject, retryTimer, timeoutTimer });
    sender?.send(payload);
  });
}

/**
 * Cancela TODOS os crafts em voo deste cliente (fechou a estação): avisa o
 * servidor — que descarta o preparo pendente sem criar nada — e rejeita as
 * promessas locais. Um craft instantâneo já confirmado não é afetado.
 */
export function cancelStationCrafts(message = 'Criação cancelada.') {
  for (const [id, entry] of pending) {
    clearTimeout(entry.retryTimer);
    clearTimeout(entry.timeoutTimer);
    pending.delete(id);
    sender?.cancel(id);
    entry.reject(new Error(message));
  }
}

export function hasPendingStationCraft(): boolean {
  return pending.size > 0;
}

export function resolveStationCraft(requestId: string, result: CraftResult) {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.retryTimer);
  clearTimeout(entry.timeoutTimer);
  pending.delete(requestId);
  entry.resolve(result);
}

export function rejectStationCraft(requestId: string | undefined, message: string) {
  if (requestId) {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.retryTimer);
    clearTimeout(entry.timeoutTimer);
    pending.delete(requestId);
    entry.reject(new Error(message));
    return;
  }
  for (const [id, entry] of pending) {
    clearTimeout(entry.retryTimer);
    clearTimeout(entry.timeoutTimer);
    entry.reject(new Error(message));
    pending.delete(id);
  }
}

export function clearStationCraftBridge(message = 'Conexão com a estação encerrada.') {
  sender = null;
  rejectStationCraft(undefined, message);
}
