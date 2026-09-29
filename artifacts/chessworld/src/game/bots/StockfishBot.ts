/**
 * Stockfish em Web Worker (pacote npm `stockfish`, build `stockfish-19-lite-single`).
 *
 * Contrato usado pela bancada /dev/bots e pela integração no Phaser.
 * Força SOMENTE via `UCI_LimitStrength` + `UCI_Elo` (BOT_ENGINE_PARAMS);
 * `go movetime 800` em todos; Iniciante sorteia entre os 3 melhores (MultiPV 3).
 * Nunca enfraquecer por profundidade/tempo.
 *
 */
import { BOT_ENGINE_PARAMS, type BotLevel } from '../../shared/academy/AcademyShapes';

export interface BotMoveRequest {
  /** Posição inicial (FEN). */
  fen: string;
  /** Lances UCI já jogados a partir de `fen` (opcional; pode-se passar só o FEN atual). */
  moves?: string[];
  level: BotLevel;
}

export interface BotMoveResult {
  /** Lance em UCI, ex.: `e2e4`, `e7e8q`. */
  uci: string;
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
  /** Quantas variantes o engine devolveu (diagnóstico da bancada). */
  candidates: string[];
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error' | 'terminated';

/** Última variante de cada índice na profundidade mais alta observada. */
export function parseUciInfo(line: string): { depth: number; multipv: number; move: string } | null {
  if (!line.startsWith('info ')) return null;
  const depth = /\bdepth (\d+)\b/.exec(line);
  const pv = /\bpv ([a-h][1-8][a-h][1-8][qrbn]?)(?:\s|$)/.exec(line);
  if (!depth || !pv) return null;
  return { depth: Number(depth[1]), multipv: Number(/\bmultipv (\d+)\b/.exec(line)?.[1] ?? 1), move: pv[1] };
}

type Pending = {
  resolve: (value: BotMoveResult) => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
  cancelled: boolean;
  variants: Map<number, { depth: number; move: string }>;
};

export class StockfishBot {
  private state: EngineStatus = 'loading';
  private pending: Pending | null = null;
  private level: BotLevel | null = null;
  private phase: 'uci' | 'ready' | 'move' = 'uci';
  private initResolve?: () => void;
  private initReject?: (error: Error) => void;

  private constructor(private worker: Worker, private onStatus?: (status: EngineStatus, detail?: string) => void) {
    worker.onmessage = (event: MessageEvent<string>) => {
      for (const line of String(event.data).split(/\r?\n/)) this.handleLine(line.trim());
    };
    worker.onerror = (event) => {
      this.fail(`Erro no worker Stockfish: ${event.message || 'falha ao carregar o engine'}`);
    };
    this.onStatus?.('loading');
  }

  static async load(onStatus?: (status: EngineStatus, detail?: string) => void): Promise<StockfishBot> {
    // This build uses the first URL hash field as the WASM URL (its default is
    // stockfish-19-lite-single.wasm, but Emscripten's internal name is stockfish.wasm).
    const base = import.meta.env.BASE_URL;
    const js = `${base}engine/stockfish-19-lite-single.js`;
    const wasm = new URL(`${base}engine/stockfish-19-lite-single.wasm`, location.origin).href;
    const worker = new Worker(`${js}#${encodeURIComponent(wasm)}`);
    const bot = new StockfishBot(worker, onStatus);
    try {
      await new Promise<void>((resolve, reject) => {
        bot.initResolve = resolve;
        bot.initReject = reject;
        const timer = setTimeout(() => bot.fail('Tempo esgotado ao carregar Stockfish.'), 30000);
        const done = bot.initResolve;
        bot.initResolve = () => { clearTimeout(timer); done?.(); };
        const failed = bot.initReject;
        bot.initReject = (error) => { clearTimeout(timer); failed?.(error); };
        worker.postMessage('uci');
      });
      return bot;
    } catch (error) {
      bot.terminate();
      throw error;
    }
  }

  get status(): EngineStatus {
    return this.state;
  }

