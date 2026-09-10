import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { mediaRoutes } from './mediaRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { GUEST_COOKIE } from '../middleware/authz'
import type { ArchiveEntry, ArchiveWriter } from '../../../application/ports/archiveWriter'
import {
  MEDIA_VARIANTS,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
} from '../../../application/ports/mediaStore'
import { makeExportAlbum } from '../../../application/usecases/photos/exportAlbum'
import { makeGetPhotoMedia } from '../../../application/usecases/photos/getPhotoMedia'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { AT, aGuest, anEvent, aPhoto, type PhotoInput } from '../../../application/testing/builders'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId, asUserId, type EventId } from '../../../domain/shared/ids'

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
    return bytes === undefined ? null : { byteSize: bytes.length, contentType: 'image/jpeg' }
  }

  async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    if (bytes === undefined) return null
    return (async function* () {
      yield bytes
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
 * that a failure does not become a truncated 200. `failMidStream` reproduces the
 * rejection `archiverWriter.test.ts` already proves the real writer performs when an
 * entry's bytes disappear part-way through a multi-gigabyte download.
 */
class StubArchiveWriter implements ArchiveWriter {
  constructor(private readonly failMidStream = false) {}

  stream(entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array> {
    const failMidStream = this.failMidStream
    return (async function* () {
      yield new Uint8Array(LOCAL_FILE_HEADER)
      for await (const entry of entries) {
        if (failMidStream) throw new Error('an entry vanished mid-archive')
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

const buildWorld = async ({ archive = new StubArchiveWriter() } = {}): Promise<World> => {
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
            exportAlbum: makeExportAlbum({
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

    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable')
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
    const etag = first.headers['etag']

    const second = await getBytes(world, mediaPath(PUBLISHED, 'display')).set('If-None-Match', etag)

    expect(second.status).toBe(304)
    expect(second.headers['content-length']).toBeUndefined()
    expect(second.headers['etag']).toBe(etag)
    expect(second.body.length ?? 0).toBe(0)
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
    expect(response.headers['content-disposition']).toBe('attachment; filename="mariage-album.zip"')
    expect(Buffer.from(response.body).subarray(0, 4)).toEqual(LOCAL_FILE_HEADER)
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

  it('abandons the connection when the archive fails mid-stream', async () => {
    // Headers are long gone by then, so a truncated ZIP under a 200 would look like a
    // complete album — and a host who deletes their photos afterwards has lost them.
    const world = await buildWorld({ archive: new StubArchiveWriter(true) })
    const agent = await signedIn(world, 'host')

    await expect(agent.get('/events/mariage/album.zip').responseType('blob')).rejects.toThrow()
  })
})
