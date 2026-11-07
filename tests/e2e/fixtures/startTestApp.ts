import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import type { EventLanguage, MissionScope } from '../../../web/src/lib/api/dto'
import { serverEnvironment, type EventCreation } from './childEnvironment'
import { sessionOn, succeeded, type Reply } from './session'

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

export type { EventCreation }

export interface SeededEvent {
  readonly slug: string
  readonly name: string
  readonly joinCode: string
}

export interface TestApp {
  readonly baseUrl: string
  url(path: string): string
  /** Creates an event through the API, as a host would. */
  seedEvent(input: {
    slug?: string
    name?: string
    /**
     * The language the event's projected wall will speak (roadmap 1.5).
     *
     * Through the create body, exactly as the host's own form sends it, because that is
     * the only way a wall language is ever set at creation — a fixture writing the
     * settings blob directly would be building state the application cannot.
     */
    wallLanguage?: EventLanguage
  }): Promise<SeededEvent>
  /**
   * Adds a photo mission to an already-seeded event, through the API exactly as the
   * host's own panel would (`POST /events/:slug/missions`) — see `seedEvent` for why
   * this never writes SQL directly.
   */
  createMission(eventSlug: string, input: { prompt: string; scope: MissionScope }): Promise<void>
  /** The owner account the server bootstrapped, for signing in. */
  readonly owner: { readonly email: string; readonly password: string }
  /**
   * The SQLite file this server is actually running on, for **reading** a fact the HTTP
   * surface does not expose.
   *
   * Exactly one thing needs it today, and it is the premise of the site-operator spec:
   * nothing in the API carried an account's site role when this was written (`/api/auth/me`
   * reports a `canOperateSite` verdict since G2-11, and a premise should not come from the
   * surface under test) — so a
   * spec asserting that "the operator" is refused had no way to establish that the
   * account it signed in as was an operator at all, and asserted 404s that any signed-in
   * stranger produces just as well. The same suite would have stayed green with
   * `bootstrapOwner` writing `'none'`.
   *
   * Reading is not the shortcut `session.ts` refuses. Writing rows would let a fixture
   * build state the application cannot, and a journey on impossible state proves nothing;
   * reading one back is what ring 6 already does to the media root when it checks that a
   * stored file carries no EXIF.
   *
   * **Three narrow exceptions write**, all for a fact that no route can yet establish. Two are
   * in `tenant-isolation.spec.ts`: switching an account off (`setAccountDisabled`), and
   * enrolling an account in a client under `EVENT_CREATION=clientMembers` (`enrolInAClient`).
   * The third is `fixtures/clients.ts`, which opens the file itself to make a client with its
   * ceilings and to move a stored instant (a build has no clock seam). All three are there because
   * the operator API that creates clients is G2-14; when that ships, the second and the third
   * become requests. Nothing else may write through it.
   */
  readonly databasePath: string
  /** The policy this server was started under. A spec that depends on it says so. */
  readonly eventCreation: EventCreation
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
export const OWNER_SETTLED_PASSWORD = 'e2e-fixture-rotated-passphrase-not-a-secret'

/**
 * Signs the owner in and clears the forced-rotation flag, once per worker.
 *
 * Idempotent in effect: after this returns, `OWNER_SETTLED_PASSWORD` is the account's
 * password and `mustChangePassword` is false.
 */
const settleOwnerPassword = async (baseUrl: string): Promise<void> => {
  const api = await sessionOn(baseUrl)

  const login = await api.post('/api/auth/login', {
    email: OWNER.email,
    password: OWNER.password,
  })
  if (!succeeded(login)) {
    throw new Error(`the bootstrap owner could not sign in: ${login.status}`)
  }

  const rotated = await api.post('/api/auth/password', {
    currentPassword: OWNER.password,
    newPassword: OWNER_SETTLED_PASSWORD,
  })
  if (!succeeded(rotated)) {
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
  /**
   * `EVENT_CREATION`. `clientMembers` also turns `SITE_ADMIN` on, because boot refuses the
   * one without the other (roadmap §10.9): the fixture states the pair a real operator
   * would, instead of a configuration the server would reject.
   */
  readonly eventCreation?: EventCreation
}

export interface BootOptions extends StartOptions {
  /** The two paths a server is pointed at: what a restore puts back. */
  readonly databasePath: string
  readonly mediaRoot: string
  /** The account the server bootstraps on an empty database. */
  readonly owner?: { readonly email: string; readonly password: string }
}

/** A running server process, with no account settled and no directory of its own. */
export interface BootedServer {
  readonly baseUrl: string
  /** What the process has written so far, to explain a failure. */
  output(): string
  /** SIGTERM so the graceful shutdown runs and the WAL is checkpointed; SIGKILL is the backstop. */
  stop(): Promise<void>
}

/**
 * How many times a boot may lose the race for its port before the error is the answer.
 *
 * `freePort` picks a port and releases it, and the server binds it a moment later: another
 * worker's server, or a browser's ephemeral connection, can take it in between (`listen
 * EADDRINUSE`, `accessibility.spec.ts` on webkit-mobile). The window cannot be closed from
 * outside the server — it prints no bound port — so a lost race is retried on a fresh port.
 * Only that failure is retried: any other exit is a real boot error and surfaces at once.
 */
export const BOOT_ATTEMPTS = 5

/** Whether a failed boot's output says the port was taken, so a fresh one may work. */
export const lostThePort = (output: string): boolean => output.includes('EADDRINUSE')

/**
 * Runs `boot` again while it fails because its port was taken, at most {@link BOOT_ATTEMPTS}
 * times in all. Any other failure, and the last lost race, reject with the boot's own error.
 */
export const retryOnLostPort = async <T>(boot: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await boot()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (attempt >= BOOT_ATTEMPTS || !lostThePort(detail)) throw error
    }
  }
}

