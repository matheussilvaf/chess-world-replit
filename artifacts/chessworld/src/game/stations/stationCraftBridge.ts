export interface CraftResult {
  items: Array<{ itemKey: string; qty: number }>;
}

type Sender = (payload: { requestId: string; stationId: string; targetId: string; quantity: number }) => void;
type Pending = {
  resolve: (value: CraftResult) => void;
  reject: (reason: Error) => void;
  retryTimer: ReturnType<typeof setTimeout>;
  timeoutTimer: ReturnType<typeof setTimeout>;
};

let sender: Sender | null = null;
const pending = new Map<string, Pending>();

export function setStationCraftSender(next: Sender | null) {
  sender = next;
}

export function craft(stationId: string, targetId: string, quantity: number): Promise<CraftResult> {
  if (!sender) return Promise.reject(new Error('Estação indisponível: conexão com o mundo não está pronta.'));
  const requestId = crypto.randomUUID();
  const payload = { requestId, stationId, targetId, quantity };
  return new Promise<CraftResult>((resolve, reject) => {
    const retryTimer = setTimeout(() => {
      // The server de-duplicates by requestId. Retrying the identical payload
      // recovers from a lost websocket packet without creating another craft.
      if (pending.has(requestId)) sender?.(payload);
    }, 5_000);
    const timeoutTimer = setTimeout(() => {
      pending.delete(requestId);
      clearTimeout(retryTimer);
      reject(new Error('A criação não foi confirmada. O estado será reconciliado; você pode reabrir a estação para conferir o inventário.'));
    }, 10_000);
    pending.set(requestId, { resolve, reject, retryTimer, timeoutTimer });
    sender?.(payload);
  });
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