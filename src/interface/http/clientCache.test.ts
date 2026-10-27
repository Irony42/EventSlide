import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isContentHashedAsset } from './clientCache'
import { buildServerHarness } from './testing/serverHarness'

/**
 * Which files of the built web app are cached for a year, and which are revalidated.
 *
 * **The audience is the room and the guest on bad venue Wi-Fi.** Every chunk of the app is
 * fetched at each page load; a chunk whose name changes when its content does can be kept
 * for good, and one that is not cannot. The rule that tells them apart sat in `server.ts`
 * as `/\.[0-9a-f]{8,}\./`, a shape Vite does not emit — it names `index-Bm0-ak5a.js` — so
 * no asset was ever marked `immutable`, and the one test that held it was fed a name
 * (`assets/app.0a1b2c3d.js`) that no build produces. OWASP ZAP's passive scan is what
 * showed `max-age=0` on every chunk of the real build.
 *
 * The names below are the build's own, copied from `dist/client/` after `npm run build`
 * (Vite 8, whose default is `assets/[name]-[hash][extname]` with eight base64url
 * characters), and not invented to suit the pattern. If a Vite upgrade changes the
 * naming, this is the file that has to say so.
 */

/** Emitted by the build under `assets/`, named after their own content. */
const HASHED = [
  'assets/index-Bm0-ak5a.js',
  'assets/index-Bp3_lgP8.css',
  'assets/WallPage-DRGdbwjo.js',
  // A hash may end in the separator itself: the build emitted this one.
  'assets/ClientSpacePage-DDFGgAb-.js',
  // A dot in the chunk's own name (a CSS module) is part of the name, not of the hash.
  'assets/Table.module-D2oF6VeR.js',
  // `sourcemap: true`: a map takes the name of the file it describes and ends in `.map`.
  'assets/index-Bm0-ak5a.js.map',
  'assets/AboutPage-CgT-Bf5F.js.map',
] as const

/**
 * Everything else the client directory holds, and every shape that is *near* the rule.
 * A name a person chose can be reused with new content, so none may be cached for good.
 */
const REVALIDATED = [
  // The shell and the worker: their names never change, their content does at each deploy.
  'index.html',
  'sw.js',
  'sw.js.map',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-maskable-512.png',
  // Sits in the root of the client directory and ends `-<eight characters>.txt`: the shape
  // of a hash, which is what anchoring the rule to `assets/` is for.
  'third-party-licenses.txt',
  // The shape that was written for and that nothing emits.
  'assets/app.0a1b2c3d.js',
  // Eight characters, but not under `assets/`: the build did not put it there.
  'index-Bm0-ak5a.js',
  'chunks/index-Bm0-ak5a.js',
  'assets/sub/index-Bm0-ak5a.js',
  // A hash of seven or nine characters is not what the build emits either.
  'assets/index-Bm0-ak5.js',
  'assets/index-Bm0-ak5a1.js',
  // No hash at all, or only the dash.
  'assets/index.js',
  'assets/index-.js',
  'assets/vendor-v1.js',
  // A name with no extension is not a file the build emits.
  'assets/index-Bm0-ak5a',
  // `.map` is the only suffix after the extension that a build emits.
  'assets/index-Bm0-ak5a.js.bak',
  'assets/index-Bm0-ak5a.js.map.gz',
] as const

const CLIENT_DIR = join(tmpdir(), 'eventslide-client-cache-test', 'dist', 'client')

describe('isContentHashedAsset: which files of the built client may be cached for good', () => {
  it.each(HASHED)('accepts %s, a name the build derives from its content', (name) => {
    expect(isContentHashedAsset(CLIENT_DIR, join(CLIENT_DIR, ...name.split('/')))).toBe(true)
  })

  it.each(REVALIDATED)('refuses %s, a name that can be reused with other content', (name) => {
    expect(isContentHashedAsset(CLIENT_DIR, join(CLIENT_DIR, ...name.split('/')))).toBe(false)
  })

  it('reads the path under the client directory, not wherever that directory happens to sit', () => {
    // `setHeaders` is handed the file's absolute path. A box whose client directory sits under
    // a folder called `assets` must not make the files in its root look like the build's.
    const underAssets = join(tmpdir(), 'assets')

    expect(isContentHashedAsset(underAssets, join(underAssets, 'third-party-licenses.txt'))).toBe(
      false,
    )
    expect(isContentHashedAsset(underAssets, join(underAssets, 'index-Bm0-ak5a.js'))).toBe(false)
    expect(
      isContentHashedAsset(underAssets, join(underAssets, 'assets', 'index-Bm0-ak5a.js')),
    ).toBe(true)
  })

  it('refuses a file outside the client directory', () => {
    expect(
      isContentHashedAsset(CLIENT_DIR, join(CLIENT_DIR, '..', 'assets', 'index-Bm0-ak5a.js')),
    ).toBe(false)
  })
})

describe('buildServer: the Cache-Control of the built client, by name', () => {
  let clientDir: string

  beforeAll(async () => {
    clientDir = await mkdtemp(join(tmpdir(), 'eventslide-client-cache-'))
    for (const name of [...HASHED, ...REVALIDATED]) {
      const file = join(clientDir, ...name.split('/'))
      await mkdir(dirname(file), { recursive: true })
      // Valid JSON in every file: a `.map` and the manifest are answered as JSON, and the
      // HTTP client parses a body it is told is JSON.
      await writeFile(file, '{}\n', 'utf8')
    }
  })

  afterAll(async () => {
    await rm(clientDir, { recursive: true, force: true })
  })

  const serve = (isProduction: boolean) =>
    request(buildServerHarness({ config: { isProduction }, clientDir }).app)

  it.each(HASHED)('serves %s for a year, unchanged, in production', async (name) => {
    const response = await serve(true).get(`/${name}`)

    expect(response.status).toBe(200)
    expect(response.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  // `index.html` is answered `no-cache` by its own branch; the others fall to the static
  // default, `public, max-age=0`. Both are revalidation, and that is the claim.
  it.each(REVALIDATED)('revalidates %s in production', async (name) => {
    const response = await serve(true).get(`/${name}`)

    expect(response.status).toBe(200)
    expect(response.get('cache-control')).not.toContain('immutable')
    expect(response.get('cache-control')).toMatch(/(^|, )(no-cache|max-age=0)(,|$)/)
  })

  it.each(HASHED)('keeps %s revalidated in development, where assets are rebuilt', async (name) => {
    const response = await serve(false).get(`/${name}`)

    expect(response.get('cache-control')).not.toContain('immutable')
  })

  it('answers a client route that no file backs with the shell, revalidated', async () => {
    // `/legal` and `/about` are routes of the web app, not files: the fallback answers them
    // with `index.html`, which must never be kept past the deploy that replaces its assets.
    for (const path of ['/legal', '/about', '/assets/not-a-file-Bm0-ak5a.js']) {
      const response = await serve(true).get(path)

      expect(response.get('cache-control'), path).toBe('no-cache')
    }
  })
})
