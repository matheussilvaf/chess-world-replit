/**
 * Ciclo de vida do engine no jogo: carregado ao ENTRAR na Tactics Academy,
 * encerrado (worker.terminate) ao SAIR. Contagem de referência simples para
 * que UI e driver de partida compartilhem a mesma instância.
 *
 */
import { StockfishBot, type EngineStatus } from './StockfishBot';

export interface BotEngineManager {
  /** Garante um engine carregado (idempotente); rejeita se falhar o carregamento. */
  acquire(): Promise<StockfishBot>;
  /** Solta a referência; sem referências o worker é encerrado. */
  release(): void;
  /** Encerra imediatamente, independente das referências (saída do mapa). */
  shutdown(): void;
  status(): EngineStatus;
  subscribe(listener: (status: EngineStatus, detail?: string) => void): () => void;
}

let references = 0;
let generation = 0;
let engine: StockfishBot | null = null;
let loading: Promise<StockfishBot> | null = null;
let currentStatus: EngineStatus = 'idle';
let detail: string | undefined;
const listeners = new Set<(status: EngineStatus, detail?: string) => void>();
function notify(status: EngineStatus, message?: string) {
  currentStatus = status;
  detail = message;
  listeners.forEach((listener) => listener(status, message));
}
function stop() {
  generation++;
  engine?.terminate();
  engine = null;
  loading = null;
  notify('terminated');
}

export const botEngine: BotEngineManager = {
  acquire() {
    references++;
    if (engine?.status === 'ready') return Promise.resolve(engine);
    if (engine?.status === 'error') {
      engine.terminate();
      engine = null;
      loading = null;
    }
    if (!loading) {
      const version = generation;
      loading = StockfishBot.load((status, message) => {
        if (generation === version) notify(status, message);
      }).then((bot) => {
        if (version !== generation) {
          bot.terminate();
          throw new Error('Carregamento do Stockfish cancelado.');
        }
        engine = bot;
        return bot;
      }).catch((error) => {
        if (version === generation) {
          loading = null;
          references = 0;
          notify('error', error instanceof Error ? error.message : String(error));
        }
        throw error;
      });
    }
    return loading;
  },
  release() {
    if (references > 0) references--;
    if (references === 0) stop();
  },
  shutdown() {
    references = 0;
    stop();
  },
  status: () => currentStatus,
  subscribe(listener) {
    listeners.add(listener);
    listener(currentStatus, detail);
    return () => { listeners.delete(listener); };
  },
};
