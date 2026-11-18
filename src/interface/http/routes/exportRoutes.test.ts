import http from 'node:http'
import type { AddressInfo } from 'node:net'
import request from '../testing/request'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportRoutes } from './exportRoutes'
import { mediaRoutes } from './mediaRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { HeldExport } from '../testing/heldExport'
import { notWiredUseCases } from '../testing/serverHarness'
import { GUEST_COOKIE } from '../middleware/authz'
import { hostExportLimiter } from '../middleware/rateLimit'
import type { HttpUseCases } from '../useCases'
import { AT, aClient, aGuest, aPhoto, anEvent, atPlus } from '../../../application/testing/builders'
import { FakeAlbumExportRepository } from '../../../application/testing/fakeAlbumExportRepository'
import { FakeExportFileStore } from '../../../application/testing/fakeExportFileStore'
import { FakeGuestbookRepository } from '../../../application/testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../../application/testing/fakeGuestbookVoiceRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { makeDownloadAlbumExport } from '../../../application/usecases/exports/downloadAlbumExport'
import { makeGetAlbumExport } from '../../../application/usecases/exports/getAlbumExport'
import { makeRequestAlbumExport } from '../../../application/usecases/exports/requestAlbumExport'
import { Event } from '../../../domain/events/event'
import { requestExport, type ExportSeal } from '../../../domain/exports/albumExport'
import { asEventId, asUserId } from '../../../domain/shared/ids'

/**
 * The verified archive's HTTP surface (spec 22, ring 4): who may call what, what each answer looks
 * like, the headers a download carries, how many may be open at once, and that `served_at` is
 * stamped only by a `200` whose every byte reached the socket. The rules themselves are the use
 * cases' own tests; this asserts the contract around them.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const OWNER = 'owner-id'
const MODERATOR = 'moderator-id'
const OTHER = 'other-id'
const GALA_OWNER = 'gala-owner-id'
const GUEST = 'guest-1'
const DAY = 86_400_000

/** A "ZIP" of 300 000 bytes: big enough to be several chunks, so a client can leave half way. */
const ZIP = new Uint8Array(300_000).map((_, index) => index % 251)
const SHA = 'ab'.repeat(32)

const SEAL: ExportSeal = {
  entries: 12,
  skipped: 0,
  bytes: ZIP.length,
  sha256: SHA,
  expiresAt: new Date(AT.getTime() + 7 * DAY),
}

interface Held {
  release: () => void
  opened: number
  /** Streams the route has finished with (read to the end or destroyed under it). */
  closed: number
  holding: boolean
}

interface World extends Harness {
  readonly exports: FakeAlbumExportRepository
  readonly files: FakeExportFileStore
  readonly state: { enabled: boolean; freeDisk: number | null }
  readonly album: HeldExport
  /** Holds each archive download open until the test releases it. */
  readonly held: Held
}

