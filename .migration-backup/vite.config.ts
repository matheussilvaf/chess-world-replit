import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,

  },
  resolve: {
    dedupe: ['@colyseus/schema'],
    alias: {
      '@colyseus/schema': path.resolve(__dirname, 'node_modules/@colyseus/schema/build/esm/index.mjs'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['colyseus.js', '@colyseus/schema'],
  },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
