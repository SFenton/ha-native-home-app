import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  // A per-checkout dependency cache. Every worktree symlinks one shared node_modules, so the default
  // node_modules/.vite let concurrent dev servers rewrite each other's optimized deps mid-load.
  cacheDir: '.vite-cache',
  plugins: [react()],
  server: { host: '0.0.0.0' },
});
