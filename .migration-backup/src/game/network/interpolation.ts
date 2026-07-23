import Phaser from 'phaser';

interface Snapshot {
  x: number;
  y: number;
  timestamp: number;
}

const INTERPOLATION_DELAY_MS = 100;
const MAX_BUFFER_SIZE = 10;

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

  getPosition(): { x: number; y: number } {
    if (this.buffer.length < 2) {
      if (this.buffer.length === 1) {
        const target = this.buffer[0];
        this.currentX = Phaser.Math.Linear(this.currentX, target.x, 0.15);
        this.currentY = Phaser.Math.Linear(this.currentY, target.y, 0.15);
      }
      return { x: this.currentX, y: this.currentY };
    }

    const renderTime = Date.now() - INTERPOLATION_DELAY_MS;

    // Find two snapshots to interpolate between
    let prev: Snapshot | null = null;
    let next: Snapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].timestamp <= renderTime && this.buffer[i + 1].timestamp >= renderTime) {
        prev = this.buffer[i];
        next = this.buffer[i + 1];
        break;
      }
    }

    if (prev && next) {
      const elapsed = renderTime - prev.timestamp;
      const duration = next.timestamp - prev.timestamp;
      const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
      this.currentX = Phaser.Math.Linear(prev.x, next.x, t);
      this.currentY = Phaser.Math.Linear(prev.y, next.y, t);
    } else {
      // Extrapolate towards latest
      const latest = this.buffer[this.buffer.length - 1];
      this.currentX = Phaser.Math.Linear(this.currentX, latest.x, 0.15);
      this.currentY = Phaser.Math.Linear(this.currentY, latest.y, 0.15);
    }

    // Clean old snapshots
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
