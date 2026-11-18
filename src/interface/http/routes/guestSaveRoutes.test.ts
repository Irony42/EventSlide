import request from '../testing/request'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, aGuest, aPhoto, anEvent } from '../../../application/testing/builders'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { makeSaveGuestPhoto } from '../../../application/usecases/photos/saveGuestPhoto'
import type { ContentHash } from '../../../domain/photos/contentHash'
import {
  MEDIA_VARIANTS,
  type MediaVariant,
  type PhotoVariant,
} from '../../../domain/photos/mediaVariant'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import type { ByteRange } from '../../../application/ports/mediaStore'
import type { Photo } from '../../../domain/photos/photo'
import { asEventId, asPhotoId } from '../../../domain/shared/ids'
import type { EventId } from '../../../domain/shared/ids'
import type { SaveGuestPhoto } from '../../../application/usecases/photos/saveGuestPhoto'
import { GUEST_COOKIE } from '../middleware/authz'
import { SAVES_PER_GUEST_PER_MINUTE, saveAddressLimiter } from '../middleware/rateLimit'
import { buildHarness, type Harness } from '../testing/middlewareHarness'
import { buildServerHarness } from '../testing/serverHarness'
import { guestRoutes } from './guestRoutes'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import type { GuestRouteDeps } from './guestRoutes'

/**
 * `GET /api/events/:slug/photos/:photoId/save` (spec 24): a guest keeping a photograph.
 *
 * The use case is the real one over the in-memory fakes, so what is decided here is decided as in
 * production: a published still, the host's switch, the event it belongs to. The three renditions
 * get three different sizes, so a test can tell which one it was handed.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_GUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const REVOKED_GUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const OTHERS_PUBLISHED = '66666666-6666-4666-8666-666666666666'
const OWN_PUBLISHED = '22222222-2222-4222-8222-222222222222'
const PENDING = '11111111-1111-4111-8111-111111111111'
const HIDDEN = '33333333-3333-4333-8333-333333333333'
const REJECTED = '44444444-4444-4444-8444-444444444444'
const UNKNOWN = '77777777-7777-4777-8777-777777777777'
const GALA_PHOTO = '55555555-5555-4555-8555-555555555555'

const SLUG = 'mariage'
const BASE = `/api/events/${SLUG}`
const SIZES: Readonly<Record<PhotoVariant, number>> = { original: 90, display: 50, thumb: 20 }

const cookie = (token: string): string => `${GUEST_COOKIE}=${token}`

/** The byte pattern of a rendition, so a slice of the body can be recognised as one. */
const bytesOf = (variant: PhotoVariant): Uint8Array =>
  new Uint8Array(SIZES[variant]).fill(variant === 'display' ? 7 : 1)

/**
 * A store whose reads wait on a gate: a download that has been asked for and has not finished, which
 * is the only way a test holds a concurrency slot.
 */
class GatedMediaStore extends InMemoryMediaStore {
  private gate: Promise<void> = Promise.resolve()
  private release: () => void = () => undefined
  private reached = 0
  private waiters: { readonly count: number; readonly resolve: () => void }[] = []

  /** Resolves once `openRead` has been reached `count` times: no timer, no polling. */
  whenOpened(count: number): Promise<void> {
    if (this.reached >= count) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.waiters.push({ count, resolve })
    })
  }

  hold(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve
    })
  }

  open(): void {
    this.release()
  }

  override async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const inner = await super.openRead(eventId, hash, variant, range)
    if (inner === null) return null
    const gate = this.gate
    this.reached += 1
    for (const waiter of this.waiters) if (this.reached >= waiter.count) waiter.resolve()
    return (async function* () {
      await gate
      yield* inner
    })()
  }
}

interface Subject {
  readonly harness: Harness
  readonly photos: FakePhotoRepository
  readonly media: GatedMediaStore
  /** Every stored photograph: `withFiles` writes their three renditions. */
  readonly stored: readonly Photo[]
  readonly token: string
  readonly otherToken: string
  readonly revokedToken: string
  readonly galaToken: string
}

