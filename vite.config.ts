import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // maplibre-gl creates its worker via `new Worker(new URL(...), {type:'module'})`.
  // Vite's pre-bundling rewrites that URL and the worker fails to start in dev.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
