import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/**
 * The upload worker's own build.
 *
 * A second config rather than a second entry in the app's, because a service worker
 * cannot be a hashed asset: the browser fetches it by a fixed URL, and a worker at
 * `/sw-a1b2c3d4.js` would be a new worker on every deploy with the old one never
 * removed. `entryFileNames: 'sw.js'` is the whole reason this file exists.
 *
 * `format: 'iife'` — a classic worker script, not a module one. Module service workers
 * are Chromium-and-recent-Safari only, and the browsers that lack them are exactly the
 * ones whose guests are on the worst Wi-Fi.
 *
 * Runs after the app build and must not empty the directory it writes into, or it
 * would delete the bundle that was just produced. See `build:web` in package.json.
 */
export default defineConfig({
  root: here('.'),

  build: {
    outDir: here('../dist/client'),
    emptyOutDir: false,
    sourcemap: true,
    // The worker is served to phones and is tiny; a warning here would mean something
    // large was imported by accident, which is worth hearing about immediately.
    chunkSizeWarningLimit: 40,
    rollupOptions: {
      input: here('./sw/serviceWorker.ts'),
      output: {
        entryFileNames: 'sw.js',
        // A classic worker script, not a module one. `iife` also means one file, which
        // a worker needs by definition: it has no loader to fetch a chunk with.
        format: 'iife',
      },
    },
  },
})
