/**
 * SFX de coleta (Mundo de Coleta) — WebAudio puro, mesmo padrão do chessAudio:
 * os arquivos são baixados e decodificados UMA vez (no prepare() do mapa) e cada
 * play() cria uma AudioBufferSourceNode nova. Resultado: sons CUMULATIVOS (um
 * golpe nunca corta o som do anterior) e disparo imediato, sem atraso audível.
 *
 * Política "toca agora ou pula": se o buffer ainda não decodificou (rede muito
 * lenta) ou o AudioContext ainda está bloqueado pelo navegador, o golpe fica
 * SEM som — nunca enfileiramos para tocar depois, senão os sons atrasados
 * sairiam em rajada, fora de contexto ou até em outro mapa.
 */
const SFX = {
  chopWood: { path: '/assets/game-audios/chop-wood.mp3', volume: 0.9, jitter: 0.06 },
  pickaxe: { path: '/assets/game-audios/pickaxe.mp3', volume: 0.9, jitter: 0.06 },
  treeFall: { path: '/assets/game-audios/tree-fall.mp3', volume: 1, jitter: 0 },
  rockBreaking: { path: '/assets/game-audios/rock-breaking.mp3', volume: 1, jitter: 0 },
} as const;

type GatherSfxName = keyof typeof SFX;

class GatherAudioManager {
  private buffers = new Map<GatherSfxName, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private initPromise: Promise<void> | null = null;
  private unlockHooked = false;

  /** Pré-carrega e decodifica todos os sons; idempotente (chamadas repetidas reusam). */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.ctx ??= new AudioContext();
      this.hookUnlock();
      const ctx = this.ctx;
      const entries = Object.entries(SFX) as [GatherSfxName, (typeof SFX)[GatherSfxName]][];
      this.initPromise = Promise.all(
        entries.map(async ([name, def]) => {
          try {
            const res = await fetch(def.path);
            this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch (e) {
            console.warn(`[GatherAudio] Falha ao carregar ${name}:`, e);
          }
        }),
      ).then(() => undefined);
    }
    return this.initPromise;
  }

  /** Toca JÁ (cumulativo, uma fonte nova por chamada) ou pula — nunca atrasa. */
  play(name: GatherSfxName): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !buffer) {
      void this.init(); // rede lenta/init perdido: este golpe fica mudo, os próximos não
      return;
    }
    if (ctx.state === 'suspended') {
      // Autoplay do navegador: tenta liberar (funciona após qualquer gesto já
      // feito na página) e pula ESTE som — tocar depois soaria fora de hora.
      ctx.resume().catch(() => {});
      return;
    }
    const def = SFX[name];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Variação sutil de pitch nos golpes repetidos — evita efeito "metralhadora".
    if (def.jitter > 0) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * def.jitter;
    const gain = ctx.createGain();
    gain.gain.value = def.volume;
    source.connect(gain).connect(ctx.destination);
    source.start(0);
  }

  /**
   * Destrava o AudioContext no PRIMEIRO gesto real (clique/tecla) caso ele
   * nasça 'suspended'. Golpear exige teclado/mouse, então na prática o contexto
   * já está liberado antes do primeiro hit; isto é a rede de segurança.
   */
  private hookUnlock(): void {
    if (this.unlockHooked || typeof window === 'undefined') return;
    this.unlockHooked = true;
    const unlock = () => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
  }
}

export const gatherAudio = new GatherAudioManager();
