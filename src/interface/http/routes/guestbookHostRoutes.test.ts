import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { guestbookRoutes } from './guestbookRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { GUEST_COOKIE } from '../middleware/authz'
import { AT, aGuest, aGuestbookEntry, anEvent, atPlus } from '../../../application/testing/builders'
import { FakeGuestbookRepository } from '../../../application/testing/fakeGuestbookRepository'
import { makeListGuestbookQueue } from '../../../application/usecases/guestbook/listGuestbookQueue'
import { makeModerateGuestbookEntry } from '../../../application/usecases/guestbook/moderateGuestbookEntry'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestbookEntryId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'

/**
 * Ring 4: the host's side of the guestbook (spec 01, PR 3), with the real use cases over fakes so
 * the cross-event and cross-role cases mean something.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const OWNER = 'owner-id'
const MODERATOR = 'moderator-id'
const GALA_OWNER = 'gala-owner-id'
const GUEST = 'guest-1'
const OLDER = 'a0000000-0000-4000-8000-000000000001'
const NEWER = 'a0000000-0000-4000-8000-000000000002'
const LIVE = 'a0000000-0000-4000-8000-000000000003'
const GALA_1 = 'a0000000-0000-4000-8000-000000000004'

const notWired = async () => err(DomainError.unexpected('test.useCaseNotWired'))

interface World extends Harness {
  readonly guestbook: FakeGuestbookRepository
}

const world = (): World => {
  const guestbook = new FakeGuestbookRepository()
  const harness = buildHarness({
    routes: (app, deps, base) => {
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      const { events, memberships, bus, clock } = deps
      app.use(
        '/api',
        guestbookRoutes({
          deps,
          usecases: {
            createGuestbookEntry: notWired,
            listMyGuestbookEntries: notWired,
            deleteGuestbookEntry: notWired,
            listGuestbookQueue: makeListGuestbookQueue({
              events,
              guestbook,
              guests: base.guests,
              memberships,
            }),
            moderateGuestbookEntry: makeModerateGuestbookEntry({
              events,
              guestbook,
              memberships,
              bus,
              clock,
            }),
          },
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({ id: WEDDING, slug: 'mariage', ownerId: OWNER }),
    anEvent({ id: GALA, slug: 'gala', ownerId: GALA_OWNER, joinCode: 'B4N9PT' }),
  )
  harness.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  harness.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }))
  guestbook.seed(
    aGuestbookEntry({
      id: OLDER,
      eventId: WEDDING,
      guestId: GUEST,
      text: 'Premier',
      createdAt: AT,
    }),
    aGuestbookEntry({ id: NEWER, eventId: WEDDING, guestId: GUEST, createdAt: atPlus(1_000) }),
    aGuestbookEntry({
      id: LIVE,
      eventId: WEDDING,
      guestId: GUEST,
      moderation: 'auto',
      createdAt: atPlus(2_000),
    }),
    aGuestbookEntry({ id: GALA_1, eventId: GALA, guestId: GUEST }),
  )
  return { ...harness, guestbook }
}

const signedIn = async (subject: World, who: 'owner' | 'moderator' | 'gala') => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const statusOf = async (subject: World, eventId: string, id: string) =>
  (await subject.guestbook.findById(asEventId(eventId), asGuestbookEntryId(id)))?.status ?? null

let subject: World

beforeEach(() => {
  subject = world()
})

describe('GET /api/events/:eventSlug/guestbook', () => {
  it('returns what needs a decision first (oldest first), then the rest, with the author name', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/guestbook')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([OLDER, NEWER, LIVE])
    expect(response.body.items[0]).toEqual({
      id: OLDER,
      text: 'Premier',
      authorName: 'Léa',
      status: 'pending',
      createdAt: AT.toISOString(),
      allowedDecisions: ['publish', 'reject'],
    })
    expect(response.body.pendingCount).toBe(2)
  })

  it('never carries a guest id, whatever the row', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/guestbook')

    expect(JSON.stringify(response.body)).not.toContain(GUEST)
  })

  it('filters by status and applies the limit after the order', async () => {
    const agent = await signedIn(subject, 'moderator')

    const published = await agent.get('/api/events/mariage/guestbook?status=published')
    const first = await agent.get('/api/events/mariage/guestbook?limit=1')

    expect(published.body.items.map((item: { id: string }) => item.id)).toEqual([LIVE])
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([OLDER])
  })

  it('shows another event no message of this one', async () => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent.get('/api/events/gala/guestbook')

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([GALA_1])
  })

  it('answers 401 without a session, and 401 for a guest device token', async () => {
    const anonymous = await request(subject.app).get('/api/events/mariage/guestbook')
    const guest = await request(subject.app)
      .get('/api/events/mariage/guestbook')
      .set('Cookie', `${GUEST_COOKIE}=${subject.issueGuestToken(WEDDING, GUEST)}`)

    expect(anonymous.status).toBe(401)
    expect(guest.status).toBe(401)
  })

  it('answers 404 for a host of another event, never 403', async () => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent.get('/api/events/mariage/guestbook')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it.each(['status=deleted-forever', 'limit=0', 'limit=501', 'limit=beaucoup', 'cursor=x'])(
    'answers 400 for %s',
    async (query) => {
      const agent = await signedIn(subject, 'moderator')

      const response = await agent.get(`/api/events/mariage/guestbook?${query}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    },
  )
})

describe('PATCH /api/events/:eventSlug/guestbook/:entryId/status', () => {
  const entryUrl = (id: string, slug = 'mariage') => `/api/events/${slug}/guestbook/${id}/status`

  it('publishes a pending message for a moderator, with a 204', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl(OLDER)).send({ decision: 'publish' })

    expect(response.status).toBe(204)
    expect(await statusOf(subject, WEDDING, OLDER)).toBe('published')
  })

  it('answers 409 guestbook.illegalTransition for a move the machine refuses', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl(OLDER)).send({ decision: 'hide' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('guestbook.illegalTransition')
    expect(await statusOf(subject, WEDDING, OLDER)).toBe('pending')
  })

  it('answers 404 guestbook.notFound for a message of another event, and leaves it', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl(GALA_1)).send({ decision: 'publish' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('guestbook.notFound')
    expect(await statusOf(subject, GALA, GALA_1)).toBe('pending')
  })

  it('answers 404 guestbook.notFound for a message the operator took down', async () => {
    subject.guestbook.takeDown(asEventId(WEDDING), asGuestbookEntryId(OLDER), AT)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl(OLDER)).send({ decision: 'publish' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('guestbook.notFound')
  })

  it('answers 409 event.notModeratable on an archived event', async () => {
    subject.events.seed(
      anEvent({ id: WEDDING, slug: 'mariage', ownerId: OWNER, status: 'archived' }),
    )
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl(OLDER)).send({ decision: 'publish' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('event.notModeratable')
  })

  it('answers 401 without a session and for a guest device token, and 404 for another event host', async () => {
    const anonymous = await request(subject.app)
      .patch(entryUrl(OLDER))
      .send({ decision: 'publish' })
    const guest = await request(subject.app)
      .patch(entryUrl(OLDER))
      .set('Cookie', `${GUEST_COOKIE}=${subject.issueGuestToken(WEDDING, GUEST)}`)
      .send({ decision: 'publish' })
    const gala = await (
      await signedIn(subject, 'gala')
    )
      .patch(entryUrl(OLDER))
      .send({ decision: 'publish' })

    expect(anonymous.status).toBe(401)
    expect(guest.status).toBe(401)
    expect(gala.status).toBe(404)
    expect(await statusOf(subject, WEDDING, OLDER)).toBe('pending')
  })

  it.each([
    { label: 'an unknown decision', body: { decision: 'delete' } },
    { label: 'an unexpected key', body: { decision: 'publish', extra: 1 } },
    { label: 'no decision', body: {} },
  ])('answers 400 for $label', async ({ body }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl(OLDER)).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 400 for an entry id that is not an id', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(entryUrl('not-an-id')).send({ decision: 'publish' })

    expect(response.status).toBe(400)
  })
})
