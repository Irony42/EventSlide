import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { bookRoutes } from './bookRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { notWiredUseCases } from '../testing/serverHarness'
import { GUEST_COOKIE } from '../middleware/authz'
import type { PresenterContext } from '../presenters/presenters'
import type { HttpUseCases } from '../useCases'
import { AT, aGuest, anEvent, aPhoto } from '../../../application/testing/builders'
import { FakeAlbumBookRepository } from '../../../application/testing/fakeAlbumBookRepository'
import { FakeBookFileStore } from '../../../application/testing/fakeBookFileStore'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { makeDeleteAlbumBook } from '../../../application/usecases/book/deleteAlbumBook'
import { makeDownloadAlbumBook } from '../../../application/usecases/book/downloadAlbumBook'
import { makeGetAlbumBook } from '../../../application/usecases/book/getAlbumBook'
import { makeRequestAlbumBook } from '../../../application/usecases/book/requestAlbumBook'
import { asEventId, asUserId } from '../../../domain/shared/ids'

/**
 * The photo book's HTTP surface (spec 04, ring 4): who may call what, what each answer looks like,
 * and that one event's book never reaches another event's moderator. The rules themselves are the
 * use cases' own tests; this asserts the contract around them.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const OWNER = 'owner-id'
const MODERATOR = 'moderator-id'
const GALA_OWNER = 'gala-owner-id'
const GUEST = 'guest-1'

const PRESENTER: PresenterContext = {
  publicUrl: 'http://localhost:4300',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
  clipLimits: { maxBytes: 80_000_000, maxSeconds: 15, supported: true },
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25])

const BODY = {
  title: 'Mariage de Camille',
  subtitle: '14 juin 2026',
  layout: 'four',
  showAuthors: true,
  showCaptions: false,
} as const

interface World extends Harness {
  readonly books: FakeAlbumBookRepository
  readonly bookFiles: FakeBookFileStore
  readonly state: { enabled: boolean }
}

const world = (): World => {
  const books = new FakeAlbumBookRepository()
  const bookFiles = new FakeBookFileStore()
  const photos = new FakePhotoRepository()
  const state = { enabled: true }

  const harness = buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      const usecases: HttpUseCases = {
        ...notWiredUseCases(),
        requestAlbumBook: (input) =>
          makeRequestAlbumBook({
            events: deps.events,
            clients: deps.clients,
            photos,
            books,
            bus: deps.bus,
            clock: deps.clock,
            policy: { enabled: state.enabled, maxPerEventPerDay: 3 },
          })(input),
        getAlbumBook: makeGetAlbumBook({ events: deps.events, books }),
        downloadAlbumBook: makeDownloadAlbumBook({
          events: deps.events,
          books,
          bookFiles,
          clock: deps.clock,
        }),
        deleteAlbumBook: makeDeleteAlbumBook({
          events: deps.events,
          books,
          bookFiles,
          bus: deps.bus,
        }),
      }
      app.use('/api', bookRoutes({ deps, usecases, presenter: PRESENTER }))
    },
  })

  harness.events.seed(
    anEvent({ id: WEDDING, slug: 'mariage', name: 'Camille & Sacha', ownerId: OWNER }),
    anEvent({ id: GALA, slug: 'gala', name: 'Gala', ownerId: GALA_OWNER, joinCode: 'B4N9PT' }),
  )
  harness.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  harness.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }))
  photos.seed(
    aPhoto({ id: 'p-wedding', eventId: WEDDING, status: 'published' }),
    aPhoto({ id: 'p-gala', eventId: GALA, status: 'published' }),
  )

  return Object.assign(harness, { books, bookFiles, state })
}

const signedIn = async (subject: World, who: 'owner' | 'moderator' | 'gala') => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

/** A finished book for an event, with a file of ten bytes. */
const seedDoneBook = async (subject: World, eventId: string, slug: string): Promise<void> => {
  const agent = await signedIn(subject, eventId === WEDDING ? 'moderator' : 'gala')
  await agent.post(`/api/events/${slug}/book`).send(BODY).expect(202)
  const id = asEventId(eventId)
  const claimed = await subject.books.claimNext(AT)
  if (claimed === null) throw new Error('fixture')
  await subject.books.save({
    ...claimed,
    status: 'done',
    doneAt: subject.clock.now(),
    photoCount: 1,
    skippedCount: 0,
    pageCount: 3,
    byteSize: PDF.length,
    expiresAt: new Date(subject.clock.now().getTime() + 7 * 86_400_000),
  })
  subject.bookFiles.seed(id, PDF)
}

