/**
 * Preferências de desempenho do jogador (persistidas no aparelho).
 *
 * - mode 'quality'  → 60 FPS (padrão)
 * - mode 'battery'  → limita a 30 FPS: menos bateria/aquecimento em celulares
 *   e computadores fracos. Aplicado na CRIAÇÃO do jogo (exige recarregar).
 * - showFps         → mostra o medidor de FPS no canto da tela.
 *
 * As otimizações de verdade (culling, caches, menos alocações) são sempre
 * automáticas — aqui ficam só as escolhas que dependem do aparelho do jogador.
 */
export type PerformanceMode = 'quality' | 'battery';

export interface PerformanceSettings {
  mode: PerformanceMode;
  showFps: boolean;
}

const STORAGE_KEY = 'cw-performance-settings';

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  mode: 'quality',
  showFps: false,
};

export function getPerformanceSettings(): PerformanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PerformanceSettings>;
      return {
        mode: parsed.mode === 'battery' ? 'battery' : 'quality',
        showFps: parsed.showFps === true,
      };
    }
  } catch {
    // localStorage indisponível/corrompido — segue com o padrão.
  }
  return { ...DEFAULT_PERFORMANCE_SETTINGS };
}

export function savePerformanceSettings(settings: PerformanceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sem storage (modo privado etc.) — a escolha vale só até fechar a aba.
  }
}
