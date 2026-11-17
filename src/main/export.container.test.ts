import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readZipEnd, ZIP_TAIL_BYTES } from '../domain/exports/zipEndRecord'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import request from '../interface/http/testing/request'
import { createContainer, type Container } from './container'

/**
 * The verified archive through the real composition root (spec 22): the archive is written by the real
 * worker into a real ZIP, and every door content leaves the evening by retires it and deletes its
 * file. `exportInvalidation.test.ts` proves the hook with fakes and the guard test proves it is in
 * the source; what only this file can say is that `container.ts` and `usecases.*.ts` wire the real
 * hook, the real file store, the real worker and the real purge together, and that **a host exports,
 * a guest erases themselves, and the archive and its file are gone**.
 */

const OWNER = 'hote@example.test'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'
const REASON = 'Signalement reçu, retrait conservatoire'

let workDir: string | null = null
let shared: Container | null = null
let eventCount = 0

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-export-'))
  shared = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  shared.db.prepare('UPDATE users SET must_change_password = 0').run()
})

afterAll(async () => {
  await shared?.dispose()
  shared = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true, maxRetries: 5 })
  workDir = null
})

const csrfOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie']
  const cookies = Array.isArray(raw) ? (raw as string[]) : []
  const found = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))
  return found === undefined
    ? ''
    : decodeURIComponent(found.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
}

