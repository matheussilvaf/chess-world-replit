/**
 * Character Generator — manifest fetching.
 *
 * Tries the dev API endpoint first (fresh scan on every request), then falls
 * back to the static manifest.json that the build step emits. In production
 * the API route doesn't exist and the SPA fallback would answer it with HTML,
 * so the content-type check routes us to the static file there.
 */
import type { GeneratorManifest } from './types';

export async function fetchGeneratorManifest(): Promise<GeneratorManifest> {
  const base = import.meta.env.BASE_URL;
  const candidates = [
    `${base}api/character-generator/manifest`,
    `${base}character-generator/manifest.json`,
  ];

  let lastError = 'unknown';
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        lastError = `${url} → HTTP ${res.status}`;
        continue;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        lastError = `${url} → resposta não-JSON (${contentType || 'sem content-type'})`;
        continue;
      }
      return (await res.json()) as GeneratorManifest;
    } catch (e) {
      lastError = `${url} → ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  throw new Error(`Não foi possível carregar o manifest de assets (${lastError}).`);
}