const world = (): World => {
  const exports = new FakeAlbumExportRepository()
  const files = new FakeExportFileStore()
  const photos = new FakePhotoRepository()
  const voices = new FakeGuestbookVoiceRepository(new FakeGuestbookRepository())
  const state = { enabled: true, freeDisk: 1_000_000_000 as number | null }
  const album = new HeldExport()
  const held: Held = { release: () => undefined, opened: 0, closed: 0, holding: false }
  const limiter = hostExportLimiter()

  const harness = buildHarness({
    routes: (app, deps, base) => {
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/other', signInAs({ userId: OTHER, email: 'autre@example.test' }))
      app.post('/sign-in/gala', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))

      // The store, as a download sees it: the bytes in several chunks, and, when a test asks, a
      // hold after the first one, so the download is open when the next request arrives.
      const openRead = files.openRead.bind(files)
      files.openRead = async (eventId, range) => {
        const bytes = await openRead(eventId, range)
        if (bytes === null) return null
        return (async function* () {
          held.opened += 1
          let paused = false
          try {
            for await (const part of bytes) {
              for (let at = 0; at < part.length; at += 65_536) {
                yield part.subarray(at, at + 65_536)
                // Held **before the last byte**: a client that has every byte of a response with a
                // declared length takes the connection for free and sends its next request down it,
                // which the server queues behind the response it has not finished.
                if (held.holding && !paused) {
                  paused = true
                  await new Promise<void>((resolve) => (held.release = resolve))
                }
              }
            }
          } finally {
            held.closed += 1
          }
        })()
      }

      const usecases: HttpUseCases = {
        ...notWiredUseCases(),
        exportAlbum: album.use,
        requestAlbumExport: makeRequestAlbumExport({
          events: deps.events,
          clients: base.clients,
          photos,
          voices,
          exports,
          exportFiles: files,
          bus: deps.bus,
          clock: deps.clock,
          logger: deps.logger,
          freeDiskBytes: async () => state.freeDisk,
          policy: {
            // Read at each request, so a test can switch the function off after the world is built.
            get enabled() {
              return state.enabled
            },
            maxBytes: 10_000_000,
            maxTotalBytes: 100_000_000,
            maxPerEventPerDay: 3,
            minFreeDiskBytes: 1_000,
          },
        }),
        getAlbumExport: makeGetAlbumExport({
          events: deps.events,
          clients: base.clients,
          exports,
          clock: deps.clock,
        }),
        downloadAlbumExport: makeDownloadAlbumExport({
          events: deps.events,
          clients: base.clients,
          exports,
          exportFiles: files,
          bus: deps.bus,
          clock: deps.clock,
          policy: { ttlDays: 7, capNoticeDays: 30 },
        }),
      }
      app.use('/api', exportRoutes({ deps, usecases, hostExportLimiter: limiter }))
      // The album ZIP, mounted around the same limiter as `server.ts` does.
      app.use(
        mediaRoutes({
          deps,
          hostExportLimiter: limiter,
          usecases: {
            getPhotoMedia: notWiredUseCases().getPhotoMedia,
            identifyMediaViewer: notWiredUseCases().identifyMediaViewer,
            getVenuePhotoMedia: notWiredUseCases().getVenuePhotoMedia,
            getEventLogoMedia: notWiredUseCases().getEventLogoMedia,
            exportAlbum: album.use,
          },
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      name: 'Camille & Sacha',
      ownerId: OWNER,
      status: 'closed',
    }),
    anEvent({
      id: GALA,
      slug: 'gala',
      name: 'Gala',
      ownerId: GALA_OWNER,
      joinCode: 'B4N9PT',
      status: 'closed',
    }),
  )
  harness.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(OTHER), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  harness.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }))
  photos.seed(aPhoto({ id: 'p-wedding', eventId: WEDDING, status: 'published', byteSize: 1_000 }))

  return Object.assign(harness, { exports, files, state, album, held })
}

type Who = 'owner' | 'moderator' | 'other' | 'gala'

const signedIn = async (subject: World, who: Who) => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

/** A sealed archive for an event, with its file. */
const seedSealed = async (
  subject: World,
  eventId = WEDDING,
  overrides: Partial<ExportSeal> = {},
): Promise<void> => {
  const id = asEventId(eventId)
  await subject.exports.request(requestExport(id, asUserId(OWNER), AT))
  await subject.exports.claimNext(AT)
  await subject.exports.finish(id, { kind: 'sealed', seal: { ...SEAL, ...overrides } }, AT)
  subject.files.seed(id, ZIP)
}

let subject: World

beforeEach(() => {
  subject = world()
})

const EXPORT = '/api/events/mariage/export'
const ZIP_URL = '/api/events/mariage/export.zip'

