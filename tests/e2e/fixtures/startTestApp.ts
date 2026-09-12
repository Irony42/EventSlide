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

/**
 * The password the owner ends up with, after the forced rotation below.
 *
 * `bootstrapOwner` creates the first account with `mustChangePassword: true`, because a
 * password that arrived in an environment variable has been in a shell history, a
 * compose file and probably a chat message. That is correct behaviour and is asserted at
 * ring 5 (`MustChangePasswordGate.test.tsx`), but it is not what any ring-6 journey is
 * about: with the flag set, `MustChangePasswordGate` sends *every* `/admin/**` address
 * to `/admin/password`, so a host fixture that ignores it lands on the change-password
 * screen and every later assertion fails somewhere unrelated.
 *
 * So the rotation is completed once per worker at boot, through the real endpoint, and
 * the journeys start from a settled account.
 */
const OWNER_SETTLED_PASSWORD = 'e2e-fixture-rotated-passphrase-not-a-secret'

/**
 * A cookie jar and a CSRF token, because the fixture talks to the API exactly as a
 * browser does.
 *
 * Not a shortcut around the boundary: writing rows directly would let a fixture create
 * state the application cannot, and a journey built on impossible state proves nothing.
 * Going through the API also means the seeding path is itself covered.
 */
const apiSession = async (baseUrl: string) => {
  const jar: string[] = []

  const remember = (response: Response): void => {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0]
      if (pair !== undefined) jar.push(pair)
    }
  }

  // A CSRF token is issued on any GET, and every write has to echo it. Double-submit,
  // so the cookie is readable by design — guests have no session to bind a token to.
  const primed = await fetch(`${baseUrl}/api/auth/me`)
  remember(primed)
  const csrf = jar.map((pair) => pair.split('=')).find(([key]) => key === 'es_csrf')?.[1]
  if (csrf === undefined) throw new Error('the server issued no CSRF cookie')

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    ...(jar.length > 0 ? { cookie: jar.join('; ') } : {}),
  })

  const post = async (path: string, body?: unknown): Promise<Response> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    remember(response)
    return response
  }

  return { post }
}

/**
 * Signs the owner in and clears the forced-rotation flag, once per worker.
 *
 * Idempotent in effect: after this returns, `OWNER_SETTLED_PASSWORD` is the account's
 * password and `mustChangePassword` is false.
 */
const settleOwnerPassword = async (baseUrl: string): Promise<void> => {
  const api = await apiSession(baseUrl)

  const login = await api.post('/api/auth/login', {
    email: OWNER.email,
    password: OWNER.password,
  })
  if (!login.ok) throw new Error(`the bootstrap owner could not sign in: ${login.status}`)

  const rotated = await api.post('/api/auth/password', {
    currentPassword: OWNER.password,
    newPassword: OWNER_SETTLED_PASSWORD,
  })
  if (!rotated.ok) {
    throw new Error(`the owner's forced password rotation failed with ${rotated.status}`)
  }
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
    await settleOwnerPassword(baseUrl)
  } catch (error) {
    // The server's own output is the only useful diagnostic here: a boot failure is
    // otherwise an opaque timeout. The same applies to a failed rotation, and either
    // way the child has to be reaped or the worker leaks a server and a temp directory.
    const detail = output.join('').slice(-2_000)
    await dispose()
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${detail}`, {
      cause: error,
    })
  }

  /** Seeds through the API rather than by writing SQL — see `apiSession`. */
  const seedEvent = async ({
    slug,
    name,
  }: {
    slug?: string
    name?: string
  }): Promise<SeededEvent> => {
    const api = await apiSession(baseUrl)

    const login = await api.post('/api/auth/login', {
      email: OWNER.email,
      password: OWNER_SETTLED_PASSWORD,
    })
    if (!login.ok) throw new Error(`seed login failed with ${login.status}`)

    /**
     * The slug is unique per server, and the server is per *worker*, not per test.
     *
     * Several specs legitimately ask for the same readable slug — `mariage` is the one
     * every journey wants — so the second of them in a worker gets a 409 and fails while
     * looking like a product bug. Disambiguating on conflict rather than always
     * suffixing keeps the first caller's slug exactly as asked, which is what makes the
     * URLs in a trace readable; later callers get `mariage-2`, `mariage-3`, and every
     * spec navigates by the returned `event.slug` regardless.
     */
    const create = async (attempt: number): Promise<Response> => {
      const response = await api.post('/api/events', {
        // With no slug requested the server derives one from the name, so the name is
        // what has to vary — `seedEvent({})` is the common case (it is what
        // `guestContext` uses) and every call would otherwise derive the same slug.
        name:
          attempt === 1 ? (name ?? 'Camille & Sacha') : `${name ?? 'Camille & Sacha'} ${attempt}`,
        ...(slug === undefined ? {} : { slug: attempt === 1 ? slug : `${slug}-${attempt}` }),
      })
      if (response.status === 409 && attempt < 25) return create(attempt + 1)
      return response
    }

    const created = await create(1)
    if (!created.ok) throw new Error(`seed event failed with ${created.status}`)
    const event = (await created.json()) as { slug: string; name: string; joinCode: string }

    // A newly created event is a draft; guests cannot join until it is live, and a
    // journey that forgets this fails in a confusing place.
    const opened = await api.post(`/api/events/${event.slug}/status`, { status: 'live' })
    if (!opened.ok) throw new Error(`opening the event failed with ${opened.status}`)

    return { slug: event.slug, name: event.name, joinCode: event.joinCode }
  }

  return {
    baseUrl,
    url: (path) => `${baseUrl}${path}`,
    seedEvent,
    owner: { email: OWNER.email, password: OWNER_SETTLED_PASSWORD },
    dispose,
  }
}
