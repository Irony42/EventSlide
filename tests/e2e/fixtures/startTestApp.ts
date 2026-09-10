import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

/**
 * Boots a real EventSlide server for the end-to-end suite.
 *
 * A separate process, deliberately. The alternative — importing `buildServer` into the
 * Playwright worker — would share a module registry and a `sharp` instance with the
 * test, and would let a test reach past the HTTP boundary and mutate state directly.
 * The point of ring 6 is that nothing is reachable except through the same surface a
 * guest's phone uses.
 *
 * Each worker gets its own port, its own SQLite file and its own media root, so workers
 * cannot see each other's photos and a failed run leaves nothing behind.
 */

export interface SeededEvent {
  readonly slug: string
  readonly name: string
  readonly joinCode: string
}

export interface TestApp {
  readonly baseUrl: string
  url(path: string): string
  /** Creates an event through the API, as a host would. */
  seedEvent(input: { slug?: string; name?: string }): Promise<SeededEvent>
  /** The owner account the server bootstrapped, for signing in. */
  readonly owner: { readonly email: string; readonly password: string }
  dispose(): Promise<void>
}

const OWNER = {
  email: 'e2e-host@eventslide.test',
  // Long enough for the policy, and obviously a fixture.
  password: 'e2e-fixture-passphrase-not-a-secret',
}

/** An ephemeral port, taken and released so the server can bind it. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('could not determine a free port')))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })

const waitForReady = async (baseUrl: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 30_000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with code ${child.exitCode} before becoming ready`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/ready`)
      if (response.ok) return
      lastError = new Error(`readiness answered ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new Error(
    `the server never became ready at ${baseUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

export interface StartOptions {
  readonly worker: number
  /** Overrides merged over the defaults, for a test that needs a different limit. */
  readonly env?: Readonly<Record<string, string>>
}

export const startTestApp = async ({ worker, env = {} }: StartOptions): Promise<TestApp> => {
  const root = await mkdtemp(join(tmpdir(), `eventslide-e2e-${worker}-`))
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(
    process.execPath,
    ['--enable-source-maps', join(process.cwd(), 'dist/server/main/index.js')],
    {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        PUBLIC_URL: baseUrl,
        // Deterministic, so a token issued in one test is not affected by another
        // worker's secret, and so a fixture can be reasoned about.
        SESSION_SECRET: `e2e-session-secret-worker-${worker}-padding-padding`,
        GUEST_TOKEN_SECRET: `e2e-guest-secret-worker-${worker}-padding-padding`,
        DATABASE_PATH: join(root, 'eventslide.sqlite'),
        MEDIA_ROOT: join(root, 'media'),
        // The wall's timing hooks, so a visual test does not wait ten real seconds per
        // slide. The config module refuses to boot production with this set.
        E2E_HOOKS: '1',
        // Rate limits high enough that a fast test suite is not throttled — the limits
        // themselves are asserted in the security specs, which set them down again.
        UPLOAD_RATE_LIMIT_PER_MINUTE: '600',
        JOIN_RATE_LIMIT_PER_MINUTE: '600',
        LOGIN_RATE_LIMIT_PER_MINUTE: '600',
        REACTION_RATE_LIMIT_PER_MINUTE: '600',
        // Cost 10 rather than 12: this is the floor the hasher accepts, and it takes
        // roughly a quarter of the time. Every login in the suite pays it.
        BCRYPT_COST: '10',
        BOOTSTRAP_OWNER_EMAIL: OWNER.email,
        BOOTSTRAP_OWNER_PASSWORD: OWNER.password,
        LOG_LEVEL: 'warn',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  // Kept so a failure can be explained: a server that never becomes ready is otherwise
  // an opaque timeout.
  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))

  const dispose = async (): Promise<void> => {
    if (child.exitCode === null) {
      // SIGTERM so the graceful shutdown runs and the WAL is checkpointed; if it does
      // not exit, the kill below is the backstop.
      child.kill('SIGTERM')
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    await rm(root, { recursive: true, force: true })
  }

  try {
    await waitForReady(baseUrl, child)
  } catch (error) {
    // The server's own output is the only useful diagnostic here: a boot failure is
    // otherwise an opaque timeout.
    const detail = output.join('').slice(-2_000)
    await dispose()
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${detail}`, {
      cause: error,
    })
  }

  /**
   * Seeds through the API rather than by writing SQL.
   *
   * Writing rows directly would let a fixture create state the application cannot,
   * and a journey built on impossible state proves nothing. It also means the seeding
   * path is itself covered.
   */
  const seedEvent = async ({
    slug,
    name,
  }: {
    slug?: string
    name?: string
  }): Promise<SeededEvent> => {
    const jar: string[] = []
    const withCookies = (headers: Record<string, string> = {}): Record<string, string> =>
      jar.length > 0 ? { ...headers, cookie: jar.join('; ') } : headers

    const remember = (response: Response): void => {
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0]
        if (pair !== undefined) jar.push(pair)
      }
    }

    // A CSRF token is issued on any GET, and every write has to echo it.
    const primed = await fetch(`${baseUrl}/api/auth/me`)
    remember(primed)
    const csrf = jar.map((pair) => pair.split('=')).find(([key]) => key === 'es_csrf')?.[1]
    if (csrf === undefined) throw new Error('the server issued no CSRF cookie')

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: withCookies({ 'content-type': 'application/json', 'x-csrf-token': csrf }),
      body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
    })
    if (!login.ok) throw new Error(`seed login failed with ${login.status}`)
    remember(login)

    const created = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: withCookies({ 'content-type': 'application/json', 'x-csrf-token': csrf }),
      body: JSON.stringify({
        name: name ?? 'Camille & Sacha',
        ...(slug === undefined ? {} : { slug }),
      }),
    })
    if (!created.ok) throw new Error(`seed event failed with ${created.status}`)
    const event = (await created.json()) as { slug: string; name: string; joinCode: string }

    // A newly created event is a draft; guests cannot join until it is live, and a
    // journey that forgets this fails in a confusing place.
    const opened = await fetch(`${baseUrl}/api/events/${event.slug}/status`, {
      method: 'POST',
      headers: withCookies({ 'content-type': 'application/json', 'x-csrf-token': csrf }),
      body: JSON.stringify({ status: 'live' }),
    })
    if (!opened.ok) throw new Error(`opening the event failed with ${opened.status}`)

    return { slug: event.slug, name: event.name, joinCode: event.joinCode }
  }

  return {
    baseUrl,
    url: (path) => `${baseUrl}${path}`,
    seedEvent,
    owner: OWNER,
    dispose,
  }
}
