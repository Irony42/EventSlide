import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { hostEnvironment } from '../fixtures/childEnvironment'
import { aPhoto } from '../fixtures/media'
import { bootServer, type BootedServer } from '../fixtures/startTestApp'

/**
 * The round trip, end to end: seed a real installation, back it up while the server is
 * running, destroy both halves, restore, and boot a **second real server** against the
 * restored pair to prove it serves the same evening.
 *
 * This spec does not use the shared `app` fixture, because the thing under test is the
 * pair of paths a server is pointed at — the database file and the media root — and the
 * fixture owns a temp directory it never exposes. `tests/e2e/fixtures/startTestApp.ts`
 * is the model for everything below: its own port, its own database, its own media
 * root, a real `dist` build in a separate process.
 *
 * It earns its seconds the way ring 6 is supposed to. A restore that has never been
 * booted is a hope, not a backup, and every part that could hide a failure lives
 * outside the module's own tests: SQLite reading back a file written by `VACUUM INTO`
 * from another process, the migration ledger surviving intact so the boot-time guard
 * does not refuse it, the media paths the store rebuilds from an event id and a content
 * hash, and a browser rendering the bytes on a wall.
 */

// Booting two servers, two builds' worth of migrations and a full checksummed round
// trip. The default 60s is a browser budget, not a filesystem one.
test.setTimeout(180_000)

