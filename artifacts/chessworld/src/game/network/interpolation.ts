import Phaser from 'phaser';

interface Snapshot {
  x: number;
  y: number;
  timestamp: number;
}

// Atraso de renderização: absorve o jitter de chegada dos patches (30 Hz
// nominais, mas o transporte agrupa/atrasa pacotes). 120ms ≈ 3-4 intervalos
// de envio — com 70ms qualquer soluço de rede estourava o buffer e o sprite
// corria atrás da posição (efeito "borracha"/trancos).
const INTERPOLATION_DELAY_MS = 120;
const MAX_BUFFER_SIZE = 12;
// Constante de tempo (ms) do catch-up exponencial quando não há par de
// snapshots para interpolar — em TEMPO, não por frame (senão a 30 FPS o
// alcance fica 2x mais lento que a 60 FPS).
const CATCHUP_TAU_MS = 90;
// Acima disso não suaviza: é spawn/teleporte real, não jitter.
const SNAP_DISTANCE_PX = 160;

export class RemotePlayerInterpolator {
  private buffer: Snapshot[] = [];
  private currentX: number;
  private currentY: number;

  constructor(x: number, y: number) {
    this.currentX = x;
    this.currentY = y;
  }

  pushSnapshot(x: number, y: number) {
    this.buffer.push({ x, y, timestamp: Date.now() });
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  /**
   * Posição para o frame atual. `deltaMs` = duração do último frame,
   * usado para o catch-up ser estável em qualquer FPS.
   */
  getPosition(deltaMs: number): { x: number; y: number } {
    const n = this.buffer.length;
    if (n === 0) return { x: this.currentX, y: this.currentY };

    const renderTime = Date.now() - INTERPOLATION_DELAY_MS;

    // Par de snapshots que envolve o renderTime
    let prev: Snapshot | null = null;
    let next: Snapshot | null = null;
    for (let i = 0; i < n - 1; i++) {
      if (this.buffer[i].timestamp <= renderTime && this.buffer[i + 1].timestamp >= renderTime) {
        prev = this.buffer[i];
        next = this.buffer[i + 1];
        break;
      }
    }

    if (prev && next) {
      const duration = next.timestamp - prev.timestamp;
      const t = duration > 0 ? Math.min((renderTime - prev.timestamp) / duration, 1) : 1;
      this.currentX = Phaser.Math.Linear(prev.x, next.x, t);
      this.currentY = Phaser.Math.Linear(prev.y, next.y, t);
    } else {
      // Sem par (rajada perdida, jogador parado, buffer recém-criado):
      // aproxima do último snapshot com meia-vida constante em tempo.
      const latest = this.buffer[n - 1];
      const dx = latest.x - this.currentX;
      const dy = latest.y - this.currentY;
      if (Math.abs(dx) + Math.abs(dy) > SNAP_DISTANCE_PX) {
        this.currentX = latest.x;
        this.currentY = latest.y;
      } else {
        const alpha = 1 - Math.exp(-deltaMs / CATCHUP_TAU_MS);
        this.currentX += dx * alpha;
        this.currentY += dy * alpha;
      }
    }

    // Descarta snapshots já consumidos (mantém 2 para o próximo bracket)
    while (this.buffer.length > 2 && this.buffer[1].timestamp < renderTime) {
      this.buffer.shift();
    }

    return { x: this.currentX, y: this.currentY };
  }

  reset(x: number, y: number) {
    this.currentX = x;
    this.currentY = y;
    this.buffer = [];
  }
}