describe('who may call the archive routes', () => {
  const ROUTES = [
    ['post', EXPORT],
    ['get', EXPORT],
    ['get', ZIP_URL],
  ] as const

  it.each(ROUTES)('%s %s answers 401 without a session', async (method, url) => {
    const response = await request(subject.app)[method](url).send({})

    expect(response.status).toBe(401)
  })

  it.each(ROUTES)('%s %s answers 404 to a moderator of another event', async (method, url) => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent[method](url).send({})

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it.each(ROUTES)('%s %s refuses a guest device token', async (method, url) => {
    const cookie = `${GUEST_COOKIE}=${subject.issueGuestToken(WEDDING, GUEST)}`

    const response = await request(subject.app)[method](url).set('Cookie', cookie).send({})

    expect(response.status).toBe(401)
  })

  it('lets a moderator, not only the owner, prepare, read and download', async () => {
    await seedSealed(subject)
    const agent = await signedIn(subject, 'moderator')

    expect((await agent.post(EXPORT).send({})).status).toBe(202)
    // The request replaced the sealed archive: nothing to read or download until it is made.
    expect((await agent.get(EXPORT)).status).toBe(200)
    await seedSealed(subject, WEDDING)
    expect((await agent.get(ZIP_URL).responseType('blob')).status).toBe(200)
  })
})

describe('POST /api/events/:eventSlug/export', () => {
  it('answers 202 with the queued archive, never stored by a cache', async () => {
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(202)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      status: 'queued',
      requestedAt: AT.toISOString(),
      sealedAt: null,
      expiresAt: null,
      entries: null,
      skipped: null,
      bytes: null,
      sha256: null,
      servedAt: null,
      staleReason: null,
      failure: null,
      canDeleteWithoutConfirmation: false,
    })
  })

  it('wakes the worker with a signal that carries no data', async () => {
    const agent = await signedIn(subject, 'owner')

    await agent.post(EXPORT).send({}).expect(202)

    expect(subject.bus.published).toEqual([{ type: 'export.changed', eventId: asEventId(WEDDING) }])
  })

  it.each([
    ['an unknown field', { title: 'x' }],
    ['a layout, as a book would take', { layout: 'one' }],
    ['a body that is not an object', [1]],
  ])('answers 400 request.invalid for %s', async (_name, body) => {
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post(EXPORT).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(await subject.exports.find(asEventId(WEDDING))).toBeNull()
  })

  it('answers 409 export.alreadyRunning for a second request while one is queued', async () => {
    const agent = await signedIn(subject, 'owner')
    await agent.post(EXPORT).send({}).expect(202)

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('export.alreadyRunning')
  })

  it('answers 409 export.notClosed for an event that is still running', async () => {
    subject.events.seed(anEvent({ id: WEDDING, slug: 'mariage', ownerId: OWNER, status: 'live' }))
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('export.notClosed')
  })

  it('answers 409 export.noRoom when the disk cannot take it, before writing anything', async () => {
    subject.state.freeDisk = 10
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('export.noRoom')
    expect(await subject.exports.find(asEventId(WEDDING))).toBeNull()
  })

  it('answers 409 export.noRoom for a disk that cannot be read', async () => {
    subject.state.freeDisk = null
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('export.noRoom')
  })

  it('answers 429 with Retry-After on the fourth archive of the day', async () => {
    const agent = await signedIn(subject, 'owner')
    for (let index = 0; index < 3; index += 1) {
      await agent.post(EXPORT).send({}).expect(202)
      await subject.exports.claimNext(AT)
      await subject.exports.finish(asEventId(WEDDING), { kind: 'failed', code: 'noRoom' }, AT)
    }

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('export.dailyLimitReached')
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
    expect(await subject.exports.countRequestsSince(asEventId(WEDDING), new Date(0))).toBe(3)
  })

  it('answers 503 export.unavailable when the box switched the function off', async () => {
    subject.state.enabled = false
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post(EXPORT).send({})

    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('export.unavailable')
  })

  describe('a suspended client (spec 22, rule 8)', () => {
    /** An event of a client, which the fake refuses to re-seed with another client: a new event. */
    const seedClientEvent = (client: Parameters<typeof aClient>[0]): void => {
      subject.clients.seed(aClient({ id: 'client-1', ...client }))
      subject.events.seed(
        Event.restore({
          ...anEvent({
            id: 'client-event-id',
            slug: 'chez-le-client',
            joinCode: 'D6P2WX',
            ownerId: OWNER,
            status: 'closed',
            clientId: 'client-1',
          }).toProps(),
          clientSuspendedAt: AT,
        }),
      )
      subject.memberships.seed({
        eventId: asEventId('client-event-id'),
        userId: asUserId(OWNER),
        role: 'owner',
        grantedAt: AT,
      })
    }
    const CLIENT_EXPORT = '/api/events/chez-le-client/export'

    it('answers 403 client.suspended when it is not being offboarded, and writes nothing', async () => {
      seedClientEvent({ suspendedAt: AT, purgeAfter: null })
      const agent = await signedIn(subject, 'owner')

      const response = await agent.post(CLIENT_EXPORT).send({})

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('client.suspended')
      expect(await subject.exports.find(asEventId('client-event-id'))).toBeNull()
    })

    it('accepts it when it is being offboarded: the grace period is for exporting', async () => {
      seedClientEvent({ suspendedAt: AT, purgeAfter: atPlus(30 * DAY) })
      const agent = await signedIn(subject, 'owner')

      expect((await agent.post(CLIENT_EXPORT).send({})).status).toBe(202)
    })

    it('answers 404 for an event the operator took down, offboarding or not', async () => {
      seedClientEvent({ suspendedAt: AT, purgeAfter: atPlus(30 * DAY) })
      await subject.events.setTakenDown(asEventId('client-event-id'), AT)
      const agent = await signedIn(subject, 'owner')

      expect((await agent.post(CLIENT_EXPORT).send({})).status).toBe(404)
    })
  })

  it('takes the requests an account may send in an hour from a ceiling of its own', async () => {
    const agent = await signedIn(subject, 'owner')

    // Twenty an hour, whatever the answer: the 21st is the limiter's, not a use case's.
    for (let index = 0; index < 20; index += 1) await agent.post(EXPORT).send({})
    const refused = await agent.post(EXPORT).send({})

    expect(refused.status).toBe(429)
    expect(refused.body.error.code).toBe('rate.limited')
  })
})