test.describe('backup and restore', () => {
  const OWNER = {
    email: 'backup-host@eventslide.test',
    password: 'backup-fixture-passphrase-not-a-secret',
  }
  const ROTATED = 'backup-fixture-rotated-passphrase-not-a-secret'

  /** A real EventSlide, on a chosen database and media root. */
  const boot = (input: {
    databasePath: string
    mediaRoot: string
    worker: number
  }): Promise<BootedServer> => bootServer({ ...input, owner: OWNER })

  /**
   * A cookie jar and a CSRF token, so the spec talks to the API exactly as a browser
   * does. Writing rows directly would let it build state the application cannot.
   */
  const client = async (baseUrl: string) => {
    const jar = new Map<string, string>()

    const remember = (response: Response): void => {
      for (const value of response.headers.getSetCookie()) {
        const [name, ...rest] = (value.split(';')[0] ?? '').split('=')
        if (name !== undefined && rest.length > 0) jar.set(name, rest.join('='))
      }
    }

    const cookie = (): string =>
      [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

    const primed = await fetch(`${baseUrl}/api/auth/me`)
    remember(primed)

    /**
     * Read from the jar at send time, never captured once.
     *
     * The server rotates `es_csrf` in the same gesture as `session.regenerate()` and
     * `session.destroy()`, so a value read before the login below would be the stale
     * half of the pair from that point on, and every later write would be refused with
     * `request.csrfMismatch` — a product failure this spec is not about. A browser
     * re-reads the cookie for every request, and this client exists to behave like one.
     */
    const csrf = (): string => {
      const token = jar.get('es_csrf')
      if (token === undefined) throw new Error('the server issued no CSRF cookie')
      return token
    }

    const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf(),
          ...(jar.size > 0 ? { cookie: cookie() } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      remember(response)
      return response
    }

    return {
      get: (path: string) => send('GET', path),
      post: (path: string, body?: unknown) => send('POST', path, body),
      patch: (path: string, body?: unknown) => send('PATCH', path, body),
      upload: async (path: string, bytes: Uint8Array): Promise<Response> => {
        // Copied into a freshly allocated buffer rather than wrapped: a Buffer's backing
        // store is typed as possibly shared, and a Blob part may not be.
        const part = new Uint8Array(bytes.byteLength)
        part.set(bytes)
        const form = new FormData()
        form.append('photos', new Blob([part], { type: 'image/jpeg' }), 'confettis.jpg')
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'x-csrf-token': csrf(), cookie: cookie() },
          body: form,
        })
        remember(response)
        return response
      },
    }
  }

  /**
   * Runs one of the two commands under test, as an operator would.
   *
   * `NODE_ENV: 'test'` for the same reason the server above is given it: this suite runs
   * under a workflow that sets `E2E_HOOKS=1` for every job, and `NODE_ENV` now defaults to
   * `production`, where enabling the display hooks is a boot refusal. Inheriting the
   * ambient environment unchanged therefore ran the backup against a *different*
   * environment than the server it was backing up — which is the bug, not the refusal.
   */
  const run = (script: string, args: readonly string[]): Promise<{ code: number; out: string }> =>
    new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(
        process.execPath,
        ['--import', 'tsx', join(process.cwd(), 'scripts', script), ...args],
        {
          cwd: process.cwd(),
          env: { ...hostEnvironment(process.env), NODE_ENV: 'test' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const lines: string[] = []
      child.stdout?.on('data', (chunk: Buffer) => lines.push(chunk.toString()))
      child.stderr?.on('data', (chunk: Buffer) => lines.push(chunk.toString()))
      child.once('error', reject)
      child.once('close', (code) => resolve({ code: code ?? -1, out: lines.join('') }))
    })

  interface WallItem {
    readonly id: string
    readonly displayUrl: string
    readonly thumbUrl: string
    readonly caption: string | null
    readonly authorName: string | null
  }
  interface Wall {
    readonly event: { readonly slug: string; readonly name: string }
    readonly revision: string
    readonly items: readonly WallItem[]
  }

  const sha256 = (bytes: ArrayBuffer): string =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex')

  test('an archive taken from a live server restores into a working wall', async ({
    page,
  }, testInfo) => {
    // Two servers, two builds' worth of migrations and a checksummed round trip. In a
    // second browser engine it would cost the same minutes and assert nothing new.
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'the round trip is infrastructure, not a rendering difference',
    )

    const root = await mkdtemp(join(tmpdir(), `eventslide-backup-e2e-${testInfo.workerIndex}-`))
    const databasePath = join(root, 'eventslide.sqlite')
    const mediaRoot = join(root, 'media')
    const archive = join(root, 'archive')
    const servers: BootedServer[] = []

    try {
      // ------------------------------------------------------- an evening --
      const first = await boot({ databasePath, mediaRoot, worker: testInfo.workerIndex })
      servers.push(first)

      const host = await client(first.baseUrl)
      const signedIn = await host.post('/api/auth/login', {
        email: OWNER.email,
        password: OWNER.password,
      })
      expect(signedIn.ok, 'the bootstrap owner could not sign in').toBe(true)
      // The first account is created with mustChangePassword; settle it so the
      // restored installation is asserted on an ordinary account.
      expect(
        (
          await host.post('/api/auth/password', {
            currentPassword: OWNER.password,
            newPassword: ROTATED,
          })
        ).ok,
      ).toBe(true)

      const created = await host.post('/api/events', { name: 'Camille & Sacha' })
      expect(created.status).toBe(201)
      const event = (await created.json()) as { slug: string; joinCode: string }
      expect((await host.post(`/api/events/${event.slug}/status`, { status: 'live' })).ok).toBe(
        true,
      )

      const guest = await client(first.baseUrl)
      const joined = await guest.post('/api/join', {
        joinCode: event.joinCode,
        displayName: 'Lea',
      })
      expect(joined.ok, 'the guest could not join').toBe(true)

      const uploaded = await guest.upload(
        `/api/events/${event.slug}/photos`,
        await readFile(await aPhoto('confettis')),
      )
      expect(uploaded.status).toBe(201)
      const outcome = (await uploaded.json()) as {
        results: readonly { status: string; photoId?: string }[]
      }
      const photoId = outcome.results[0]?.photoId
      expect(outcome.results[0]?.status).toBe('accepted')
      expect(photoId).toBeDefined()

      expect(
        (
          await host.patch(`/api/events/${event.slug}/photos/${photoId ?? ''}/status`, {
            decision: 'publish',
          })
        ).ok,
      ).toBe(true)

      const wallBefore = (await (await host.get(`/api/events/${event.slug}/wall`)).json()) as Wall
      expect(wallBefore.items).toHaveLength(1)
      const displayBefore = sha256(
        await (
          await fetch(`${first.baseUrl}${wallBefore.items[0]?.displayUrl ?? ''}`)
        ).arrayBuffer(),
      )

      // -------------------------------------- back up the running server --
      // Not after a shutdown: taking a backup mid-event is the case that matters, and
      // it is the one a naive file copy gets wrong, because the rows above are still
      // in the write-ahead log.
      const backup = await run('backup.ts', [
        '--to',
        archive,
        '--database',
        databasePath,
        '--media',
        mediaRoot,
      ])
      expect(backup.out).toContain('VACUUM INTO')
      expect(backup.out, backup.out).toContain('OK ')
      expect(backup.code, backup.out).toBe(0)
      expect(backup.out).toContain('1 event(s), 1 photo(s)')

      // -------------------------------------------------------- destroy --
      await first.stop()
      servers.pop()
      for (const suffix of ['', '-wal', '-shm']) {
        await rm(`${databasePath}${suffix}`, { force: true })
      }
      await rm(mediaRoot, { recursive: true, force: true })
      await expect(stat(databasePath)).rejects.toThrow()

      // -------------------------------------------------------- restore --
      const restore = await run('restore.ts', [
        archive,
        '--database',
        databasePath,
        '--media',
        mediaRoot,
      ])
      expect(restore.code, restore.out).toBe(0)
      // The archive and this build are a matched pair: the ledger came back intact, so
      // the migrator has nothing to do and nothing to refuse.
      expect(restore.out).toContain('the schema already matches this build')

      // ------------------------------------------ boot on what came back --
      const second = await boot({ databasePath, mediaRoot, worker: testInfo.workerIndex })
      servers.push(second)
      // A restored database that looked "migrated by a newer build", or whose ledger
      // checksum had drifted, would have made this boot exit 78 instead.
      expect(second.output()).not.toContain('MigrationError')

      const after = await client(second.baseUrl)
      const wallAfter = (await (await after.get(`/api/events/${event.slug}/wall`)).json()) as Wall

      expect(wallAfter.items).toHaveLength(1)
      expect(wallAfter.event.name).toBe('Camille & Sacha')
      expect(wallAfter.items[0]?.authorName).toBe('Lea')
      // Order-sensitive fingerprint of the playlist: the same evening, not merely the
      // same number of rows.
      expect(wallAfter.revision).toBe(wallBefore.revision)

      const displayAfter = sha256(
        await (
          await fetch(`${second.baseUrl}${wallAfter.items[0]?.displayUrl ?? ''}`)
        ).arrayBuffer(),
      )
      expect(displayAfter, 'the restored photo is not byte-identical').toBe(displayBefore)

      // The host's account came back too, password hash included.
      const hostAgain = await client(second.baseUrl)
      expect(
        (await hostAgain.post('/api/auth/login', { email: OWNER.email, password: ROTATED })).ok,
      ).toBe(true)

      // --------------------------------------- and a room can see it --
      await page.goto(`${second.baseUrl}/e/${event.slug}/display?e2e_interval=250&e2e_transition=0`)
      const photo = page.locator('img').first()
      await expect(photo).toBeVisible()
      await expect
        .poll(async () => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0)
    } finally {
      for (const server of servers) await server.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('restore refuses to overwrite an installation that is still there', async (// No browser is needed here, and Playwright parses this parameter list to decide
  // which fixtures to build, so the empty pattern is the way to ask for none.
  // eslint-disable-next-line no-empty-pattern
  {}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'a CLI refusal does not vary by browser',
    )

    const root = await mkdtemp(join(tmpdir(), `eventslide-refuse-e2e-${testInfo.workerIndex}-`))
    const databasePath = join(root, 'eventslide.sqlite')
    const mediaRoot = join(root, 'media')
    const archive = join(root, 'archive')
    const servers: BootedServer[] = []

    try {
      const server = await boot({ databasePath, mediaRoot, worker: testInfo.workerIndex })
      servers.push(server)
      const host = await client(server.baseUrl)
      expect(
        (await host.post('/api/auth/login', { email: OWNER.email, password: OWNER.password })).ok,
      ).toBe(true)
      expect(
        (
          await host.post('/api/auth/password', {
            currentPassword: OWNER.password,
            newPassword: ROTATED,
          })
        ).ok,
      ).toBe(true)
      expect((await host.post('/api/events', { name: 'Gala' })).status).toBe(201)

      expect(
        (
          await run('backup.ts', [
            '--to',
            archive,
            '--database',
            databasePath,
            '--media',
            mediaRoot,
          ])
        ).code,
      ).toBe(0)
      await server.stop()
      servers.pop()

      const refused = await run('restore.ts', [
        archive,
        '--database',
        databasePath,
        '--media',
        mediaRoot,
      ])

      expect(refused.code, refused.out).toBe(1)
      expect(refused.out).toContain('Refusing to overwrite an existing installation')
      expect(refused.out).toContain('--force')
      // Nothing was touched, which is the only thing that makes the refusal worth
      // anything.
      await expect(stat(databasePath)).resolves.toBeTruthy()
    } finally {
      for (const server of servers) await server.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
