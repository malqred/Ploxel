import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  root: resolve(here, 'src'),
  base: './',
  plugins: [react()],
  publicDir: resolve(here, 'resources/public'),
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    assetsInlineLimit: 0
  },
  server: {
    port: 5199,
    strictPort: true
  }
});