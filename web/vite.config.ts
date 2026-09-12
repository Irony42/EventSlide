import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const API_TARGET = process.env['VITE_API_TARGET'] ?? 'http://localhost:4300'

export default defineConfig({
  root: here('.'),
  plugins: [react()],

  resolve: {
    alias: {
      '@': here('./src'),
    },
  },

  server: {
    port: 5173,
    // A guest's phone has to reach the dev server over the venue Wi-Fi, so bind on
    // every interface rather than loopback only.
    host: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // Server-sent events must not be buffered by the dev proxy, or the
        // moderation console and the wall appear to hang.
        ws: false,
      },
    },
  },

  build: {
    outDir: here('../dist/client'),
    emptyOutDir: true,
    sourcemap: true,
    // Emitted so the service worker's build can read the hashed file names and precache
    // them. Without a precache the installed app opens to the browser's offline page,
    // and — less obviously — Chromium's algorithm for firing `beforeinstallprompt` still
    // requires a worker with a `fetch` handler, so there would be no install offer to
    // make either. See web/vite.sw.config.ts.
    manifest: true,
    // Photos dominate the payload at an event, so the JS budget is what makes the
    // guest page usable on 4G. Low on purpose: crossing it should prompt a look at
    // what was just imported, not a raised limit.
    chunkSizeWarningLimit: 400,
  },
})