const bootOnce = async ({
  worker,
  databasePath,
  mediaRoot,
  env = {},
  eventCreation = 'anyAccount',
  owner = OWNER,
}: BootOptions): Promise<BootedServer> => {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(
    process.execPath,
    ['--enable-source-maps', join(process.cwd(), 'dist/server/main/index.js')],
    {
      env: serverEnvironment({
        host: process.env,
        worker,
        port,
        baseUrl,
        databasePath,
        mediaRoot,
        eventCreation,
        owner,
        overrides: env,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  // Kept so a failure can be explained: a server that never becomes ready is otherwise
  // an opaque timeout.
  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))

  const stop = async (): Promise<void> => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }

  try {
    await waitForReady(baseUrl, child)
  } catch (error) {
    // The server's own output is the only useful diagnostic here, and the child has to be
    // reaped or the worker leaks a server.
    const detail = output.join('').slice(-2_000)
    await stop()
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${detail}`, {
      cause: error,
    })
  }

  return { baseUrl, output: () => output.join(''), stop }
}

/**
 * Starts the built server on a free port against the given database and media root, and
 * returns once it answers `/api/ready`.
 *
 * The one place a server is spawned: `startTestApp` makes a directory and settles the owner
 * on top of it, and a spec that is about the paths themselves (backup and restore boots a
 * second server on the restored pair) calls this with its own.
 *
 * Two servers that must accept each other's signed tokens (a restored database keeps its
 * sessions and guest cookies) have to be booted with the same `worker`: the secrets are
 * derived from it.
 *
 * A boot that loses the race for its port is retried, up to {@link BOOT_ATTEMPTS} times, on a
 * fresh one; see there.
 */
export const bootServer = (options: BootOptions): Promise<BootedServer> =>
  retryOnLostPort(() => bootOnce(options))

export const startTestApp = async ({
  worker,
  env = {},
  eventCreation = 'anyAccount',
}: StartOptions): Promise<TestApp> => {
  const root = await mkdtemp(join(tmpdir(), `eventslide-e2e-${worker}-`))
  const databasePath = join(root, 'eventslide.sqlite')

  const reap = async (running: BootedServer | undefined): Promise<void> => {
    await running?.stop()
    await rm(root, { recursive: true, force: true })
  }

  const server = await bootServer({
    worker,
    databasePath,
    mediaRoot: join(root, 'media'),
    env,
    eventCreation,
  }).catch(async (error: unknown) => {
    // A boot failure already carries the server's output; the directory still has to go.
    await reap(undefined)
    throw error
  })

  try {
    await settleOwnerPassword(server.baseUrl)
  } catch (error) {
    // A failed rotation is explained by the server's own output, and the child has to be
    // reaped or the worker leaks a server and a temp directory.
    const message = error instanceof Error ? error.message : String(error)
    const detail = server.output().slice(-2_000)
    await reap(server)
    throw new Error(`${message}\n\n${detail}`, { cause: error })
  }

  const dispose = (): Promise<void> => reap(server)
  const baseUrl = server.baseUrl

  /** Seeds through the API rather than by writing SQL — see `session.ts`. */
  const seedEvent = async ({
    slug,
    name,
    wallLanguage,
  }: {
    slug?: string
    name?: string
    wallLanguage?: EventLanguage
  }): Promise<SeededEvent> => {
    const api = await sessionOn(baseUrl)

    const login = await api.post('/api/auth/login', {
      email: OWNER.email,
      password: OWNER_SETTLED_PASSWORD,
    })
    if (!succeeded(login)) throw new Error(`seed login failed with ${login.status}`)

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
    const create = async (attempt: number): Promise<Reply> => {
      const response = await api.post('/api/events', {
        // With no slug requested the server derives one from the name, so the name is
        // what has to vary — `seedEvent({})` is the common case (it is what
        // `guestContext` uses) and every call would otherwise derive the same slug.
        name:
          attempt === 1 ? (name ?? 'Camille & Sacha') : `${name ?? 'Camille & Sacha'} ${attempt}`,
        ...(slug === undefined ? {} : { slug: attempt === 1 ? slug : `${slug}-${attempt}` }),
        ...(wallLanguage === undefined ? {} : { wallLanguage }),
      })
      if (response.status === 409 && attempt < 25) return create(attempt + 1)
      return response
    }

    const created = await create(1)
    if (!succeeded(created)) throw new Error(`seed event failed with ${created.status}`)
    const event = created.body as { slug: string; name: string; joinCode: string }

    // A newly created event is a draft; guests cannot join until it is live, and a
    // journey that forgets this fails in a confusing place.
    const opened = await api.post(`/api/events/${event.slug}/status`, { status: 'live' })
    if (!succeeded(opened)) throw new Error(`opening the event failed with ${opened.status}`)

    return { slug: event.slug, name: event.name, joinCode: event.joinCode }
  }

  /** See {@link TestApp.createMission}. */
  const createMission = async (
    eventSlug: string,
    input: { prompt: string; scope: MissionScope },
  ): Promise<void> => {
    const api = await sessionOn(baseUrl)

    const login = await api.post('/api/auth/login', {
      email: OWNER.email,
      password: OWNER_SETTLED_PASSWORD,
    })
    if (!succeeded(login)) throw new Error(`mission setup login failed with ${login.status}`)

    const created = await api.post(`/api/events/${eventSlug}/missions`, input)
    if (!succeeded(created)) throw new Error(`creating mission failed with ${created.status}`)
  }

  return {
    baseUrl,
    url: (path) => `${baseUrl}${path}`,
    seedEvent,
    createMission,
    owner: { email: OWNER.email, password: OWNER_SETTLED_PASSWORD },
    databasePath,
    eventCreation,
    dispose,
  }
}