describe('GET /api/events/:eventSlug/export', () => {
  it('answers 404 export.notFound when no archive was ever asked for, never cached', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(EXPORT)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('export.notFound')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('answers the state of a sealed archive, with its digest and the domain’s verdict on deleting', async () => {
    await seedSealed(subject)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(EXPORT)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      status: 'sealed',
      requestedAt: AT.toISOString(),
      sealedAt: AT.toISOString(),
      expiresAt: SEAL.expiresAt.toISOString(),
      entries: 12,
      skipped: 0,
      bytes: ZIP.length,
      sha256: SHA,
      servedAt: null,
      staleReason: null,
      failure: null,
      canDeleteWithoutConfirmation: false,
    })
  })

  it('says a complete archive sent in full may be deleted without the word', async () => {
    await seedSealed(subject)
    await subject.exports.markServed(asEventId(WEDDING), atPlus(1_000), SEAL.expiresAt)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(EXPORT)

    expect(response.body).toMatchObject({
      servedAt: atPlus(1_000).toISOString(),
      canDeleteWithoutConfirmation: true,
    })
  })

  it('says an incomplete archive may not, even when it was sent', async () => {
    await seedSealed(subject, WEDDING, { skipped: 2 })
    await subject.exports.markServed(asEventId(WEDDING), atPlus(1_000), SEAL.expiresAt)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(EXPORT)

    expect(response.body).toMatchObject({ skipped: 2, canDeleteWithoutConfirmation: false })
  })

  it('says why a stale archive was withdrawn, with a closed code', async () => {
    await seedSealed(subject)
    await subject.exports.invalidate(asEventId(WEDDING), 'guestErased', AT)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(EXPORT)

    expect(response.body).toMatchObject({ status: 'stale', staleReason: 'guestErased' })
  })

  it('answers 404 once the archive has expired, though the sweep has not removed it yet', async () => {
    await seedSealed(subject, WEDDING, { expiresAt: atPlus(1_000) })
    subject.clock.set(atPlus(2_000))
    const agent = await signedIn(subject, 'moderator')

    expect((await agent.get(EXPORT)).status).toBe(404)
  })

  it('never reaches another event’s moderator: the gala’s page does not see the wedding’s archive', async () => {
    await seedSealed(subject)
    const agent = await signedIn(subject, 'gala')

    const response = await agent.get('/api/events/gala/export')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('export.notFound')
  })
})