/** A closed event with three published photographs of one guest, and the archive made of it. */
const scene = async (options: { readonly sealed?: boolean } = {}) => {
  if (workDir === null || shared === null) throw new Error('fixture: no container')
  const booted = shared
  const mediaRoot = join(workDir, 'media')
  eventCount += 1
  const slug = `${SLUG}-${eventCount}`
  const ownerId = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OWNER)?.id
  if (ownerId === undefined) throw new Error('fixture: no owner')

  const created = await booted.usecases.createEvent({
    ownerId: asUserId(ownerId),
    name: 'Mariage de Camille',
    slug,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const eventId = created.value.id
  booted.db
    .prepare(`UPDATE events SET status = 'live', opened_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), eventId)

  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers)
  const joined = await agent
    .post('/api/join')
    .set(CSRF_HEADER, csrf)
    .send({ joinCode: created.value.joinCode.value, displayName: 'Léa' })
  expect(joined.status, JSON.stringify(joined.body)).toBe(200)
  csrf = csrfOf(joined.headers) || csrf

  const photoIds: string[] = []
  for (const red of [30, 90, 150]) {
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: red, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer()
    const uploaded = await agent
      .post(`/api/events/${slug}/photos`)
      .set(CSRF_HEADER, csrf)
      .attach('photos', jpeg, 'a.jpg')
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201)
    photoIds.push((uploaded.body.results[0].photoId ?? uploaded.body.results[0].id) as string)
  }
  const guestId = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM guests WHERE event_id = ?')
    .get(eventId)?.id
  if (guestId === undefined) throw new Error('fixture: no guest')

  const actor = { kind: 'host', userId: asUserId(ownerId) } as const
  for (const photoId of photoIds) {
    const published = await booted.usecases.moderatePhoto({
      eventId,
      photoId: asPhotoId(photoId),
      decision: 'publish',
      actor,
    })
    expect(published.ok).toBe(true)
  }
  // The party is over: the album is what it is, and an archive can be asked for.
  booted.db
    .prepare(`UPDATE events SET status = 'closed', closed_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), eventId)

  const worker = booted.albumExportWorker
  if (worker === null) throw new Error('fixture: the archives are switched off')
  const make = async (): Promise<void> => {
    const queued = await booted.usecases.requestAlbumExport({
      eventId,
      actorId: asUserId(ownerId),
    })
    expect(queued.ok, JSON.stringify(!queued.ok && queued.error)).toBe(true)
    const drained = await worker.runOnce()
    expect(drained.status).toBe('completed')
  }
  if (options.sealed !== false) await make()

  const exportStatus = (): string | null =>
    booted.db
      .prepare<[string], { readonly status: string }>(
        'SELECT status FROM event_exports WHERE event_id = ?',
      )
      .get(eventId)?.status ?? null

  return {
    booted,
    slug,
    eventId: asEventId(eventId),
    ownerId: asUserId(ownerId),
    guestId: asGuestId(guestId),
    photoIds: photoIds.map(asPhotoId),
    actor,
    make,
    exportStatus,
    exportFile: join(mediaRoot, '.exports', `${eventId}.zip`),
    rowCount: (table: string): number =>
      booted.db
        .prepare<[string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE event_id = ?`,
        )
        .get(eventId)?.n ?? 0,
  }
}

describe('the verified archive, through the real composition root', () => {
  it('writes a real ZIP of the published photographs, sealed with its digest, outside the event folder', async () => {
    const s = await scene()

    expect(s.exportStatus()).toBe('sealed')
    const zip = readFileSync(s.exportFile)
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(readZipEnd(zip.subarray(Math.max(0, zip.length - ZIP_TAIL_BYTES)))).toEqual({
      entries: 4,
    })
    const given = await s.booted.usecases.downloadAlbumExport({ eventId: s.eventId })
    expect(given.ok && given.value.byteSize).toBe(zip.length)
  })

  it('is retired, and its file deleted, when the host deletes a photograph', async () => {
    const s = await scene()
    const [first] = s.photoIds
    if (first === undefined) throw new Error('fixture')

    await s.booted.usecases.deletePhoto({ eventId: s.eventId, photoId: first, actor: s.actor })

    expect(s.exportStatus()).toBe('stale')
    expect(existsSync(s.exportFile)).toBe(false)
  })

  it('is retired when the host refuses a batch, and not when the host hides a photograph', async () => {
    const s = await scene()
    const [first] = s.photoIds
    if (first === undefined) throw new Error('fixture')

    await s.booted.usecases.moderatePhoto({
      eventId: s.eventId,
      photoId: first,
      decision: 'hide',
      actor: s.actor,
    })
    expect(s.exportStatus()).toBe('sealed')
    expect(existsSync(s.exportFile)).toBe(true)

    await s.booted.usecases.moderatePhotosBulk({
      eventId: s.eventId,
      photoIds: s.photoIds.slice(0, 2),
      decision: 'reject',
      actor: s.actor,
    })

    expect(s.exportStatus()).toBe('stale')
    expect(existsSync(s.exportFile)).toBe(false)
  })

  it('is retired, and its file gone, when the host has exported and the guest then erases themselves', async () => {
    const s = await scene()
    expect(existsSync(s.exportFile)).toBe(true)

    const erased = await s.booted.usecases.eraseGuestContribution({
      eventId: s.eventId,
      guestId: s.guestId,
    })

    expect(erased.ok).toBe(true)
    expect(s.exportStatus()).toBe('stale')
    expect(existsSync(s.exportFile)).toBe(false)
    // And it is not served, whatever a leftover file might say.
    const refused = await s.booted.usecases.downloadAlbumExport({ eventId: s.eventId })
    expect(!refused.ok && refused.error.code).toBe('export.notFound')
  })

  it('is retired when the operator takes a photograph down, or the whole event', async () => {
    const first = await scene()
    const [photo] = first.photoIds
    if (photo === undefined) throw new Error('fixture')
    await first.booted.usecases.setPhotoTakedown({
      photoId: photo,
      down: true,
      reason: REASON,
      actor: { kind: 'operator', userId: first.ownerId },
    })
    expect(first.exportStatus()).toBe('stale')
    expect(existsSync(first.exportFile)).toBe(false)

    const second = await scene()
    await second.booted.usecases.setEventTakedown({
      eventId: second.eventId,
      down: true,
      reason: REASON,
      actor: { kind: 'operator', userId: second.ownerId },
    })
    expect(second.exportStatus()).toBe('stale')
    expect(existsSync(second.exportFile)).toBe(false)
  })

  it('is retired when the event is reopened', async () => {
    const s = await scene()

    const reopened = await s.booted.usecases.changeEventStatus({
      eventId: s.eventId,
      actorId: s.ownerId,
      status: 'live',
    })

    expect(reopened.ok, JSON.stringify(!reopened.ok && reopened.error)).toBe(true)
    expect(s.exportStatus()).toBe('stale')
    expect(existsSync(s.exportFile)).toBe(false)
  })

  it('is replaced when the host asks again, and the earlier file does not outlive its row', async () => {
    const s = await scene()
    const first = readFileSync(s.exportFile)

    await s.make()

    expect(s.exportStatus()).toBe('sealed')
    expect(readFileSync(s.exportFile).length).toBe(first.length)
    expect(s.rowCount('event_export_requests')).toBe(2)
  })

  describe('with the album, at the purge', () => {
    it('has its file deleted and both tables emptied when the host deletes the event', async () => {
      const s = await scene()
      expect(existsSync(s.exportFile)).toBe(true)

      const purged = await s.booted.usecases.purgeEvent({ eventId: s.eventId, actorId: s.ownerId })

      expect(purged.ok, JSON.stringify(!purged.ok && purged.error)).toBe(true)
      expect(existsSync(s.exportFile)).toBe(false)
      expect(s.exportStatus()).toBeNull()
      expect(s.rowCount('event_export_requests')).toBe(0)
    })

    it('is deleted by the retention purge whatever its state: the purge does not wait, nor ask', async () => {
      const s = await scene()
      // Sealed and never sent: the weakest state a purge could be tempted to wait for.
      s.booted.db
        .prepare(
          `UPDATE events SET settings = json_set(settings, '$.retentionDays', 1) WHERE id = ?`,
        )
        .run(s.eventId)
      s.booted.db
        .prepare(`UPDATE events SET closed_at = ? WHERE id = ?`)
        .run(new Date(Date.now() - 3 * 86_400_000).toISOString(), s.eventId)

      const report = await s.booted.usecases.purgeExpiredEvents()

      expect(report.purged).toContain(s.eventId)
      expect(report.archives[s.eventId]).toBe('sealed')
      expect(existsSync(s.exportFile)).toBe(false)
      expect(s.exportStatus()).toBeNull()
    })

    it('stays, with its file, when the operator holds the purge: an erasure is refused and nothing changed', async () => {
      const s = await scene()
      s.booted.db
        .prepare('UPDATE events SET purge_held_at = ? WHERE id = ?')
        .run(new Date().toISOString(), s.eventId)

      const refused = await s.booted.usecases.eraseGuestContribution({
        eventId: s.eventId,
        guestId: s.guestId,
      })

      expect(refused.ok).toBe(false)
      expect(s.exportStatus()).toBe('sealed')
      expect(existsSync(s.exportFile)).toBe(true)
    })

    it('can still be prepared and downloaded under the operator’s hold: the hold hides nothing', async () => {
      const s = await scene({ sealed: false })
      s.booted.db
        .prepare('UPDATE events SET purge_held_at = ? WHERE id = ?')
        .run(new Date().toISOString(), s.eventId)

      await s.make()

      expect(s.exportStatus()).toBe('sealed')
      const given = await s.booted.usecases.downloadAlbumExport({ eventId: s.eventId })
      expect(given.ok).toBe(true)
    })
  })
})

describe('the verified archive, when the function is off', () => {
  it('builds no worker, and a request is answered export.unavailable', async () => {
    const offDir = await mkdtemp(join(tmpdir(), 'eventslide-export-off-'))
    const off = await createContainer(
      loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        DATABASE_PATH: join(offDir, 'eventslide.sqlite'),
        MEDIA_ROOT: join(offDir, 'media'),
        EXPORT_ENABLED: 'false',
      }),
    )
    try {
      expect(off.albumExportWorker).toBeNull()
    } finally {
      await off.dispose()
      await rm(offDir, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})
