import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * maplibre-gl 6 constructs its worker URL at runtime
 * (`new URL('./maplibre-gl-worker.mjs', bundleUrl)`), so Vite neither rewrites
 * nor emits that file for a production build: the request falls through to the
 * SPA fallback (text/html) and the worker never starts — no basemap tiles.
 * Ship the worker from the installed package verbatim into `dist/assets/`,
 * exactly where the bundle-relative URL expects it.
 */
function maplibreWorkerAsset(): Plugin {
  return {
    name: 'maplibre-worker-asset',
    apply: 'build',
    generateBundle() {
      const workerPath = path.join(
        import.meta.dirname,
        'node_modules',
        'maplibre-gl',
        'dist',
        'maplibre-gl-worker.mjs',
      );
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-worker.mjs',
        source: readFileSync(workerPath),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), maplibreWorkerAsset()],
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
