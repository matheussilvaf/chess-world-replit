/**
 * Standalone vitest config (does NOT extend vite.config.ts — the app config
 * pulls Replit/react plugins and BASE_PATH assumptions that tests don't need).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'vite-plugins/**/*.test.ts'],
  },
});