describe('GET /api/events/:eventSlug/export.zip', () => {
  beforeEach(() => seedSealed(subject))

  it('sends the whole file with its size, its digest as a strong ETag, and a name from the slug', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(ZIP_URL).responseType('blob')

    expect(response.status).toBe(200)
    expect(response.headers['content-length']).toBe(String(ZIP.length))
    expect(response.headers['etag']).toBe(`"${SHA}"`)
    expect(response.headers['content-type']).toBe('application/zip')
    expect(response.headers['content-disposition']).toBe('attachment; filename="mariage-album.zip"')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(response.body as Buffer).equals(Buffer.from(ZIP))).toBe(true)
  })

  it('answers 206 with the range, its own length and the whole size, so a download resumes', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(ZIP_URL).set('Range', 'bytes=1000-1999').responseType('blob')

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe(`bytes 1000-1999/${ZIP.length}`)
    expect(response.headers['content-length']).toBe('1000')
    expect(Buffer.from(response.body as Buffer).equals(Buffer.from(ZIP.slice(1000, 2000)))).toBe(
      true,
    )
  })

  it('answers 304 to a matching If-None-Match, with the validator and no body', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(ZIP_URL).set('If-None-Match', `"${SHA}"`)

    expect(response.status).toBe(304)
    expect(response.headers['etag']).toBe(`"${SHA}"`)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-length']).toBeUndefined()
  })

  it('answers 416 with the size for a range outside the file, as JSON and not as a download', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(ZIP_URL).set('Range', `bytes=${ZIP.length + 5}-`)

    expect(response.status).toBe(416)
    expect(response.headers['content-range']).toBe(`bytes */${ZIP.length}`)
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(response.body.error.code).toBe('photo.rangeNotSatisfiable')
  })

  it.each(['queued', 'stale'])('answers 404 export.notFound for a %s archive', async (state) => {
    if (state === 'stale') await subject.exports.invalidate(asEventId(WEDDING), 'photoRemoved', AT)
    else await subject.exports.request(requestExport(asEventId(WEDDING), asUserId(OWNER), AT))
    subject.files.seed(asEventId(WEDDING), ZIP)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(ZIP_URL)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('export.notFound')
    expect(response.headers['content-disposition']).toBeUndefined()
  })

  it('answers a HEAD without opening the file or taking a slot', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.head(ZIP_URL)

    // The browser link asking whether this GET would start (`answerHead`): no use case ran.
    expect(response.status).toBe(204)
    expect(subject.held.opened).toBe(0)
  })

  describe('through the same concurrency bound as the album ZIP (spec 22, rule: exportLimiter)', () => {
    const start = (agent: Awaited<ReturnType<typeof signedIn>>, path: string) =>
      agent
        .get(path)
        .responseType('blob')
        .then(
          (response) => response.status,
          () => 0,
        )

    beforeEach(() => {
      subject.held.holding = true
    })

    it('refuses a third archive download for an account that already has two open', async () => {
      const agent = await signedIn(subject, 'moderator')
      void start(agent, ZIP_URL)
      void start(agent, ZIP_URL)
      await vi.waitFor(() => expect(subject.held.opened).toBe(2))

      const third = await agent.get(ZIP_URL)

      expect(third.status).toBe(429)
      expect(third.body.error.code).toBe('rate.limited')
      expect(third.headers['retry-after']).toBe('30')
      subject.held.release()
    })

    it('counts an album ZIP and an archive download together against the same account', async () => {
      const agent = await signedIn(subject, 'moderator')
      void start(agent, '/events/mariage/album.zip')
      void start(agent, ZIP_URL)
      await vi.waitFor(() => expect(subject.album.opened + subject.held.opened).toBe(2))

      expect((await agent.get(ZIP_URL)).status).toBe(429)
      expect((await agent.get('/events/mariage/album.zip')).status).toBe(429)
      subject.album.releaseAll()
      subject.held.release()
    })

    it('gives the slot back when the use case refuses', async () => {
      const agent = await signedIn(subject, 'moderator')
      await subject.exports.invalidate(asEventId(WEDDING), 'photoRemoved', AT)

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await agent.get(ZIP_URL)).status).toBe(404)
      }
    })
  })
})

