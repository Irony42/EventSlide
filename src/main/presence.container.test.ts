import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../infrastructure/config/env'
import { asUserId } from '../domain/shared/ids'
import { GUEST_COOKIE } from '../interface/http/middleware/authz'
import { createContainer, type Container } from './container'

/**
 * **"N guests here" counts the guests who are still using their phone** — through the real
 * composition root, the real middleware, the real use cases and a real SQLite file.
 *
 * `requireGuest` kept a copy of `authenticateGuest` for a while, dropped the stamp, and nothing
 * called the use case: the console counted guests who had *joined* in the last five minutes.
 * Every unit of that was correct on its own — the use case stamped, the middleware let the guest
 * through — and the product was wrong, because the one line that joins them is in the container.
 * So the guest here joined an hour ago, and the only thing that can bring them back into the
 * count is a request with their cookie.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

const boot = async (): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-presence-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  return container
}

describe('the host count of guests who are here', () => {
  it('counts a guest who joined an hour ago once they use the app again', async () => {
    const booted = await boot()
    const owner = booted.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
      .get(OWNER)
    const actorId = asUserId(owner?.id ?? '')
    const created = await booted.usecases.createEvent({
      ownerId: actorId,
      name: 'Mariage de Camille',
      slug: SLUG,
    })
    if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
    booted.db
      .prepare(`UPDATE events SET status = 'live', opened_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), created.value.id)
    const joined = await booted.usecases.joinEvent({
      joinCode: created.value.joinCode.value,
      displayName: 'Léa',
    })
    if (!joined.ok) throw new Error(`fixture rejected: ${joined.error.code}`)
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString()
    booted.db
      .prepare('UPDATE guests SET last_seen_at = ? WHERE id = ?')
      .run(anHourAgo, joined.value.guestId)
    const here = async (): Promise<number> => {
      const listed = await booted.usecases.listGuests({ eventId: created.value.id, actorId })
      if (!listed.ok) throw new Error(`fixture rejected: ${listed.error.code}`)
      return listed.value.activeCount
    }
    expect(await here(), 'before the guest does anything').toBe(0)

    const response = await request(booted.app)
      .get(`/api/events/${SLUG}/photos/mine`)
      .set('Cookie', `${GUEST_COOKIE}=${joined.value.token}`)

    expect(response.status).toBe(200)
    expect(await here(), 'after a request with their cookie').toBe(1)
  })
})
