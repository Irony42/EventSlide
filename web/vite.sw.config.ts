import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const CLIENT_DIR = here('../dist/client')

/**
 * What the worker precaches, read from the build that just finished.
 *
 * Vite hashes asset file names, so the list cannot be written by hand and cannot be
 * discovered at runtime — the worker has no directory listing. `build.manifest` in
 * `web/vite.config.ts` writes the mapping, and this reads it back.
 *
 * Only the entry chunk, its imports and its CSS. Lazily-loaded route chunks are
 * deliberately left out: precaching every screen would make a guest on venue Wi-Fi
 * download the admin console and the wall before sending a photo, to save a host who is
 * not offline anyway.
 */
interface ManifestEntry {
  readonly file: string
  readonly css?: readonly string[]
  readonly imports?: readonly string[]
  readonly isEntry?: boolean
}

const precacheList = (): readonly string[] => {
  const manifest = JSON.parse(readFileSync(`${CLIENT_DIR}/.vite/manifest.json`, 'utf8')) as Record<
    string,
    ManifestEntry
  >

  const urls = new Set<string>(['/'])
  const add = (key: string): void => {
    const entry = manifest[key]
    if (entry === undefined) return
    urls.add(`/${entry.file}`)
    for (const style of entry.css ?? []) urls.add(`/${style}`)
    for (const imported of entry.imports ?? []) add(imported)
  }

  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.isEntry === true) add(key)
  }
  return [...urls]
}

/**
 * Injects the precache list and a cache name derived from it.
 *
 * The cache name has to change when the build does, or a guest keeps yesterday's bundle
 * for as long as their browser keeps the cache. Hashing the list gives that for free:
 * same build, same name; new build, new name, and `activate` deletes the old one.
 */
const injectPrecache = (): Plugin => ({
  name: 'eventslide:inject-precache',
  config() {
    const urls = precacheList()
    const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12)
    return {
      define: {
        __PRECACHE_URLS__: JSON.stringify(urls),
        __PRECACHE_VERSION__: JSON.stringify(version),
      },
    }
  },
})

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
 * Runs after the app build, reads its manifest, and must not empty the directory it
 * writes into. See `build:web` in package.json.
 */
export default defineConfig({
  root: here('.'),
  plugins: [injectPrecache()],

  build: {
    outDir: CLIENT_DIR,
    emptyOutDir: false,
    sourcemap: true,
    // The worker is served to phones and is small; a warning here would mean something
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
