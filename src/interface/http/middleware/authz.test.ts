import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { GUEST_COOKIE, requireGuest, requireRole, requireUser, resolvePublicEvent } from './authz'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { anEvent, aGuest, AT } from '../../../application/testing/builders'
import { asEventId, asUserId } from '../../../domain/shared/ids'

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const HOST = 'host-id'
const OTHER_HOST = 'other-host-id'

/**
 * An app exposing one protected route per authorization rule, plus a sign-in route so
 * a test can establish a session without driving a real login.
 */
const harness = (): Harness =>
  buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/host', signInAs({ userId: HOST, email: 'host@example.com' }))
      app.post('/sign-in/other', signInAs({ userId: OTHER_HOST, email: 'other@example.com' }))

      app.get('/me', requireUser, (req, res) => {
        res.json({ userId: req.context.user?.userId })
      })

      app.get('/events/:eventSlug/moderate', requireRole('moderator', deps), (req, res) => {
        res.json({ slug: req.context.event?.slug.value, role: req.context.role })
      })

      app.get('/events/:eventSlug/manage', requireRole('owner', deps), (req, res) => {
        res.json({ role: req.context.role })
      })

      app.get('/events/:eventSlug/upload', requireGuest(deps), (req, res) => {
        res.json({ guestId: req.context.guest?.guest.id })
      })

      app.get('/events/:eventSlug/wall', resolvePublicEvent(deps), (req, res) => {
        res.json({ name: req.context.event?.name.value })
      })
    },
  })

const seedWedding = (subject: Harness): void => {
  subject.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      name: 'Camille & Sacha',
      ownerId: HOST,
      joinCode: 'H7K2QM',
    }),
    anEvent({ id: GALA, slug: 'gala', name: 'Gala', ownerId: OTHER_HOST, joinCode: 'B4N9PT' }),
  )
  subject.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(HOST), role: 'owner', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(OTHER_HOST), role: 'owner', grantedAt: AT },
  )
}

/** A supertest agent that keeps the session cookie across requests. */
const signedIn = async (subject: Harness, who: 'host' | 'other') => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

describe('requireUser', () => {
  it('answers 401 without a session', async () => {
    const response = await request(harness().app).get('/me')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('lets an authenticated caller through', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/me')

    expect(response.status).toBe(200)
    expect(response.body.userId).toBe(HOST)
  })
})

describe('requireRole', () => {
  it('resolves the event and the role for a member', async () => {
    const subject = harness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/events/mariage/moderate')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ slug: 'mariage', role: 'owner' })
  })

  it('answers 401 before looking the event up, so an anonymous caller cannot probe slugs', async () => {
    const subject = harness()
    seedWedding(subject)

    const response = await request(subject.app).get('/events/mariage/moderate')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for an event the caller has no part in, never 403', async () => {
    // A 403 would confirm the event exists and turn this into an enumeration oracle
    // for other people's events.
    const subject = harness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'other')

    const response = await agent.get('/events/mariage/moderate')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('answers 404 for an event that does not exist', async () => {
    const subject = harness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/events/no-such-event/moderate')

    expect(response.status).toBe(404)
  })

  it('answers 404 for a slug that is not even slug-shaped', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/events/NOT_A_SLUG/moderate')

    expect(response.status).toBe(404)
  })

  it('answers 403 when the caller is in scope but lacks the role', async () => {
    // Here 403 is honest: the caller already knows the event exists, so revealing
    // nothing new.
    const subject = harness()
    subject.events.seed(anEvent({ id: WEDDING, slug: 'mariage', ownerId: OTHER_HOST }))
    subject.memberships.seed({
      eventId: asEventId(WEDDING),
      userId: asUserId(HOST),
      role: 'moderator',
      grantedAt: AT,
    })
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/events/mariage/manage')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.forbidden')
    expect(response.body.error.details.required).toBe('owner')
  })

  it('lets an owner through a moderator-level route', async () => {
    const subject = harness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'host')

    await agent.get('/events/mariage/moderate').expect(200)
  })
})

