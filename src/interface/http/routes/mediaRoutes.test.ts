import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { mediaRoutes } from './mediaRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { GUEST_COOKIE } from '../middleware/authz'
import type { ArchiveEntry, ArchiveWriter } from '../../../application/ports/archiveWriter'
import {
  MEDIA_VARIANTS,
  type ByteRange,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
} from '../../../application/ports/mediaStore'
import { makeExportAlbum, type ExportAlbum } from '../../../application/usecases/photos/exportAlbum'
import { makeGetPhotoMedia } from '../../../application/usecases/photos/getPhotoMedia'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import {
  AT,
  aClip,
  aGuest,
  anEvent,
  aPhoto,
  type PhotoInput,
} from '../../../application/testing/builders'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId, type EventId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'

/**
 * Ring 4: the wire contract of the two routes that serve bytes.
 *
 * The doubles live here rather than in the shared harness because five sibling route
 * modules are being written against that harness at the same time, and because the
 * question these tests answer — which caller receives which bytes — needs a media store
 * and an archive writer that genuinely behave. A stub told what to return would let a
 * cross-event read pass while the product leaked.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const HOST = 'host-id'
/** A real session that has no membership of the wedding. Must learn nothing. */
const OUTSIDER = 'outsider-id'
const GUEST = 'guest-1'
const OTHER_GUEST = 'guest-2'

/** Photo ids are UUIDs in the contract, so the fixtures are UUIDs. */
const PUBLISHED = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const MY_PENDING = '9a8b7c6d-5e4f-4321-9876-543210fedcba'
const THEIR_PENDING = '11111111-2222-4333-8444-555555555555'
const IN_THE_GALA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

/** A JPEG's start-of-image marker, so the fixture is at least plausibly an image. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff)

/** The ZIP local file header signature, asserted rather than trusted. */
const LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/** The policy the route promises for a content-addressed variant, 200 and 304 alike. */
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable'