const buildSubject = (
  options: {
    readonly settings?: EventSettingsPatch
    readonly limiters?: Pick<
      GuestRouteDeps,
      'saveAddressRateLimiter' | 'saveGuestRateLimiter' | 'saveConcurrencyLimiter'
    >
  } = {},
): Subject => {
  const photos = new FakePhotoRepository()
  const media = new GatedMediaStore()

  const harness = buildHarness({
    routes: (app, deps) => {
      app.use(
        '/api',
        guestRoutes({
          deps,
          ...options.limiters,
          usecases: {
            saveGuestPhoto: makeSaveGuestPhoto({ events: deps.events, photos, media }),
          } as unknown as GuestRouteDeps['usecases'],
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({ id: WEDDING, slug: SLUG, joinCode: 'H7K2QM', settings: options.settings ?? {} }),
    anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT' }),
  )
  harness.guests.seed(
    aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }),
    aGuest({ id: OTHER_GUEST, eventId: WEDDING, displayName: 'Sacha' }),
    aGuest({ id: REVOKED_GUEST, eventId: WEDDING, displayName: 'Max', revokedAt: AT }),
    aGuest({ id: GUEST, eventId: GALA, displayName: 'Léa' }),
  )

  const seed = (id: string, status: PhotoStatus, authorId: string, eventId = WEDDING): Photo => {
    const photo = aPhoto({ id, eventId, status, author: { kind: 'guest', id: authorId } })
    photos.seed(photo)
    return photo
  }
  const stored = [
    seed(OTHERS_PUBLISHED, 'published', OTHER_GUEST),
    seed(OWN_PUBLISHED, 'published', GUEST),
    seed(PENDING, 'pending', OTHER_GUEST),
    seed(HIDDEN, 'hidden', OTHER_GUEST),
    seed(REJECTED, 'rejected', OTHER_GUEST),
    seed(GALA_PHOTO, 'published', GUEST, GALA),
  ]

  return {
    harness,
    photos,
    media,
    stored,
    token: harness.issueGuestToken(WEDDING, GUEST),
    otherToken: harness.issueGuestToken(WEDDING, OTHER_GUEST),
    revokedToken: harness.issueGuestToken(WEDDING, REVOKED_GUEST),
    galaToken: harness.issueGuestToken(GALA, GUEST),
  }
}

/** The files of every stored photograph, three renditions each. */
const withFiles = async (subject: Subject): Promise<Subject> => {
  for (const photo of subject.stored) {
    for (const variant of MEDIA_VARIANTS) {
      await subject.media.put(photo.eventId, photo.contentHash, variant, bytesOf(variant))
    }
  }
  return subject
}

const save = (subject: Subject, photoId: string, token = subject.token) =>
  request(subject.harness.app)
    .get(`${BASE}/photos/${photoId}/save`)
    .set('Cookie', cookie(token))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => done(null, Buffer.concat(chunks)))
    })

