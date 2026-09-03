import { useEffect, useState } from 'react';
import {
  getPerformanceSettings,
  savePerformanceSettings,
  type PerformanceSettings,
} from '../../game/performanceSettings';

/**
 * Botão ⚙ "Desempenho" + medidor de FPS.
 *
 * O medidor lê `game.loop.actualFps` do Phaser (exposto em window.__cwGame
 * pelo createPhaserGame) 2x por segundo — leve o bastante para ficar ligado.
 * O modo 30/60 FPS é aplicado na criação do jogo, então trocar pede reload.
 */
export function PerformanceHud() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PerformanceSettings>(() => getPerformanceSettings());
  // Modo vigente do jogo em execução (o que estava salvo quando a página abriu).
  const [bootMode] = useState(() => settings.mode);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!settings.showFps) {
      setFps(null);
      return;
    }
    const id = window.setInterval(() => {
      const game = (window as any).__cwGame;
      const value = game?.loop?.actualFps;
      setFps(typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);
    }, 500);
    return () => window.clearInterval(id);
  }, [settings.showFps]);

  const update = (patch: Partial<PerformanceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      savePerformanceSettings(next);
      return next;
    });
  };

  const needsReload = settings.mode !== bootMode;

  return (
    <div className="absolute top-2 right-2 flex items-start gap-2" style={{ zIndex: 30 }}>
      {settings.showFps && (
        <div
          className="rounded-md bg-black/70 px-2 py-1 font-mono text-xs text-lime-300"
          title="Quadros por segundo agora"
        >
          {fps === null ? '-- FPS' : `${fps} FPS`}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-black/70 px-2 py-1 text-sm text-white/90 hover:bg-black/85"
          title="Configurações de desempenho"
          aria-label="Configurações de desempenho"
        >
          ⚙
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-64 rounded-lg bg-black/85 p-3 text-sm text-white shadow-xl backdrop-blur-sm">
            <div className="mb-2 font-semibold">Desempenho</div>

            <div className="mb-2 space-y-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="cw-perf-mode"
                  checked={settings.mode === 'quality'}
                  onChange={() => update({ mode: 'quality' })}
                />
                <span>Qualidade — 60 FPS (padrão)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="cw-perf-mode"
                  checked={settings.mode === 'battery'}
                  onChange={() => update({ mode: 'battery' })}
                />
                <span>Economia — 30 FPS (celular/bateria)</span>
              </label>
              {needsReload && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-1 w-full rounded bg-amber-500/90 px-2 py-1 text-xs font-semibold text-black hover:bg-amber-400"
                >
                  Recarregar para aplicar
                </button>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 border-t border-white/15 pt-2">
              <input
                type="checkbox"
                checked={settings.showFps}
                onChange={(e) => update({ showFps: e.target.checked })}
              />
              <span>Mostrar FPS</span>
            </label>

            <p className="mt-2 text-xs leading-snug text-white/60">
              As otimizações do jogo são automáticas; estas opções são
              preferências do seu aparelho.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