  private fail(detail: string) {
    if (this.state === 'terminated') return;
    this.state = 'error';
    this.onStatus?.('error', detail);
    const error = new Error(detail);
    this.initReject?.(error);
    this.initReject = undefined;
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      pending.signal?.removeEventListener('abort', pending.abort);
      pending.reject(error);
    }
  }

  private handleLine(line: string) {
    if (this.state === 'terminated' || this.state === 'error') return;
    if (this.phase === 'uci' && line === 'uciok') {
      this.phase = 'ready';
      this.worker.postMessage('isready');
    } else if (this.phase === 'ready' && line === 'readyok') {
      this.phase = 'move';
      this.state = 'ready';
      this.onStatus?.('ready');
      this.initResolve?.();
      this.initResolve = undefined;
    } else if (this.phase === 'move' && this.pending) {
      const info = parseUciInfo(line);
      if (info && info.multipv >= 1 && info.multipv <= 3) {
        const old = this.pending.variants.get(info.multipv);
        if (!old || info.depth >= old.depth) this.pending.variants.set(info.multipv, { depth: info.depth, move: info.move });
      }
      const best = /^bestmove (\S+)/.exec(line);
      if (!best) return;
      const pending = this.pending;
      this.pending = null;
      pending.signal?.removeEventListener('abort', pending.abort);
      if (pending.cancelled) return;
      const candidates = [...pending.variants.entries()].sort(([a], [b]) => a - b)
        .map(([, variant]) => variant.move).filter((move, index, all) => all.indexOf(move) === index);
      if (!candidates.length && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(best[1])) candidates.push(best[1]);
      const uci = this.level === 1 && candidates.length > 1
        ? candidates[Math.floor(Math.random() * candidates.length)] : best[1];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
        pending.reject(new Error(`Stockfish devolveu um lance inválido: ${uci}`));
        return;
      }
      pending.resolve({ uci, from: uci.slice(0, 2), to: uci.slice(2, 4),
        promotion: uci.length === 5 ? uci[4] as BotMoveResult['promotion'] : undefined, candidates });
    }
  }

  async bestMove(req: BotMoveRequest, signal?: AbortSignal): Promise<BotMoveResult> {
    if (this.state !== 'ready') throw new Error(`Stockfish indisponível (${this.state}).`);
    if (this.pending) throw new Error('Stockfish já está calculando um lance.');
    if (signal?.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
    const params = BOT_ENGINE_PARAMS[req.level];
    if (!params) throw new Error('Nível de bot inválido.');
    if (this.level !== req.level) {
      this.worker.postMessage('setoption name UCI_LimitStrength value true');
      this.worker.postMessage(`setoption name UCI_Elo value ${params.uciElo}`);
      this.worker.postMessage(`setoption name MultiPV value ${params.multiPv}`);
      this.level = req.level;
    }
    return new Promise<BotMoveResult>((resolve, reject) => {
      const pending: Pending = { resolve, reject, signal, cancelled: false, variants: new Map(), abort: () => {
        if (pending.cancelled) return;
        pending.cancelled = true;
        this.worker.postMessage('stop');
        reject(new DOMException('Operação cancelada.', 'AbortError'));
        // Keep pending until the corresponding bestmove drains; never overlap searches.
      } };
      this.pending = pending;
      signal?.addEventListener('abort', pending.abort, { once: true });
      this.worker.postMessage(`position fen ${req.fen}${req.moves?.length ? ` moves ${req.moves.join(' ')}` : ''}`);
      this.worker.postMessage(`go movetime ${params.movetimeMs}`);
      if (signal?.aborted) pending.abort();
    });
  }

  terminate(): void {
    if (this.state === 'terminated') return;
    const error = new Error('Stockfish encerrado.');
    this.initReject?.(error);
    this.initReject = undefined;
    if (this.pending) {
      this.pending.signal?.removeEventListener('abort', this.pending.abort);
      this.pending.reject(error);
      this.pending = null;
    }
    this.worker.terminate();
    this.state = 'terminated';
    this.onStatus?.('terminated');
  }
}