let subject: World

beforeEach(() => {
  subject = world()
})

describe('who may call the book routes', () => {
  const ROUTES = [
    ['post', '/api/events/mariage/book'],
    ['get', '/api/events/mariage/book'],
    ['get', '/api/events/mariage/book.pdf'],
    ['delete', '/api/events/mariage/book'],
  ] as const

  it.each(ROUTES)('%s %s answers 401 without a session', async (method, url) => {
    const response = await request(subject.app)[method](url).send(BODY)

    expect(response.status).toBe(401)
  })

  it.each(ROUTES)('%s %s answers 404 to a moderator of another event', async (method, url) => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent[method](url).send(BODY)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it.each(ROUTES)('%s %s refuses a guest device token', async (method, url) => {
    const cookie = `${GUEST_COOKIE}=${subject.issueGuestToken(WEDDING, GUEST)}`

    const response = await request(subject.app)[method](url).set('Cookie', cookie).send(BODY)

    expect(response.status).toBe(401)
  })

  it('lets a moderator, not only the owner, ask for the book', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.post('/api/events/mariage/book').send(BODY)

    expect(response.status).toBe(202)
  })
})

describe('POST /api/events/:eventSlug/book', () => {
  it('answers 202 with the queued book, never stored by a cache', async () => {
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post('/api/events/mariage/book').send(BODY)

    expect(response.status).toBe(202)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      status: 'queued',
      options: {
        title: 'Mariage de Camille',
        subtitle: '14 juin 2026',
        language: 'fr',
        layout: 'four',
        showAuthors: true,
        showCaptions: false,
      },
      requestedAt: AT.toISOString(),
      doneAt: null,
      photoCount: null,
      skippedCount: null,
      pageCount: null,
      byteSize: null,
      expiresAt: null,
      failureCode: null,
      staleReason: null,
    })
  })

  it.each([
    ['an unknown field', { ...BODY, path: '/etc/passwd' }],
    ['a layout that does not exist', { ...BODY, layout: 'six' }],
    ['a title that is not a string', { ...BODY, title: 12 }],
    ['a missing flag', { title: 'x', layout: 'one', showAuthors: true }],
    ['a language the product does not speak', { ...BODY, language: 'pl' }],
    ['a title far past any bound', { ...BODY, title: 'x'.repeat(401) }],
  ])('answers 400 request.invalid for %s', async (_name, body) => {
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post('/api/events/mariage/book').send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 400 with the domain code for an empty title', async () => {
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post('/api/events/mariage/book').send({ ...BODY, title: '  ' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('book.titleEmpty')
  })

  it('answers 409 book.alreadyRunning for a second request while one is queued', async () => {
    const agent = await signedIn(subject, 'owner')
    await agent.post('/api/events/mariage/book').send(BODY).expect(202)

    const response = await agent.post('/api/events/mariage/book').send(BODY)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('book.alreadyRunning')
  })

  it('answers 409 book.empty for an album with nothing published', async () => {
    const agent = await signedIn(subject, 'gala')
    // The gala's only photograph is published; remove the possibility by asking a fresh event.
    subject.events.seed(
      anEvent({ id: 'empty-id', slug: 'vide', ownerId: GALA_OWNER, joinCode: 'C5M8QR' }),
    )
    subject.memberships.seed({
      eventId: asEventId('empty-id'),
      userId: asUserId(GALA_OWNER),
      role: 'owner',
      grantedAt: AT,
    })

    const response = await agent.post('/api/events/vide/book').send(BODY)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('book.empty')
  })

  it('answers 429 with Retry-After on the fourth book of the day', async () => {
    const agent = await signedIn(subject, 'owner')
    for (let index = 0; index < 3; index += 1) {
      await agent.post('/api/events/mariage/book').send(BODY).expect(202)
      await agent.delete('/api/events/mariage/book').expect(204)
    }

    const response = await agent.post('/api/events/mariage/book').send(BODY)

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('book.dailyLimitReached')
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('answers 503 book.unavailable when the box switched the function off', async () => {
    subject.state.enabled = false
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post('/api/events/mariage/book').send(BODY)

    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('book.unavailable')
  })

  it('answers 403 client.suspended for a suspended client, and writes nothing', async () => {
    subject.events.seed(
      anEvent({ id: WEDDING, slug: 'mariage', ownerId: OWNER, clientSuspendedAt: AT }),
    )
    const agent = await signedIn(subject, 'owner')

    const response = await agent.post('/api/events/mariage/book').send(BODY)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('client.suspended')
    expect(await subject.books.find(asEventId(WEDDING))).toBeNull()
  })
})

describe('GET /api/events/:eventSlug/book', () => {
  it('says none when no book was ever asked for, and the state afterwards, never cached', async () => {
    const agent = await signedIn(subject, 'moderator')

    const none = await agent.get('/api/events/mariage/book')
    expect(none.status).toBe(200)
    expect(none.headers['cache-control']).toBe('no-store')
    expect(none.body).toEqual({ status: 'none' })

    await agent.post('/api/events/mariage/book').send(BODY).expect(202)
    expect((await agent.get('/api/events/mariage/book')).body.status).toBe('queued')
  })

  it('shows nothing of another event', async () => {
    await seedDoneBook(subject, GALA, 'gala')
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/book')

    expect(response.body).toEqual({ status: 'none' })
  })
})

describe('GET /api/events/:eventSlug/book.pdf', () => {
  it('answers 404 book.notFound when there is nothing to give, never a download', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/book.pdf')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('book.notFound')
    expect(response.headers['content-disposition']).toBeUndefined()
  })

  it('serves the PDF as an attachment named from the slug, never from the title', async () => {
    await seedDoneBook(subject, WEDDING, 'mariage')
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/book.pdf').buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe('attachment; filename="mariage-livre.pdf"')
    expect(response.headers['content-disposition']).not.toContain('Camille')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-length']).toBe(String(PDF.length))
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(response.body).equals(Buffer.from(PDF))).toBe(true)
  })

  it('answers a Range request with 206, and an impossible one with 416', async () => {
    await seedDoneBook(subject, WEDDING, 'mariage')
    const agent = await signedIn(subject, 'moderator')

    const part = await agent
      .get('/api/events/mariage/book.pdf')
      .set('Range', 'bytes=2-4')
      .buffer(true)
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 2-4/${PDF.length}`)
    expect(part.headers['content-length']).toBe('3')
    expect(Buffer.from(part.body).equals(Buffer.from(PDF.subarray(2, 5)))).toBe(true)

    const past = await agent.get('/api/events/mariage/book.pdf').set('Range', 'bytes=500-600')
    expect(past.status).toBe(416)
    expect(past.headers['content-range']).toBe(`bytes */${PDF.length}`)
  })

  it('never serves the book of one event under the slug of another', async () => {
    await seedDoneBook(subject, WEDDING, 'mariage')
    const agent = await signedIn(subject, 'gala')

    const own = await agent.get('/api/events/gala/book.pdf')
    const other = await agent.get('/api/events/mariage/book.pdf')

    expect(own.status).toBe(404)
    expect(other.status).toBe(404)
    expect(other.body.error.code).toBe('event.notFound')
  })

  it('answers 403 client.suspended and keeps the file', async () => {
    await seedDoneBook(subject, WEDDING, 'mariage')
    subject.events.seed(
      anEvent({ id: WEDDING, slug: 'mariage', ownerId: OWNER, clientSuspendedAt: AT }),
    )
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/book.pdf')

    expect(response.status).toBe(403)
    expect(await subject.bookFiles.stat(asEventId(WEDDING))).not.toBeNull()
  })
})

describe('DELETE /api/events/:eventSlug/book', () => {
  it('answers 204, deletes the row and the file, and is idempotent', async () => {
    await seedDoneBook(subject, WEDDING, 'mariage')
    const agent = await signedIn(subject, 'moderator')

    await agent.delete('/api/events/mariage/book').expect(204)
    await agent.delete('/api/events/mariage/book').expect(204)

    expect(await subject.books.find(asEventId(WEDDING))).toBeNull()
    expect(await subject.bookFiles.stat(asEventId(WEDDING))).toBeNull()
  })

  it('leaves the book of another event alone', async () => {
    await seedDoneBook(subject, GALA, 'gala')
    const agent = await signedIn(subject, 'moderator')

    await agent.delete('/api/events/mariage/book').expect(204)

    expect(await subject.books.find(asEventId(GALA))).not.toBeNull()
    expect(await subject.bookFiles.stat(asEventId(GALA))).not.toBeNull()
  })
})