class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  private key(eventId: EventId, hash: ContentHash, variant: MediaVariant): string {
    return `${eventId}|${hash.value}|${variant}`
  }

  async put(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    bytes: Uint8Array,
  ): Promise<void> {
    this.objects.set(this.key(eventId, hash, variant), bytes)
  }

  async exists(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<boolean> {
    return this.objects.has(this.key(eventId, hash, variant))
  }

  async stat(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<MediaMetadata | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    return bytes === undefined
      ? null
      : {
          byteSize: bytes.length,
          // Variant-aware, as the filesystem store is: serving a clip labelled
          // `image/jpeg` under `nosniff` is a projector that renders nothing.
          contentType: variant === 'video' ? 'video/mp4' : 'image/jpeg',
        }
  }

  async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    if (bytes === undefined) return null

    // A range the object cannot satisfy answers `null`, exactly as the filesystem store
    // does — a `206` over an empty stream is a player waiting forever.
    if (range !== undefined && (range.start >= bytes.length || range.end < range.start)) return null

    const served =
      range === undefined
        ? bytes
        : bytes.slice(range.start, Math.min(range.end, bytes.length - 1) + 1)
    return (async function* () {
      yield served
    })()
  }

  async read(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<Uint8Array | null> {
    return this.objects.get(this.key(eventId, hash, variant)) ?? null
  }

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    for (const variant of MEDIA_VARIANTS) this.objects.delete(this.key(eventId, hash, variant))
  }

  async deleteEvent(eventId: EventId): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${eventId}|`)) this.objects.delete(key)
    }
  }

  async usedBytes(eventId: EventId): Promise<number> {
    let total = 0
    for (const [key, bytes] of this.objects) {
      if (key.startsWith(`${eventId}|`)) total += bytes.length
    }
    return total
  }
}

/**
 * An archive writer that emits a real ZIP local file header and then the entries.
 *
 * Not the `archiver` adapter: `src/interface` may not import `src/infrastructure`, and
 * what this route is responsible for is that the chunks reach the socket in order and
 * that a failure does not become a truncated 200. `failsWith` reproduces the rejection
 * `archiverWriter.test.ts` already proves the real writer performs when an entry's bytes
 * disappear part-way through a multi-gigabyte download.
 */
class StubArchiveWriter implements ArchiveWriter {
  /** `undefined` means "never fail" — a rejection value of any shape is a failure. */
  constructor(private readonly failsWith?: unknown) {}

  stream(entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array> {
    const failsWith = this.failsWith
    return (async function* () {
      yield new Uint8Array(LOCAL_FILE_HEADER)
      for await (const entry of entries) {
        if (failsWith !== undefined) throw failsWith
        yield new TextEncoder().encode(entry.name)
        for await (const chunk of entry.bytes) yield chunk
      }
    })()
  }
}

interface World extends Harness {
  readonly photos: FakePhotoRepository
  readonly media: InMemoryMediaStore
}

interface WorldOptions {
  readonly archive?: ArchiveWriter
  /**
   * Replaces the real use case. Only for the refusal `exportAlbum` cannot be driven to
   * from outside: `requireRole` has already resolved the event by the time the handler
   * runs, so the real one has nothing left to refuse.
   */
  readonly exportAlbum?: ExportAlbum
}

const buildWorld = async ({
  archive = new StubArchiveWriter(),
  exportAlbum,
}: WorldOptions = {}): Promise<World> => {
  const photos = new FakePhotoRepository()
  const media = new InMemoryMediaStore()

  const harness = buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/host', signInAs({ userId: HOST, email: 'hote@example.test' }))
      app.post('/sign-in/outsider', signInAs({ userId: OUTSIDER, email: 'autre@example.test' }))
      app.use(
        mediaRoutes({
          deps,
          usecases: {
            getPhotoMedia: makeGetPhotoMedia({ photos, media }),
            exportAlbum:
              exportAlbum ??
              makeExportAlbum({
                events: deps.events,
                photos,
                media,
                archive,
                logger: deps.logger,
              }),
          },
        }),
      )
    },
  })

  const world: World = { ...harness, photos, media }

  world.events.seed(
    anEvent({ id: WEDDING, slug: 'mariage', ownerId: HOST, joinCode: 'H7K2QM' }),
    anEvent({ id: GALA, slug: 'gala', name: 'Gala', ownerId: OUTSIDER, joinCode: 'B4N9PT' }),
  )
  world.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(HOST), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(OUTSIDER), role: 'owner', grantedAt: AT },
  )
  world.guests.seed(
    aGuest({ id: GUEST, eventId: WEDDING }),
    aGuest({ id: OTHER_GUEST, eventId: WEDDING, displayName: 'Sacha' }),
  )

  await seedPhoto(world, { id: PUBLISHED, eventId: WEDDING, status: 'published' })
  await seedPhoto(world, {
    id: MY_PENDING,
    eventId: WEDDING,
    author: { kind: 'guest', id: GUEST },
  })
  await seedPhoto(world, {
    id: THEIR_PENDING,
    eventId: WEDDING,
    author: { kind: 'guest', id: OTHER_GUEST },
  })
  await seedPhoto(world, { id: IN_THE_GALA, eventId: GALA, status: 'published' })

  return world
}

/** A photo with all three files present, which is what ingest guarantees. */
const seedPhoto = async (world: World, input: PhotoInput): Promise<void> => {
  const photo = aPhoto(input)
  world.photos.seed(photo)
  for (const variant of MEDIA_VARIANTS) {
    await world.media.put(photo.eventId, photo.contentHash, variant, JPEG)
  }
}

const mediaPath = (photoId: string, variant: string, slug = 'mariage'): string =>
  `/events/${slug}/photos/${photoId}/${variant}`

/**
 * Superagent hands back a Buffer only when told the body is opaque bytes — and then it
 * no longer parses a JSON error body, so a refusal has to be read through {@link getJson}.
 */
const getBytes = (world: World, path: string) => request(world.app).get(path).responseType('blob')

const getJson = (world: World, path: string) => request(world.app).get(path)

const asGuestOf = (world: World, eventId: string, guestId: string) =>
  `${GUEST_COOKIE}=${world.issueGuestToken(eventId, guestId)}`

const signedIn = async (world: World, who: 'host' | 'outsider') => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

describe('GET /events/:eventSlug/photos/:photoId/:variant', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it.each(['thumb', 'display'])(
    'serves %s of a published photo to the public, so the projector needs no credential',
    async (variant) => {
      const response = await getBytes(world, mediaPath(PUBLISHED, variant))

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('image/jpeg')
      expect(response.headers['content-length']).toBe('3')
      expect([...response.body]).toEqual([...JPEG])
    },
  )

  it('answers 404 for the original, which the public may never read', async () => {
    // 404 rather than 403: a 403 would confirm the photo exists.
    const response = await getJson(world, mediaPath(PUBLISHED, 'original'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('answers 404 for a pending photo, which nobody has approved yet', async () => {
    const response = await getJson(world, mediaPath(MY_PENDING, 'display'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('serves a guest their own pending photo, so they see it waiting for moderation', async () => {
    const response = await getBytes(world, mediaPath(MY_PENDING, 'display')).set(
      'Cookie',
      asGuestOf(world, WEDDING, GUEST),
    )

    expect(response.status).toBe(200)
    expect([...response.body]).toEqual([...JPEG])
  })

  it('answers 404 for another guest’s pending photo', async () => {
    const response = await getJson(world, mediaPath(THEIR_PENDING, 'display')).set(
      'Cookie',
      asGuestOf(world, WEDDING, GUEST),
    )

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it.each([...MEDIA_VARIANTS])('serves %s of a pending photo to a moderator', async (variant) => {
    const agent = await signedIn(world, 'host')

    const response = await agent.get(mediaPath(MY_PENDING, variant)).responseType('blob')

    expect(response.status).toBe(200)
    expect([...response.body]).toEqual([...JPEG])
    // docs/API.md: `original` is never cached publicly. `private` is what makes that true
    // of the one variant only a moderator may read.
    expect(response.headers['cache-control']).toBe(IMMUTABLE_CACHE)
  })

  it('answers 404 for a photo belonging to another event, never 403', async () => {
    // The one case that catches a real incident: a moderator of the wedding asking for
    // a photo of the gala. A 403 would tell them the id is real.
    const agent = await signedIn(world, 'host')

    const response = await agent.get(mediaPath(IN_THE_GALA, 'display'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('tells a session with no membership of the event exactly what the public is told', async () => {
    const agent = await signedIn(world, 'outsider')

    const response = await agent.get(mediaPath(PUBLISHED, 'original'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('sets an immutable one-year cache policy and a strong ETag', async () => {
    const response = await getBytes(world, mediaPath(PUBLISHED, 'display'))

    expect(response.headers['cache-control']).toBe(IMMUTABLE_CACHE)
    expect(response.headers['etag']).toMatch(/^"[0-9a-f]{64}-display"$/)
  })

  it('renders inline and forbids content sniffing', async () => {
    const response = await getBytes(world, mediaPath(PUBLISHED, 'display'))

    expect(response.headers['content-disposition']).toBe('inline')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('answers 304 with no body when If-None-Match matches', async () => {
    // A projector re-requesting the same slide across an eight-hour run must not
    // re-download several megabytes each time.
    const first = await getBytes(world, mediaPath(PUBLISHED, 'display'))
    const etag = first.headers['etag'] ?? ''
    expect(etag).toMatch(/^"[0-9a-f]{64}-display"$/)

    const second = await getBytes(world, mediaPath(PUBLISHED, 'display')).set('If-None-Match', etag)

    expect(second.status).toBe(304)
    // The validator and the caching policy survive the freshness check, or the projector
    // revalidates every slide for the rest of the night.
    expect(second.headers['etag']).toBe(etag)
    expect(second.headers['cache-control']).toBe(IMMUTABLE_CACHE)
    // No bytes, no declared length, and nothing describing a body that is not there: a
    // 304 carrying a Content-Length is a response some proxies wait on.
    expect(second.body).toHaveLength(0)
    expect(second.headers['content-length']).toBeUndefined()
    expect(second.headers['content-type']).toBeUndefined()
  })

  it.each([
    ['a photo id that is not a UUID', mediaPath('not-a-uuid', 'display')],
    ['a variant outside the contract', mediaPath(PUBLISHED, 'webp')],
  ])('answers 400 for %s', async (_label, path) => {
    const response = await getJson(world, path)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 404 for a slug the domain would refuse, not 400', async () => {
    // A malformed slug is answered exactly like a slug that does not exist, so a
    // badly-formed path is not a cheaper probe for which events are on the box.
    const response = await getJson(world, mediaPath(PUBLISHED, 'display', 'Mariage'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it.each([
    ['an empty cookie', () => ''],
    ['a forged token', () => 'not-a-signed-token'],
    ['a token minted for another event', (subject: World) => subject.issueGuestToken(GALA, GUEST)],
    [
      'a token naming a guest row that is gone',
      (subject: World) => subject.issueGuestToken(WEDDING, 'purged-guest'),
    ],
  ])('leaves a caller carrying %s public', async (_label, token) => {
    const response = await getJson(world, mediaPath(MY_PENDING, 'display')).set(
      'Cookie',
      `${GUEST_COOKIE}=${token(world)}`,
    )

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('treats a revoked guest as public, so even their own pending photo is 404', async () => {
    // What makes a signed, stateless token revocable: the row is read on every request.
    world.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, revokedAt: AT }))

    const response = await getJson(world, mediaPath(MY_PENDING, 'display')).set(
      'Cookie',
      asGuestOf(world, WEDDING, GUEST),
    )

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })
})

describe('GET /events/:eventSlug/album.zip', () => {
  it('streams a ZIP to a moderator of the event', async () => {
    const world = await buildWorld()
    const agent = await signedIn(world, 'host')

    const response = await agent.get('/events/mariage/album.zip').responseType('blob')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/zip')
    // Named from the resolved event, so the file the host saves is called what the wall
    // and the printed card call this event.
    expect(response.headers['content-disposition']).toBe('attachment; filename="mariage-album.zip"')
    // An album is a snapshot of a queue that keeps moving and is not content-addressed,
    // so unlike a photo there is no name that could make it safe to keep.
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(response.body).subarray(0, 4)).toEqual(LOCAL_FILE_HEADER)
  })

  it('refuses without committing the response to a download', async () => {
    // Once `Content-Disposition: attachment` is on the wire the client is saving a file,
    // so a refusal has to be decided before any archive header is set — otherwise the
    // host ends up with a JSON error page named `mariage-album.zip`.
    const world = await buildWorld({
      exportAlbum: () => Promise.resolve(err(DomainError.notFound('event.notFound'))),
    })
    const agent = await signedIn(world, 'host')

    const response = await agent.get('/events/mariage/album.zip')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(response.headers['content-type']).toMatch(/^application\/json/)
    expect(response.headers['content-disposition']).toBeUndefined()
  })

  it('answers 401 without a session', async () => {
    const world = await buildWorld()

    const response = await request(world.app).get('/events/mariage/album.zip')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 for a guest, who has no session to moderate with', async () => {
    const world = await buildWorld()

    const response = await request(world.app)
      .get('/events/mariage/album.zip')
      .set('Cookie', asGuestOf(world, WEDDING, GUEST))

    // 401 before the event is looked up, so a guest cannot use this to probe slugs.
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for a moderator of another event, never 403', async () => {
    const world = await buildWorld()
    const agent = await signedIn(world, 'outsider')

    const response = await agent.get('/events/mariage/album.zip')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it.each([
    ['an Error', new Error('an entry vanished mid-archive')],
    ['a rejection that is not an Error', 'the media root went read-only'],
  ])('abandons the connection when the archive fails mid-stream with %s', async (_label, cause) => {
    // Headers are long gone by then, so a truncated ZIP under a 200 would look like a
    // complete album — and a host who deletes their photos afterwards has lost them.
    const world = await buildWorld({ archive: new StubArchiveWriter(cause) })
    const agent = await signedIn(world, 'host')

    await expect(agent.get('/events/mariage/album.zip').responseType('blob')).rejects.toThrow()
  })
})

// ------------------------------------------------------------------- clips --

/**
 * A published clip in the wedding, with its two renditions on the disk.
 *
 * `MP4` is longer than a marker because these tests are about **byte ranges**, and a
 * three-byte object cannot express a range that starts in the middle.
 */
const CLIP = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'
const MP4 = Uint8Array.from({ length: 64 }, (_unused, index) => index)
const POSTER = Uint8Array.of(0xff, 0xd8, 0xff, 0x01)

const seedClip = async (world: World): Promise<void> => {
  const clip = aClip({ id: CLIP, eventId: WEDDING, status: 'published', clip: {} })
  world.photos.seed(clip)
  await world.media.put(clip.eventId, clip.contentHash, 'video', MP4)
  const facet = clip.facet
  if (facet.kind !== 'clip') throw new Error('fixture is not a clip')
  await world.media.put(clip.eventId, facet.posterHash, 'poster', POSTER)
}

describe('GET /events/:eventSlug/photos/:photoId/:variant — a clip', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
    await seedClip(world)
  })

  it('serves the mp4 to the room, declared as video', () => {
    // `fsMediaStore` used to hardcode `image/jpeg` for every variant. Under `nosniff`, a
    // browser believes that label and renders nothing at all.
    return getBytes(world, mediaPath(CLIP, 'video')).then((response) => {
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('video/mp4')
      expect([...response.body]).toEqual([...MP4])
    })
  })

  it('advertises that it accepts ranges, which is how a player knows it can seek', async () => {
    const response = await getBytes(world, mediaPath(CLIP, 'video'))

    expect(response.headers['accept-ranges']).toBe('bytes')
  })

  it('answers a range with 206 and exactly those bytes', async () => {
    // Safari will not begin playback at all against a handler that answers 200 to a
    // range request. This is not an optimisation; it is whether a clip plays.
    const response = await getBytes(world, mediaPath(CLIP, 'video')).set('Range', 'bytes=8-15')

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe('bytes 8-15/64')
    expect(response.headers['content-length']).toBe('8')
    expect([...response.body]).toEqual([8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('answers an open-ended range, which is what a player opens with', async () => {
    const response = await getBytes(world, mediaPath(CLIP, 'video')).set('Range', 'bytes=60-')

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe('bytes 60-63/64')
    expect([...response.body]).toEqual([60, 61, 62, 63])
  })

  it('answers a suffix range, which is how Safari finds the index', async () => {
    const response = await getBytes(world, mediaPath(CLIP, 'video')).set('Range', 'bytes=-4')

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe('bytes 60-63/64')
  })

  it('answers 416 with the real size for a range the file cannot satisfy', async () => {
    // The size is what lets a player correct itself instead of retrying the same
    // impossible range for the rest of the evening.
    const response = await getJson(world, mediaPath(CLIP, 'video')).set('Range', 'bytes=999-')

    expect(response.status).toBe(416)
    expect(response.headers['content-range']).toBe('bytes */64')
    expect(response.body.error.code).toBe('photo.rangeNotSatisfiable')
  })

  it('serves the whole object for a multi-range request rather than refusing it', async () => {
    const response = await getBytes(world, mediaPath(CLIP, 'video')).set('Range', 'bytes=0-3,8-11')

    expect(response.status).toBe(200)
    expect(response.body.length).toBe(64)
  })

  it('serves the poster as an image, from its own digest', async () => {
    // A clip has two hashes and the poster is addressed by its own: the media store's
    // one invariant is that the name of a file is the hash of that file.
    const response = await getBytes(world, mediaPath(CLIP, 'poster'))

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
    expect([...response.body]).toEqual([...POSTER])
  })

  it('answers 404 for a rendition a clip does not have', async () => {
    // The miss is on the **row**, not on the disk: `photo.mediaMissing` is the code that
    // means "a row points at bytes that are gone", which is a corruption worth an
    // operator's attention, and a client asking a clip for a `display` is not that.
    const response = await getJson(world, mediaPath(CLIP, 'display'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('answers 404 for a rendition a photograph does not have', async () => {
    const response = await getJson(world, mediaPath(PUBLISHED, 'video'))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('refuses to serve a guest’s un-stripped upload under any spelling', async () => {
    // `source` is outside the served variants, so the route's own schema refuses it —
    // and the use case takes a `ServedVariant`, so even a schema that admitted it would
    // not compile. Those bytes still carry whatever the phone wrote, including location.
    const response = await getJson(world, mediaPath(CLIP, 'source'))

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('gives the two renditions different validators', async () => {
    // The ETag keys on the digest *and* the variant, so nothing compares a poster's
    // validator against an mp4's across two URLs of the same row.
    const video = await getBytes(world, mediaPath(CLIP, 'video'))
    const poster = await getBytes(world, mediaPath(CLIP, 'poster'))

    expect(video.headers['etag']).not.toBe(poster.headers['etag'])
  })

  it('still answers 304 to a projector that already has the clip', async () => {
    const first = await getBytes(world, mediaPath(CLIP, 'video'))

    const second = await getJson(world, mediaPath(CLIP, 'video')).set(
      'If-None-Match',
      first.headers['etag'] ?? '',
    )

    expect(second.status).toBe(304)
    expect(second.headers['accept-ranges']).toBe('bytes')
  })
})
