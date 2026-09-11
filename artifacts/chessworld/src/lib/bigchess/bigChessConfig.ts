/**
 * Config pública do Big Chess Board (`GET /api/bigchess-config`), cacheada por
 * 60 s: os cards mostram benefícios da peça e o efeito de capas/defesas a
 * partir dela. Sem servidor/tabela, cai nos defaults.
 */
import { getColyseusHttpUrl } from '../../config/colyseus';
import { DEFAULT_BIGCHESS_CONFIG, parseBigChessConfig, type BigChessConfig } from '../../shared/bigchess/BigChessShapes';

const TTL_MS = 60_000;
let cache: { config: BigChessConfig; at: number } | null = null;
let inflight: Promise<BigChessConfig> | null = null;

export function loadBigChessConfig(): Promise<BigChessConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.config);
  if (inflight) return inflight;
  inflight = (async () => {
    const base = getColyseusHttpUrl();
    if (!base) return DEFAULT_BIGCHESS_CONFIG;
    try {
      const response = await fetch(`${base.replace(/\/api$/, '')}/api/bigchess-config`);
      if (!response.ok) return cache?.config ?? DEFAULT_BIGCHESS_CONFIG;
      const body = (await response.json()) as { config?: unknown };
      const parsed = parseBigChessConfig(body.config);
      const config = parsed.ok ? parsed.config : DEFAULT_BIGCHESS_CONFIG;
      cache = { config, at: Date.now() };
      return config;
    } catch {
      return cache?.config ?? DEFAULT_BIGCHESS_CONFIG;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function cachedBigChessConfig(): BigChessConfig | null {
  return cache?.config ?? null;
}
