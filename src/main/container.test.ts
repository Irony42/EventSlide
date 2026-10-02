import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../infrastructure/config/env'
import { migrations } from '../infrastructure/db/migrations'
import { status } from '../infrastructure/db/migrator'
import { createContainer, type Container } from './container'
import { appVersion } from './version'

/**
 * The one line of `SITE_ADMIN` that no other test reaches: the composition root handing
 * the parsed switch to the HTTP layer.
 *
 * `env.test.ts` proves the variable parses and `siteAdminMode.test.ts` proves what
 * `buildServer` does with `HttpConfig.siteAdmin`, but the harness there builds its own
 * `HttpConfig`. So `siteAdmin: false` written into `container.ts` by mistake — or the
 * wrong field of `AppConfig` — left every one of those green on a box where `SITE_ADMIN=on`
 * mounted nothing. Omitting the field is a type error; a wrong value was not, until this.
 *
 * The same boot is where the other half of the switch's promise lives: it decides how much
 * surface exists, never what the database looks like, so both modes apply every migration
 * and a box that turns it on later finds the schema it needs already there.
 *
 * A real container over a throwaway SQLite file and media root, because that is the
 * object under test. Its timers are built and never started here — `index.ts` starts
 * them — so nothing runs behind the requests and the ledger reads.
 */

/** Under the namespace, and reserved by its spelling: no route will ever claim it. */
const NEVER_A_SITE_ROUTE = '/api/site/__never-a-route__'

let workDir: string | null = null
let container: Container | null = null

const boot = async (source: Record<string, string>): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-container-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      // A configured path that does not exist is a refusal rather than a search, so the
      // boot answers "no encoder" without spawning anything. Video is not the subject.
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      ...source,
    }),
  )
  return container
}

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

describe('createContainer: SITE_ADMIN reaches the HTTP layer', () => {
  it('mounts no operator namespace on a box that never set it', async () => {
    const { app } = await boot({})

    const response = await request(app).get(NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('route.notFound')
  })

  it('mounts the operator namespace behind requireOperator when SITE_ADMIN=on', async () => {
    const { app } = await boot({ SITE_ADMIN: 'on' })

    const response = await request(app).get(NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})

describe('createContainer: readiness reaches the real health check (P4-06)', () => {
  /**
   * `server.test.ts`'s own shutdown tests build a `MutableHealthChecks` through
   * `buildServerHarness()`, a path that never calls `createContainer` — so a mistake in
   * *this* file's wiring (the wrong field read, `isShuttingDown: () => false`, a typo in
   * the key `buildServer` is handed) would leave every one of those green. This is the
   * one place that boots a real container and drives `container.readiness` and
   * `/api/ready` through the same object `main/index.ts` actually gets back.
   */
  it('answers /api/ready 200 until container.readiness.markShuttingDown() flips it to 503', async () => {
    const { app, readiness } = await boot({})

    const before = await request(app).get('/api/ready')
    expect(before.status).toBe(200)
    expect(before.body.status).toBe('ready')

    readiness.markShuttingDown()

    const after = await request(app).get('/api/ready')
    expect(after.status).toBe(503)
    expect(after.body.error.code).toBe('service.notReady')
  })
})

describe('createContainer: SITE_ADMIN decides surface, never schema', () => {
  it.each(['off', 'on'] as const)(
    'applies every migration with SITE_ADMIN=%s, so turning it on later needs no other schema',
    async (mode) => {
      const { db } = await boot({ SITE_ADMIN: mode })

      expect(status(db, migrations).applied.map((row) => row.id)).toEqual(
        migrations.map((migration) => migration.id),
      )
    },
  )
})

/**
 * The same gap, for the source offer (roadmap G1-04 / P1-05).
 *
 * `env.test.ts` proves `SOURCE_CODE_URL` and `SOURCE_REF` parse and `aboutRoutes.test.ts`
 * proves the route prints what it is handed, but the harness there hands it a made-up
 * `{ version, sourceUrl }`. What only this boot can show is the composition root doing its
 * two jobs: reading the **one** version (`version.ts`, the same answer `/api/health` gives)
 * and resolving the link from the parsed configuration rather than from a constant.
 */
describe('createContainer: the source offer reaches /api/about', () => {
  const UPSTREAM = 'https://github.com/Irony42/EventSlide'

  it('names the running version and its upstream tag on a box that configures nothing', async () => {
    const { app } = await boot({})

    const response = await request(app).get('/api/about')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      version: appVersion(),
      sourceUrl: `${UPSTREAM}/tree/v${appVersion()}`,
    })
  })

  it('reports the same version as /api/health, so the two endpoints cannot name different builds', async () => {
    const { app } = await boot({})

    const [about, health] = await Promise.all([
      request(app).get('/api/about'),
      request(app).get('/api/health'),
    ])

    expect(about.body.version).toBe(health.body.version)
  })

  it("offers the operator's own SOURCE_CODE_URL when one is set", async () => {
    const { app } = await boot({ SOURCE_CODE_URL: 'https://git.example.org/me/eventslide' })

    const response = await request(app).get('/api/about')

    expect(response.body.sourceUrl).toBe('https://git.example.org/me/eventslide')
  })

  it('offers the ref the image was built from when the build argument was given', async () => {
    const { app } = await boot({ SOURCE_REF: 'v9.9.9' })

    const response = await request(app).get('/api/about')

    expect(response.body.sourceUrl).toBe(`${UPSTREAM}/tree/v9.9.9`)
  })

  it.each([
    ['off', false],
    ['on', true],
  ] as const)('states SITE_ADMIN=%s as the flag the SPA reads', async (mode, flag) => {
    const { app } = await boot({ SITE_ADMIN: mode })

    const response = await request(app).get('/api/about')

    expect(response.body.features).toEqual({ siteAdmin: flag })
  })
})
