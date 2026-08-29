import path from 'path';
import compression from 'compression';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

import { characterManifestPlugin } from './vite-plugins/character-manifest';
import { characterGeneratorManifestPlugin } from './vite-plugins/character-generator-manifest';
import { craftingMapPlugin } from './vite-plugins/crafting-map';

// Gzip everything the dev server sends (TMJ maps are multi-MB JSON that
// compresses ~10x; the unbundled dev JS also shrinks massively). Production
// static hosting applies its own compression, so this is dev-only by nature.
const devGzip = (): PluginOption => ({
  name: 'dev-gzip',
  configureServer(server) {
    server.middlewares.use(compression({ threshold: 1024 }));
  },
});

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    devGzip(),
    craftingMapPlugin(),
    characterManifestPlugin(),
    characterGeneratorManifestPlugin(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // NOTE: do NOT exclude 'lucide-react' — unbundled it forces the browser to
    // fetch ~1,640 individual icon modules in dev, which loads forever on slow
    // connections. Pre-bundling collapses it into a single file.
    // NOTE: colyseus.js is pinned to ^0.15 to match the protocol of the
    // user's Colyseus Cloud server (deployed from the original Bolt code).
    include: ['lucide-react', 'colyseus.js'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
