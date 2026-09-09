import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:4300'

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
    // Photos dominate the payload at an event; keeping the JS bundle small is what
    // makes the guest page usable on 4G.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
