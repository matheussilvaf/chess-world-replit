const AUDIO_PATHS = {
  move: '/assets/ChessAudios/Move.mp3',
  capture: '/assets/ChessAudios/Capture.mp3',
  castle: '/assets/ChessAudios/Castle.mp3',
  check: '/assets/ChessAudios/Check.mp3',
  checkmate: '/assets/ChessAudios/Checkmate.mp3',
  gameOver: '/assets/ChessAudios/GameOver.mp3',
  startGame: '/assets/ChessAudios/StartGame.mp3',
} as const;

type SoundName = keyof typeof AUDIO_PATHS;

class ChessAudioManager {
  private buffers = new Map<SoundName, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private loaded = false;

  async init() {
    if (this.loaded) return;
    this.ctx = new AudioContext();

    const entries = Object.entries(AUDIO_PATHS) as [SoundName, string][];
    await Promise.all(
      entries.map(async ([name, path]) => {
        try {
          const response = await fetch(path);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
          this.buffers.set(name, audioBuffer);
        } catch (e) {
          console.warn(`[Audio] Failed to load ${name}:`, e);
        }
      })
    );
    this.loaded = true;
  }

  play(name: SoundName) {
    if (!this.ctx || !this.buffers.has(name)) {
      this.init().then(() => this.playInternal(name));
      return;
    }
    this.playInternal(name);
  }

  private playInternal(name: SoundName) {
    if (!this.ctx) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(0);
  }
}

export const chessAudio = new ChessAudioManager();

export function getSoundForSan(san: string, isGameOver: boolean, result: string | null): SoundName {
  if (isGameOver) {
    if (result === 'checkmate') return 'checkmate';
    return 'gameOver';
  }
  if (san.includes('#')) return 'checkmate';
  if (san.includes('+')) return 'check';
  if (san === 'O-O' || san === 'O-O-O') return 'castle';
  if (san.includes('x')) return 'capture';
  return 'move';
}
