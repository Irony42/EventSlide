import request, { type Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_THEME } from '../../../domain/events/eventTheme'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { makeGetEventLimits } from '../../../application/usecases/events/getEventLimits'
import { makeGetEventView } from '../../../application/usecases/events/getEventView'
import { makeIdentifyMediaViewer } from '../../../application/usecases/photos/identifyMediaViewer'
import { makeGetVenuePhotoMedia } from '../../../application/usecases/venue/getVenuePhotoMedia'
import { makeRemoveVenuePhoto } from '../../../application/usecases/venue/removeVenuePhoto'
import { makeSetVenuePhoto } from '../../../application/usecases/venue/setVenuePhoto'
import { AT, aGuest, aUser, anEvent } from '../../../application/testing/builders'
import { FakeContentHasher } from '../../../application/testing/fakeContentHasher'
import { FakeImageProcessor, tagBytes } from '../../../application/testing/fakeImageProcessor'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { notWiredUseCases } from '../testing/serverHarness'
import type { HttpUseCases } from '../useCases'
import { eventRoutes } from './eventRoutes'
import { mediaRoutes } from './mediaRoutes'

/**
 * The host's own venue photograph over HTTP (ADR 0010, decision 8): the owner's upload and
 * removal, and the route that serves it to the wall, the guest and the host.
 *
 * The image pipeline is the in-memory double here, because the HTTP layer may not import an
 * adapter. Which bytes are an image, that EXIF and GPS are stripped and the orientation baked in,
 * and that the file is WebP are held one ring down against the real `sharp`
 * (`venuePhotoPipeline.test.ts`) and in the end-to-end journey; what these tests hold is what a
 * client observes of the routes: who may call them, what is refused, what is served to whom.
 */

const MAX_PIXELS = 50_000_000
const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const SLUG = 'camille-et-sacha'
const GALA_SLUG = 'gala-annuel'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'
const GUEST = '55555555-5555-4555-8555-555555555555'

const GUINGUETTE = { theme: { ...DEFAULT_EVENT_THEME, ambiance: 'guinguette' } } as const

/** A file as the double reads it: its bytes are its tag, whatever the client calls it. */
const phonePhoto = async (tag = 'phone-photo'): Promise<Buffer> => Buffer.from(tagBytes(tag))

interface World extends Harness {
  readonly media: InMemoryMediaStore
}

const buildWorld = (): World => {
  const media = new InMemoryMediaStore().forbidEnumeration('the venue photograph routes')
  const images = new FakeImageProcessor().script('not-an-image', {
    probeError: DomainError.invalid('image.unsupportedFormat'),
  })

  const harness = buildHarness({
    routes: (app, deps, base) => {
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post('/sign-in/moderator', signInAs({ userId: MODERATOR, email: 'mod@example.test' }))
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))

      const usecases: HttpUseCases = {
        ...notWiredUseCases(),
        setVenuePhoto: makeSetVenuePhoto({
          events: deps.events,
          memberships: deps.memberships,
          media,
          imageProcessor: images,
          hasher: new FakeContentHasher(),
          bus: deps.bus,
          logger: deps.logger,
          limits: { maxPixels: MAX_PIXELS },
        }),
        removeVenuePhoto: makeRemoveVenuePhoto({
          events: deps.events,
          memberships: deps.memberships,
          media,
          bus: deps.bus,
          logger: deps.logger,
        }),
        getVenuePhotoMedia: makeGetVenuePhotoMedia({ media }),
        getEventView: makeGetEventView({
          events: deps.events,
          getEventLimits: makeGetEventLimits({ clients: base.clients }),
        }),
        identifyMediaViewer: makeIdentifyMediaViewer({
          guests: base.guests,
          tokens: base.guestTokens,
          memberships: deps.memberships,
          clock: deps.clock,
        }),
      }
      const presenter = {
        publicUrl: deps.config.publicUrl,
        uploadLimits: deps.config.uploads,
        clipLimits: {
          maxBytes: deps.config.clips.maxBytes,
          maxSeconds: deps.config.clips.maxSeconds,
          supported: deps.config.clips.supported,
        },
      }
      app.use(
        '/api',
        eventRoutes({
          deps,
          usecases,
          presenter,
          creationLimiter: (_req, _res, next) => next(),
        }),
      )
      app.use('/api', mediaRoutes({ deps, usecases }))
    },
  })

  harness.users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: MODERATOR, email: 'mod@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
  )
  harness.events.seed(
    anEvent({
      id: WEDDING,
      ownerId: OWNER,
      slug: SLUG,
      joinCode: 'H7K2QM',
      status: 'live',
      settings: GUINGUETTE,
    }),
    anEvent({
      id: GALA,
      ownerId: GALA_OWNER,
      slug: GALA_SLUG,
      name: 'Gala annuel',
      joinCode: 'Z3N9PT',
      status: 'live',
      settings: GUINGUETTE,
    }),
  )
  harness.memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  harness.guests.seed(aGuest({ id: GUEST, eventId: WEDDING }))

  return { ...harness, media }
}