describe('GET /api/events/:eventSlug/photos/:photoId/save', () => {
  let subject: Subject

  beforeEach(async () => {
    subject = await withFiles(buildSubject())
  })

  it('answers 200 with the display file as an attachment named by the server', async () => {
    const response = await save(subject, OTHERS_PUBLISHED)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
    expect(response.headers['content-disposition']).toMatch(
      new RegExp(`^attachment; filename="${SLUG}-[0-9a-f]+\\.jpg"$`),
    )
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['etag']).toMatch(/^"[0-9a-f]+-display"$/)
    expect(response.headers['content-length']).toBe(String(SIZES.display))
  })

  it('serves the size of the display rendition, never that of the original', async () => {
    const response = await save(subject, OTHERS_PUBLISHED)

    const body = response.body as Buffer
    expect(body.length).toBe(SIZES.display)
    expect(body.length).not.toBe(SIZES.original)
    expect([...new Set(body)]).toEqual([7])
  })

  it('answers 206 to a Range, the way a phone download manager resumes', async () => {
    const response = await request(subject.harness.app)
      .get(`${BASE}/photos/${OTHERS_PUBLISHED}/save`)
      .set('Cookie', cookie(subject.token))
      .set('Range', 'bytes=10-19')

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe(`bytes 10-19/${SIZES.display}`)
    expect(response.headers['content-disposition']).toContain('attachment')
  })

  it('answers 416 to a Range beyond the file, as JSON and without the attachment headers', async () => {
    const response = await request(subject.harness.app)
      .get(`${BASE}/photos/${OTHERS_PUBLISHED}/save`)
      .set('Cookie', cookie(subject.token))
      .set('Range', 'bytes=5000-6000')

    expect(response.status).toBe(416)
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('accepts a guest’s own published photograph, which the button simply does not offer', async () => {
    const response = await save(subject, OWN_PUBLISHED)

    expect(response.status).toBe(200)
  })

  it('answers 401 without the guest cookie: the address is no bearer', async () => {
    const response = await request(subject.harness.app).get(
      `${BASE}/photos/${OTHERS_PUBLISHED}/save`,
    )

    expect(response.status).toBe(401)
  })

  it('answers 404 event.notFound to a guest token of another event', async () => {
    const response = await save(subject, OTHERS_PUBLISHED, subject.galaToken)

    expect(response.status).toBe(404)
    expect(response.body.toString()).toContain('event.notFound')
  })

  it('answers 403 guest.revoked to a revoked guest, the host’s lever against an abuser', async () => {
    const response = await save(subject, OTHERS_PUBLISHED, subject.revokedToken)

    expect(response.status).toBe(403)
    expect(response.body.toString()).toContain('guest.revoked')
  })

  it('answers 403 save.disabled once the host switched the setting off', async () => {
    const off = await withFiles(buildSubject({ settings: { allowGuestSave: false } }))

    const response = await save(off, OTHERS_PUBLISHED)

    expect(response.status).toBe(403)
    expect(response.body.toString()).toContain('save.disabled')
  })

  it.each([
    ['pending', PENDING],
    ['hidden', HIDDEN],
    ['rejected', REJECTED],
    ['unknown', UNKNOWN],
    ['of another event', GALA_PHOTO],
  ])('answers the same 404 photo.notFound for a photograph that is %s', async (_name, id) => {
    const response = await save(subject, id)
    const unknown = await save(subject, UNKNOWN)

    expect(response.status).toBe(404)
    expect(response.body.toString()).toBe(unknown.body.toString())
    expect(response.body.toString()).toContain('photo.notFound')
  })

  it('answers 404 once the operator took the photograph down', async () => {
    await subject.photos.setTakenDown(asEventId(WEDDING), asPhotoId(OTHERS_PUBLISHED), AT)

    const response = await save(subject, OTHERS_PUBLISHED)

    expect(response.status).toBe(404)
  })

  it('answers 400 to an identifier that is not one', async () => {
    const response = await save(subject, 'not-an-id')

    expect(response.status).toBe(400)
  })

  it('answers 400 to an identifier that is not one before looking at the event', async () => {
    subject.harness.events.seed(
      anEvent({ id: WEDDING, slug: SLUG, joinCode: 'H7K2QM', status: 'archived' }),
    )

    const response = await save(subject, 'not-an-id')

    expect(response.status).toBe(400)
  })

  it('keeps nothing on the server: no row, no file, no signal', async () => {
    const rows = subject.photos.ofEvent(asEventId(WEDDING))
    const files = await subject.media.list(asEventId(WEDDING))

    await save(subject, OTHERS_PUBLISHED)
    await save(subject, OTHERS_PUBLISHED)

    expect(subject.photos.ofEvent(asEventId(WEDDING))).toEqual(rows)
    expect(await subject.media.list(asEventId(WEDDING))).toEqual(files)
    expect(subject.harness.bus.published).toEqual([])
  })

  it('answers the 429 of the guest budget on the request after the allowed ones', async () => {
    for (let sent = 0; sent < SAVES_PER_GUEST_PER_MINUTE; sent += 1) {
      const response = await request(subject.harness.app)
        .get(`${BASE}/photos/${PENDING}/save`)
        .set('Cookie', cookie(subject.token))
      expect(response.status).toBe(404)
    }

    const refused = await save(subject, OTHERS_PUBLISHED)

    expect(refused.status).toBe(429)
    expect(refused.headers['retry-after']).toBeDefined()
  })

  it('does not let a second guest behind the same address pay for the first one’s budget', async () => {
    for (let sent = 0; sent < SAVES_PER_GUEST_PER_MINUTE; sent += 1) {
      await request(subject.harness.app)
        .get(`${BASE}/photos/${PENDING}/save`)
        .set('Cookie', cookie(subject.token))
    }

    const other = await save(subject, OTHERS_PUBLISHED, subject.otherToken)

    expect(other.status).toBe(200)
  })
})

describe('the address ceiling of the save route', () => {
  it('refuses the third save from one address, whichever guests send them', async () => {
    const limited = await withFiles(
      buildSubject({ limiters: { saveAddressRateLimiter: saveAddressLimiter(2) } }),
    )

    expect((await save(limited, OTHERS_PUBLISHED)).status).toBe(200)
    expect((await save(limited, OTHERS_PUBLISHED, limited.otherToken)).status).toBe(200)
    const third = await save(limited, OTHERS_PUBLISHED, limited.revokedToken)

    expect(third.status).toBe(429)
  })

  it('counts before the token is checked: a request with no cookie spends the address budget', async () => {
    const limited = await withFiles(
      buildSubject({ limiters: { saveAddressRateLimiter: saveAddressLimiter(1) } }),
    )

    expect((await request(limited.harness.app).get(`${BASE}/photos/${UNKNOWN}/save`)).status).toBe(
      401,
    )
    const next = await request(limited.harness.app).get(`${BASE}/photos/${UNKNOWN}/save`)

    expect(next.status).toBe(429)
  })
})

describe('the concurrency of the save route', () => {
  it('refuses the third simultaneous save of one guest and serves a second guest', async () => {
    const held = await withFiles(buildSubject())
    held.media.hold()
    const start = () =>
      request(held.harness.app)
        .get(`${BASE}/photos/${OTHERS_PUBLISHED}/save`)
        .set('Cookie', cookie(held.token))
        .then((response) => response)

    const first = start()
    const second = start()
    await held.media.whenOpened(2)

    const third = await request(held.harness.app)
      .get(`${BASE}/photos/${OTHERS_PUBLISHED}/save`)
      .set('Cookie', cookie(held.token))
    const another = request(held.harness.app)
      .get(`${BASE}/photos/${OTHERS_PUBLISHED}/save`)
      .set('Cookie', cookie(held.otherToken))
      .then((response) => response)
    await held.media.whenOpened(3)

    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBe('30')

    held.media.open()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    expect((await another).status).toBe(200)
  })
})

describe('through the assembled server', () => {
  it('GET …/photos/:id/save does not fall into :variant', async () => {
    const photos = new FakePhotoRepository()
    const media = new InMemoryMediaStore()
    const built: { current?: SaveGuestPhoto } = {}
    const assembled = buildServerHarness({
      usecases: {
        saveGuestPhoto: async (input) => {
          if (built.current === undefined) throw new Error('the use case was not built yet')
          return built.current(input)
        },
      },
    })
    built.current = makeSaveGuestPhoto({ events: assembled.events, photos, media })
    const harness = assembled
    harness.events.seed(anEvent({ id: WEDDING, slug: SLUG, joinCode: 'H7K2QM' }))
    harness.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }))
    const photo = aPhoto({
      id: OTHERS_PUBLISHED,
      eventId: WEDDING,
      status: 'published',
      author: { kind: 'guest', id: OTHER_GUEST },
    })
    photos.seed(photo)
    await media.put(photo.eventId, photo.contentHash, 'display', bytesOf('display'))

    const response = await request(assembled.app)
      .get(`${BASE}/photos/${OTHERS_PUBLISHED}/save`)
      .set('Cookie', cookie(harness.issueGuestToken(WEDDING, GUEST)))

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('attachment')
  })
})
