import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// box2d3-wasm's package entry picks the threaded "deluxe" build whenever SIMD
// is available outside a browser (e.g. Node/Vitest). We always want the
// single-threaded "compat" build (GitHub Pages cannot send COOP/COEP headers),
// so we alias straight to it. Only src/physics/engine.ts imports this alias.
const box2dCompat = fileURLToPath(
  new URL('./node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs', import.meta.url),
);

export default defineConfig({
  base: '/the-little-lander/',
  resolve: {
    alias: {
      '#box2d-compat': box2dCompat,
    },
  },
  optimizeDeps: {
    // The wasm loader resolves its .wasm next to the .mjs; pre-bundling breaks that.
    exclude: ['box2d3-wasm'],
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