const signedIn = async (world: World, who: string): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const upload = async (agent: Agent, bytes: Buffer, slug = SLUG) =>
  agent.put(`/api/events/${slug}/venue-photo`).attach('photo', bytes, {
    // The client's words, which no layer may believe.
    filename: 'definitely-not-a-script.php',
    contentType: 'text/x-php',
  })

describe('the host venue photograph routes', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  describe('PUT /api/events/:slug/venue-photo', () => {
    it('stores the photograph and answers the event with its URL in the theme', async () => {
      const owner = await signedIn(world, 'owner')

      const response = await upload(owner, await phonePhoto())

      expect(response.status).toBe(200)
      expect(response.body.settings.theme.groundUrl).toMatch(
        new RegExp(`^/api/events/${SLUG}/venue-photo/[0-9a-f]{64}$`),
      )
      expect(world.media.objectCount).toBe(1)
    })

    it('announces the change so the wall refetches its theme', async () => {
      await upload(await signedIn(world, 'owner'), await phonePhoto())

      expect(world.bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
    })

    it('refuses what the pipeline does not recognise as an image, whatever the client called it', async () => {
      // Named .php and declared text/x-php by the helper: neither is read. The bytes decide.
      const response = await upload(
        await signedIn(world, 'owner'),
        await phonePhoto('not-an-image'),
      )

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('image.unsupportedFormat')
      expect(world.media.objectCount).toBe(0)
    })

    it('serves back the rendered bytes and never the upload, under a digest of its own', async () => {
      const owner = await signedIn(world, 'owner')
      const put = await upload(owner, await phonePhoto('upload-bytes'))

      const served = await owner
        .get(put.body.settings.theme.groundUrl)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => done(null, Buffer.concat(chunks)))
        })

      expect(served.body).toEqual(
        Buffer.from(new FakeImageProcessor().renderedBytes('upload-bytes', 'ground')),
      )
      expect(served.body).not.toEqual(Buffer.from(tagBytes('upload-bytes')))
    })

    it('answers 400 when no file was sent', async () => {
      const response = await (
        await signedIn(world, 'owner')
      )
        .put(`/api/events/${SLUG}/venue-photo`)
        .field('photo', 'not a file')

      expect(response.status).toBe(400)
    })

    it('answers 400 for a file in a part with another name', async () => {
      const response = await (
        await signedIn(world, 'owner')
      )
        .put(`/api/events/${SLUG}/venue-photo`)
        .attach('avatar', await phonePhoto(), 'x.jpg')

      expect(response.status).toBe(400)
      expect(world.media.objectCount).toBe(0)
    })

    it('answers 413 for a file above the operator’s per-file ceiling, buffering no more of it', async () => {
      const tiny = buildWorld()
      // The harness ceiling is 25 MB; send a little more than that.
      const response = await upload(await signedIn(tiny, 'owner'), Buffer.alloc(25_000_001, 0xff))

      expect(response.status).toBe(413)
      expect(response.body.error.code).toBe('upload.tooLarge')
      expect(tiny.media.objectCount).toBe(0)
    })

    it('refuses a moderator with 403 before buffering anything', async () => {
      const response = await upload(await signedIn(world, 'moderator'), await phonePhoto())

      expect(response.status).toBe(403)
      expect(world.media.objectCount).toBe(0)
    })

    it('answers 404, not 403, to the owner of another event', async () => {
      const response = await upload(await signedIn(world, 'gala-owner'), await phonePhoto())

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
      expect(world.media.objectCount).toBe(0)
    })

    it('answers 401 without a session', async () => {
      const response = await request(world.app)
        .put(`/api/events/${SLUG}/venue-photo`)
        .attach('photo', await phonePhoto(), 'x.jpg')

      expect(response.status).toBe(401)
    })

    it('limits one account to a handful of uploads an hour', async () => {
      const owner = await signedIn(world, 'owner')
      const photo = await phonePhoto('small')

      const statuses: number[] = []
      for (let attempt = 0; attempt < 12; attempt += 1) {
        statuses.push((await upload(owner, photo)).status)
      }

      expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true)
      expect(statuses.slice(10)).toEqual([429, 429])
    })
  })

  describe('DELETE /api/events/:slug/venue-photo', () => {
    it('removes the photograph and the URL goes with it', async () => {
      const owner = await signedIn(world, 'owner')
      const put = await upload(owner, await phonePhoto())

      const response = await owner.delete(`/api/events/${SLUG}/venue-photo`)

      expect(response.status).toBe(200)
      expect(response.body.settings.theme.groundUrl).toBeNull()
      expect(world.media.objectCount).toBe(0)
      // The URL the page held is a 404 the moment the row changes.
      const stale = await owner.get(put.body.settings.theme.groundUrl)
      expect(stale.status).toBe(404)
    })

    it('is idempotent', async () => {
      const owner = await signedIn(world, 'owner')

      const first = await owner.delete(`/api/events/${SLUG}/venue-photo`)
      const second = await owner.delete(`/api/events/${SLUG}/venue-photo`)

      expect([first.status, second.status]).toEqual([200, 200])
    })

    it('refuses a moderator with 403 and takes nothing down', async () => {
      const owner = await signedIn(world, 'owner')
      await upload(owner, await phonePhoto())

      const response = await (
        await signedIn(world, 'moderator')
      ).delete(`/api/events/${SLUG}/venue-photo`)

      expect(response.status).toBe(403)
      expect(world.media.objectCount).toBe(1)
    })

    it('answers 404 to the owner of another event, and leaves this one’s photograph', async () => {
      await upload(await signedIn(world, 'owner'), await phonePhoto())

      const response = await (
        await signedIn(world, 'gala-owner')
      ).delete(`/api/events/${SLUG}/venue-photo`)

      expect(response.status).toBe(404)
      expect(world.media.objectCount).toBe(1)
    })
  })

  describe('GET /api/events/:slug/venue-photo/:hash', () => {
    let url: string

    beforeEach(async () => {
      const put = await upload(await signedIn(world, 'owner'), await phonePhoto())
      url = put.body.settings.theme.groundUrl as string
    })

    it('serves the projector with no credential at all, as a content-addressed WebP', async () => {
      const response = await request(world.app).get(url)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('image/webp')
      expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['content-disposition']).toBe('inline')
    })

    it('serves a guest', async () => {
      const response = await request(world.app)
        .get(url)
        .set('Cookie', `es_guest=${world.issueGuestToken(WEDDING, GUEST)}`)

      expect(response.status).toBe(200)
    })

    it('answers 304 to a validator it already holds, without opening the file', async () => {
      const first = await request(world.app).get(url)

      const second = await request(world.app)
        .get(url)
        .set('If-None-Match', String(first.headers['etag']))

      expect(second.status).toBe(304)
      expect(world.media.opened).toBe(1)
    })

    it('answers a byte range', async () => {
      const response = await request(world.app).get(url).set('Range', 'bytes=0-3')

      expect(response.status).toBe(206)
      expect(response.headers['content-range']).toMatch(/^bytes 0-3\//)
    })

    it('answers 416 for a range outside the object', async () => {
      const response = await request(world.app).get(url).set('Range', 'bytes=9999999-')

      expect(response.status).toBe(416)
    })

    it('does not serve a draft event to the public or a guest, but does to its host', async () => {
      const draft = buildWorld()
      draft.events.seed(
        anEvent({
          id: asEventId('evt-draft'),
          ownerId: OWNER,
          slug: 'brouillon',
          joinCode: 'K4M8QR',
          status: 'draft',
          settings: GUINGUETTE,
        }),
      )
      draft.memberships.seed({
        eventId: asEventId('evt-draft'),
        userId: asUserId(OWNER),
        role: 'owner',
        grantedAt: AT,
      })
      const owner = await signedIn(draft, 'owner')
      const put = await upload(owner, await phonePhoto(), 'brouillon')

      expect((await request(draft.app).get(put.body.settings.theme.groundUrl)).status).toBe(404)
      expect((await owner.get(put.body.settings.theme.groundUrl)).status).toBe(200)
    })

    it('does not serve another event’s photograph under this slug (tenant isolation)', async () => {
      const gala = await signedIn(world, 'gala-owner')
      const put = await upload(gala, await phonePhoto('gala-photo'), GALA_SLUG)
      const galaDigest = (put.body.settings.theme.groundUrl as string).split('/').pop()

      const crossed = await request(world.app).get(`/api/events/${SLUG}/venue-photo/${galaDigest}`)

      expect(crossed.status).toBe(404)
      expect(crossed.body.error.code).toBe('venuePhoto.notFound')
    })

    it('answers the same 404 for an unknown event and a malformed digest as for a wrong one', async () => {
      const digest = url.split('/').pop()
      const answers = await Promise.all([
        request(world.app).get(`/api/events/no-such-event/venue-photo/${digest}`),
        request(world.app).get(`/api/events/${SLUG}/venue-photo/not-a-digest`),
        request(world.app).get(`/api/events/${SLUG}/venue-photo/${'0'.repeat(64)}`),
        request(world.app).get(`/api/events/${SLUG}/venue-photo/${digest?.toUpperCase()}`),
      ])

      expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404])
      expect(new Set(answers.map((answer) => answer.body.error.code))).toEqual(
        new Set(['venuePhoto.notFound']),
      )
    })
  })
})
