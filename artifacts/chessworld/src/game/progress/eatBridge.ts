/**
 * Ponte React ↔ sala para COMER: o hotbar dispara `eat(itemKey)` depois do
 * loader visual; a sala responde `eat_result` (ok) ou `inventory_error`
 * (recusa, ex.: "Você não está com fome"). Mesmo desenho do craft:
 * requestId idempotente + 1 re-envio + timeout.
 */
export interface EatPayload {
  requestId: string;
  itemKey: string;
}

export interface EatResult {
  items: Array<{ itemKey: string; qty: number }>;
  itemKey: string;
  eaten: number;
  energy: number;
  maxEnergy: number;
}

type Sender = (payload: EatPayload) => void;
type Pending = {
  resolve: (value: EatResult) => void;
  reject: (reason: Error) => void;
  retryTimer: ReturnType<typeof setTimeout>;
  timeoutTimer: ReturnType<typeof setTimeout>;
};

let sender: Sender | null = null;
const pending = new Map<string, Pending>();

export function setEatSender(next: Sender | null) {
  sender = next;
}

export function canEat(): boolean {
  return sender !== null;
}

export function eat(itemKey: string): Promise<EatResult> {
  if (!sender) return Promise.reject(new Error('Conexão com o mundo não está pronta.'));
  const requestId = crypto.randomUUID();
  const payload: EatPayload = { requestId, itemKey };
  return new Promise<EatResult>((resolve, reject) => {
    const retryTimer = setTimeout(() => {
      if (pending.has(requestId)) sender?.(payload);
    }, 4_000);
    const timeoutTimer = setTimeout(() => {
      pending.delete(requestId);
      clearTimeout(retryTimer);
      reject(new Error('O servidor não confirmou a refeição.'));
    }, 10_000);
    pending.set(requestId, { resolve, reject, retryTimer, timeoutTimer });
    sender?.(payload);
  });
}

function take(requestId: string | undefined): Pending | null {
  if (!requestId) return null;
  const entry = pending.get(requestId);
  if (!entry) return null;
  clearTimeout(entry.retryTimer);
  clearTimeout(entry.timeoutTimer);
  pending.delete(requestId);
  return entry;
}

export function resolveEat(requestId: string | undefined, result: EatResult): boolean {
  const entry = take(requestId);
  if (!entry) return false;
  entry.resolve(result);
  return true;
}

/** true se o requestId era de uma refeição pendente (o erro foi consumido). */
export function rejectEat(requestId: string | undefined, message: string): boolean {
  const entry = take(requestId);
  if (!entry) return false;
  entry.reject(new Error(message));
  return true;
}

export function clearEatBridge() {
  sender = null;
  for (const entry of pending.values()) {
    clearTimeout(entry.retryTimer);
    clearTimeout(entry.timeoutTimer);
    entry.reject(new Error('Conexão com o mundo encerrada.'));
  }
  pending.clear();
}
