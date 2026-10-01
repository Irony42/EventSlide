import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../infrastructure/config/env'
import { migrations } from '../infrastructure/db/migrations'
import { status } from '../infrastructure/db/migrator'
import { createContainer, type Container } from './container'

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
