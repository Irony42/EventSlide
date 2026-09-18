import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  GUEST_COOKIE,
  requireGuest,
  requireOperator,
  requireRole,
  requireUser,
  resolvePublicEvent,
} from './authz'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { anEvent, aGuest, aUser, AT } from '../../../application/testing/builders'
import { CallLog } from '../../../application/testing/callLog'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { HttpDeps } from '../types'

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

      // The shape every operator-only route of §10.2 onwards will have. There is no such
      // route in the product yet — the console, the clients and the invitations are their
      // own items — so this stands in for one, which is the only way the gate itself can
      // be held to its promises before it carries anything.
      app.get('/site/console', requireOperator(deps), (_req, res) => {
        res.json({ operating: true })
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

describe('attachUser', () => {
  it('finds nobody when the request has no session at all', async () => {
    // Identity resolution must fail closed rather than throw. Mounted before the
    // session middleware — a wiring mistake, but a possible one — the alternative is a
    // `TypeError` answered as an opaque 500 on a route that should simply be anonymous.
    const subject = buildHarness({
      withSession: false,
      routes: (app) => {
        app.get('/me', requireUser, (_req, res) => {
          res.status(204).end()
        })
      },
    })

    const response = await request(subject.app).get('/me')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})

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

describe('requireOperator', () => {
  const seedAccount = (subject: Harness, siteRole: 'none' | 'operator'): void => {
    subject.users.seed(aUser({ id: HOST, email: 'host@example.com', siteRole }))
  }

  it('answers 401 without a session, like every other gate here', async () => {
    const response = await request(harness().app).get('/site/console')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('lets the box’s operator through', async () => {
    const subject = harness()
    seedAccount(subject, 'operator')
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/site/console')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ operating: true })
  })

  it('answers 403 to an ordinary account, which is every account but one', async () => {
    const subject = harness()
    seedAccount(subject, 'none')
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/site/console')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.forbidden')
    expect(response.body.error.details.required).toBe('operator')
  })

  it('answers 403 to a session naming an account that no longer exists', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')

    await agent.get('/site/console').expect(403)
  })

  it('answers 403 once the operator’s account is switched off, mid-session', async () => {
    // The reason the role is read from storage on every request rather than carried in
    // the session: an operator who has been dismissed stops operating the box when
    // somebody disables the account, not twelve hours later when the cookie expires.
    const subject = harness()
    seedAccount(subject, 'operator')
    const agent = await signedIn(subject, 'host')
    await agent.get('/site/console').expect(200)

    subject.users.seed(
      aUser({ id: HOST, email: 'host@example.com', siteRole: 'operator', disabledAt: AT }),
    )

    await agent.get('/site/console').expect(403)
  })

  it('answers 403 once the role is taken away, without a fresh login', async () => {
    const subject = harness()
    seedAccount(subject, 'operator')
    const agent = await signedIn(subject, 'host')
    await agent.get('/site/console').expect(200)

    seedAccount(subject, 'none')

    await agent.get('/site/console').expect(403)
  })
})

describe('an operator is nobody inside an event', () => {
  /**
   * The half of §10.1 that is dangerous, and the reason the item is risk: medium.
   *
   * A second, higher authority now exists on the box, and every one of these assertions
   * says that `requireRole` went on meaning exactly what it meant before it did. An
   * operator who could quietly moderate a client's photographs is worse than one who
   * cannot help at all — support access is §10.6, time-boxed, announced and logged, and
   * it is not this.
   */
  const asOperator = (subject: Harness): void => {
    subject.users.seed(aUser({ id: HOST, email: 'host@example.com', siteRole: 'operator' }))
  }

  /** A client's evening, owned by the client. The operator has no part in it. */
  const seedClientEvent = (subject: Harness): void => {
    subject.events.seed(anEvent({ id: GALA, slug: 'gala', name: 'Gala', ownerId: OTHER_HOST }))
    subject.memberships.seed({
      eventId: asEventId(GALA),
      userId: asUserId(OTHER_HOST),
      role: 'owner',
      grantedAt: AT,
    })
  }

  it('answers 404 to the operator for a client’s moderation, exactly as it does to a stranger', async () => {
    const subject = harness()
    seedClientEvent(subject)
    asOperator(subject)
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/events/gala/moderate')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('answers 404 to the operator for a client’s settings, and tells them nothing more', async () => {
    const subject = harness()
    seedClientEvent(subject)
    asOperator(subject)
    const agent = await signedIn(subject, 'host')

    await agent.get('/events/gala/manage').expect(404)
  })

  it('does not promote an operator who was invited as a moderator', async () => {
    // The sharpest case. The caller holds both authorities at once — they run the box and
    // they were lent this event's moderation screen — and the owner's route must still
    // refuse them, because the two are answered from different tables and never added up.
    const subject = harness()
    subject.events.seed(anEvent({ id: WEDDING, slug: 'mariage', ownerId: OTHER_HOST }))
    subject.memberships.seed({
      eventId: asEventId(WEDDING),
      userId: asUserId(HOST),
      role: 'moderator',
      grantedAt: AT,
    })
    asOperator(subject)
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/events/mariage/manage')

    expect(response.status).toBe(403)
    expect(response.body.error.details.required).toBe('owner')
  })

  /**
   * `requireRole`, with the two repositories it could possibly consult under a call log.
   *
   * The rule — that the membership table is the only authority — is stated in `authz.ts`,
   * and a rule stated only in a comment is a rule with no guard. This is what records
   * whether the middleware *asked*: an elevation has to read the site role from somewhere,
   * and there is nowhere else to read it from.
   */
  const watchedHarness = (): { subject: Harness; calls: CallLog } => {
    const calls = new CallLog()
    const subject = buildHarness({
      routes: (app, deps) => {
        const watched: HttpDeps = {
          ...deps,
          users: calls.watch('users', deps.users),
          memberships: calls.watch('memberships', deps.memberships),
        }
        app.post('/sign-in/host', signInAs({ userId: HOST, email: 'host@example.com' }))
        app.get('/events/:eventSlug/moderate', requireRole('moderator', watched), (_req, res) => {
          res.status(204).end()
        })
      },
    })
    subject.users.seed(aUser({ id: HOST, email: 'host@example.com', siteRole: 'operator' }))
    return { subject, calls }
  }

  it('never asks what the caller may do on the box while resolving an event role', async () => {
    const { subject, calls } = watchedHarness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'host')

    await agent.get('/events/mariage/moderate').expect(204)

    expect(calls.sequenceOf('users.siteRoleFor', 'memberships.roleFor')).toEqual([
      'memberships.roleFor',
    ])
  })

  it('does not fall back to the site role when the membership is missing', async () => {
    // The shape an elevation would most plausibly take: leave the membership lookup alone
    // and answer "…or the caller runs the box" underneath it. The refusal is asserted in
    // its own tests above; what this adds is that the question was never even asked.
    const { subject, calls } = watchedHarness()
    seedClientEvent(subject)
    const agent = await signedIn(subject, 'host')

    await agent.get('/events/gala/moderate').expect(404)

    expect(calls.sequenceOf('users.siteRoleFor', 'memberships.roleFor')).toEqual([
      'memberships.roleFor',
    ])
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

  it('answers 404 for a slug that is not even slug-shaped', async () => {
    // The slug is parsed before the repository is asked anything, so a hostile path
    // segment never reaches a lookup — and it answers exactly like an absent event, so
    // the shape of the refusal says nothing about what exists.
    const subject = harness()
    seedGuest(subject)
    const token = subject.issueGuestToken(WEDDING, 'guest-1')

    const response = await request(subject.app)
      .get('/events/NOT_A_SLUG/upload')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
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