describe('served_at: stamped only by a 200 whose every byte reached the socket (spec 22, rule 5)', () => {
  const servedAt = async (): Promise<Date | null> =>
    (await subject.exports.find(asEventId(WEDDING)))?.servedAt ?? null

  beforeEach(() => seedSealed(subject))

  it('is stamped by a complete 200, and the signal tells the page to read again', async () => {
    const agent = await signedIn(subject, 'moderator')
    subject.bus.published.length = 0

    await agent.get(ZIP_URL).responseType('blob').expect(200)

    await vi.waitFor(async () => expect(await servedAt()).toEqual(subject.deps.clock.now()))
    expect(subject.bus.published).toContainEqual({
      type: 'export.changed',
      eventId: asEventId(WEDDING),
    })
  })

  it('also pulls the end of the archive in to 48 hours after the send', async () => {
    const agent = await signedIn(subject, 'moderator')

    await agent.get(ZIP_URL).responseType('blob').expect(200)

    await vi.waitFor(async () =>
      expect((await subject.exports.find(asEventId(WEDDING)))?.expiresAt).toEqual(
        new Date(subject.deps.clock.now().getTime() + 48 * 3_600_000),
      ),
    )
  })

  it('is not stamped by a 206: a download resumed in pieces does not mark the send', async () => {
    const agent = await signedIn(subject, 'moderator')

    await agent.get(ZIP_URL).set('Range', 'bytes=0-999').responseType('blob').expect(206)
    // Both ends of the file in one go, which is not the whole 200 either.
    await agent
      .get(ZIP_URL)
      .set('Range', `bytes=0-${ZIP.length - 1}`)
      .responseType('blob')
      .expect(206)

    expect(await servedAt()).toBeNull()
  })

  it('is not stamped by a 304, a 416, a HEAD or a refusal', async () => {
    const agent = await signedIn(subject, 'moderator')

    await agent.get(ZIP_URL).set('If-None-Match', `"${SHA}"`).expect(304)
    await agent
      .get(ZIP_URL)
      .set('Range', `bytes=${ZIP.length + 5}-`)
      .expect(416)
    await agent.head(ZIP_URL).expect(204)
    const stranger = await signedIn(subject, 'gala')
    await stranger.get(ZIP_URL).expect(404)

    expect(await servedAt()).toBeNull()
  })

  it('is not stamped by a download the client abandons half way, over a real socket', async () => {
    const server = http.createServer(subject.app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const signIn = await request(subject.app).post('/sign-in/moderator').expect(204)
    const cookie = [signIn.headers['set-cookie'] ?? []]
      .flat()
      .map((value) => String(value).split(';')[0])
      .join('; ')
    // Held after the first chunk, so the response is open when the client leaves.
    subject.held.holding = true

    const serverSawClose = new Promise<void>((resolve) => {
      server.on('request', (_req, res) => {
        res.once('close', () => resolve())
      })
    })
    await new Promise<void>((resolve) => {
      const outgoing = http.get(
        { port, path: ZIP_URL, headers: { Cookie: cookie } },
        (incoming) => {
          incoming.once('data', () => {
            outgoing.destroy()
            incoming.destroy()
            resolve()
          })
        },
      )
      outgoing.on('error', () => undefined)
    })
    await serverSawClose
    subject.held.release()
    // The stream is closed once the route is done with it; the passes that follow let the handler's
    // own continuation (the only place served_at could be stamped) run to its end.
    await vi.waitFor(() => expect(subject.held.closed).toBe(1))
    for (let pass = 0; pass < 5; pass += 1) await new Promise((resolve) => setImmediate(resolve))

    expect(await servedAt()).toBeNull()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
