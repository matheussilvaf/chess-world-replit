/**
 * Standalone vitest config (does NOT extend vite.config.ts — the app config
 * pulls Replit/react plugins and BASE_PATH assumptions that tests don't need).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX automático (como o Vite da app) para testes que renderizam componentes
  // com renderToStaticMarkup — sem isso os .tsx exigiriam `import React`.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'vite-plugins/**/*.test.ts'],
  },
});