describe('requireGuest', () => {
  const seedGuest = (subject: Harness, options: { revoked?: boolean } = {}): void => {
    subject.events.seed(
      anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT' }),
    )
    subject.guests.seed(
      aGuest({
        id: 'guest-1',
        eventId: WEDDING,
        displayName: 'Léa',
        ...(options.revoked === true ? { revokedAt: AT } : {}),
      }),
    )
  }

  it('lets a guest with a valid token for this event through', async () => {
    const subject = harness()
    seedGuest(subject)
    const token = subject.issueGuestToken(WEDDING, 'guest-1')

    const response = await request(subject.app)
      .get('/events/mariage/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(200)
    expect(response.body.guestId).toBe('guest-1')
  })

  it('refuses a token issued for another event', async () => {
    // The cross-event attack: a guest at one wedding pointing their own cookie at
    // another event's upload endpoint.
    const subject = harness()
    seedGuest(subject)
    const token = subject.issueGuestToken(GALA, 'guest-1')

    const response = await request(subject.app)
      .get('/events/mariage/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.wrongEvent')
  })

  it('answers 401 with no cookie at all', async () => {
    const subject = harness()
    seedGuest(subject)

    const response = await request(subject.app).get('/events/mariage/upload')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 for a forged token', async () => {
    const subject = harness()
    seedGuest(subject)

    const response = await request(subject.app)
      .get('/events/mariage/upload')
      .set('Cookie', `${GUEST_COOKIE}=v1.forged.mac`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('guestToken.badSignature')
  })

  it('refuses a revoked guest, which is what makes a stateless token revocable', async () => {
    const subject = harness()
    seedGuest(subject, { revoked: true })
    const token = subject.issueGuestToken(WEDDING, 'guest-1')

    const response = await request(subject.app)
      .get('/events/mariage/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.revoked')
  })

  it('refuses a token naming a guest row that no longer exists', async () => {
    const subject = harness()
    subject.events.seed(anEvent({ id: WEDDING, slug: 'mariage' }))
    const token = subject.issueGuestToken(WEDDING, 'never-existed')

    const response = await request(subject.app)
      .get('/events/mariage/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(401)
  })

  it('answers 404 for an event that does not exist', async () => {
    const subject = harness()
    seedGuest(subject)
    const token = subject.issueGuestToken(WEDDING, 'guest-1')

    const response = await request(subject.app)
      .get('/events/no-such-event/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(404)
  })

  it('rejects an expired token', async () => {
    const subject = harness()
    seedGuest(subject)
    const token = subject.issueGuestToken(WEDDING, 'guest-1')
    // Two days later: past the token's own maximum age.
    subject.clock.advance(48 * 60 * 60 * 1000)

    const response = await request(subject.app)
      .get('/events/mariage/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('guestToken.expired')
  })
})

describe('resolvePublicEvent', () => {
  it('serves a live event with no credential at all', async () => {
    const subject = harness()
    subject.events.seed(anEvent({ slug: 'mariage', name: 'Camille & Sacha', status: 'live' }))

    const response = await request(subject.app).get('/events/mariage/wall')

    expect(response.status).toBe(200)
    expect(response.body.name).toBe('Camille & Sacha')
  })

  it('still serves a closed event, because the projector is usually still on', async () => {
    const subject = harness()
    subject.events.seed(anEvent({ slug: 'mariage', status: 'closed' }))

    await request(subject.app).get('/events/mariage/wall').expect(200)
  })

  it.each(['draft', 'archived'] as const)(
    'answers 404 for a %s event, so the public read path cannot reach it',
    async (status) => {
      const subject = harness()
      subject.events.seed(anEvent({ slug: 'mariage', status }))

      const response = await request(subject.app).get('/events/mariage/wall')

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
    },
  )

  it('answers 404 for an unknown slug', async () => {
    await request(harness().app).get('/events/nope/wall').expect(404)
  })
})
