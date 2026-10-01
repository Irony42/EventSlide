import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  ABSOLUTE_SESSION_LIFETIME_MS,
  GUEST_COOKIE,
  PASSWORD_CHANGE_EXEMPT,
  PASSWORD_CHANGE_REQUIRED_CODE,
  requireGuest,
  requireOperator,
  requireRole,
  requireUser,
  resolvePublicEvent,
} from './authz'
import { CSRF_HEADER } from './csrf'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { mountedRoutes, type Route } from '../testing/routeTable'
import { buildServerHarness, type ServerHarness } from '../testing/serverHarness'
import { signedInAs, signInByAddress } from '../testing/signIn'
import { anEvent, aGuest, aUser, AT } from '../../../application/testing/builders'
import { CallLog } from '../../../application/testing/callLog'
import { ok } from '../../../domain/shared/result'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { HttpDeps, SessionPayload } from '../types'

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const HOST = 'host-id'
const OTHER_HOST = 'other-host-id'

/**
 * An app exposing one protected route per authorization rule, plus a sign-in route so
 * a test can establish a session without driving a real login.
 */
const harness = (): Harness => {
  const subject = buildSubject()
  // Both principals exist as accounts, which is the ordinary case: `requireUser` and
  // `roleFor` both answer from the `users` table now, so a world where the signed-in id
  // names no row is the *stale session* case and gets its own test rather than being
  // every test's starting point.
  subject.users.seed(
    aUser({ id: HOST, email: 'host@example.com' }),
    aUser({ id: OTHER_HOST, email: 'other@example.com' }),
  )
  return subject
}

const buildSubject = (): Harness =>
  buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/host', signInAs({ userId: HOST, email: 'host@example.com' }))
      app.post('/sign-in/other', signInAs({ userId: OTHER_HOST, email: 'other@example.com' }))
      // A session shaped the way every session on a running box is shaped today: an
      // identity and no `issuedAt`, because the field did not exist when it was written.
      // `signInAs` stamps one, so this is written by hand rather than by opting out of it.
      app.post('/sign-in/undated', (req, res) => {
        Object.assign(req.session as unknown as SessionPayload, {
          userId: HOST,
          email: 'host@example.com',
        })
        res.status(204).end()
      })

      app.get('/me', requireUser(deps), (req, res) => {
        res.json({ userId: req.context.user?.userId })
      })

      // Stands in for every handler that touches `req.session` directly — `authRoutes`
      // does it twice, on the login and the logout — so the middleware ahead of it cannot
      // leave a session-shaped hole behind without this failing.
      app.post('/session/touch', (req, res) => {
        const session = req.session as unknown as SessionPayload | undefined
        res.json({ hasSession: session !== undefined, userId: session?.userId ?? null })
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
const signedIn = async (subject: Harness, who: 'host' | 'other' | 'undated') => {
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
      routes: (app, deps) => {
        app.get('/me', requireUser(deps), (_req, res) => {
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

  /**
   * The asymmetry this closes: the anonymous guest was revocable in real time and the
   * authenticated host was not. `disabled_at` was read on exactly one line in the whole
   * product — inside `authenticateUser` — so switching a host off stopped their next
   * sign-in and nothing they were already doing, on a session that renews for as long as
   * it is used.
   */
  it('answers 401 once the account behind the session is disabled', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')
    await subject.users.save(aUser({ id: HOST, email: 'host@example.com' }).disable(AT))

    const response = await agent.get('/me')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 when the session names an account that is gone entirely', async () => {
    // The other half of one question: an account that no longer exists and one that was
    // switched off are the same refusal, because a session outliving its account names
    // nobody either way.
    const subject = buildSubject()
    const agent = await signedIn(subject, 'host')

    const response = await agent.get('/me')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('lets the account back in once it is enabled again', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')
    const host = aUser({ id: HOST, email: 'host@example.com' })
    await subject.users.save(host.disable(AT))

    await subject.users.save(host.enable())

    expect((await agent.get('/me')).status).toBe(200)
  })
})

describe('enforceSessionAge', () => {
  /**
   * The window `docs/SECURITY.md` §2 and §6 used to call twelve hours. `rolling: true`
   * plus a 12 h cookie is an **idle** timeout and `sqliteSessionStore.touch` pushes the
   * deadline forward on every request, so a session that keeps being used had no end at
   * all. These four cases are the end.
   */
  const almostAWeek = ABSOLUTE_SESSION_LIFETIME_MS - 1_000

  it('lets a session through for as long as an event lasts', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')

    subject.clock.advance(almostAWeek)

    expect((await agent.get('/me')).status).toBe(200)
  })

  it('ends a session once it has outlived the absolute cap', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')

    subject.clock.advance(ABSOLUTE_SESSION_LIFETIME_MS)

    const response = await agent.get('/me')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('is not pushed forward by being used, which is the whole difference from the idle timeout', async () => {
    const subject = harness()
    const agent = await signedIn(subject, 'host')

    // Three days of an active session, then the rest of the week.
    subject.clock.advance(3 * 24 * 60 * 60 * 1000)
    expect((await agent.get('/me')).status).toBe(200)
    subject.clock.advance(5 * 24 * 60 * 60 * 1000)

    expect((await agent.get('/me')).status).toBe(401)
  })

  it('ends a session that carries no issued-at at all', async () => {
    // Every session written before this middleware existed is one of these, and the
    // unbounded case is exactly the one that must not read as fresh. The cost is a
    // single forced sign-in after an upgrade.
    const subject = harness()
    const agent = await signedIn(subject, 'undated')

    expect((await agent.get('/me')).status).toBe(401)
  })

  it('treats a session stamped in the future as expired, not as fresh', async () => {
    // A box whose clock moved after boot. The server wrote the stamp, so this is skew
    // rather than a claim by anybody — and adding the skew to the cap is the one
    // direction that must not happen.
    const subject = harness()
    const agent = await signedIn(subject, 'host')
    subject.clock.advance(-ABSOLUTE_SESSION_LIFETIME_MS)

    expect((await agent.get('/me')).status).toBe(401)
  })

  it('leaves the request usable for the handler behind it, rather than a session-shaped hole', async () => {
    // `Session.destroy` deletes `req.session` before it calls the store, so a handler
    // that dereferences it — `authRoutes` does, on both the login and the logout — met a
    // `TypeError` and answered 500 on exactly the two routes a host reaches when their
    // session has just ended. `regenerate` leaves an empty session in its place.
    const subject = harness()
    const agent = await signedIn(subject, 'host')
    subject.clock.advance(ABSOLUTE_SESSION_LIFETIME_MS)

    const response = await agent.post('/session/touch')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasSession: true, userId: null })
  })

  it('leaves an anonymous request alone, so the wall and the join page are untouched', async () => {
    const subject = harness()
    seedWedding(subject)

    const response = await request(subject.app).get('/events/mariage/wall')

    expect(response.status).toBe(200)
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

  /**
   * A disabled owner keeps the membership row and loses the authority, on the very next
   * request, because `roleFor` is the read that answers both questions. There is no
   * second check in this middleware to forget: the sixteen use cases that ask an actor's
   * role for themselves are covered by the same answer.
   */
  it('answers 404 for an owner whose account has been disabled', async () => {
    const subject = harness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'host')
    await subject.users.save(aUser({ id: HOST, email: 'host@example.com' }).disable(AT))

    const response = await agent.get('/events/mariage/manage')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('answers a disabled member exactly as it answers a stranger, so the refusal reveals nothing', async () => {
    const subject = harness()
    seedWedding(subject)
    const disabled = await signedIn(subject, 'host')
    await subject.users.save(aUser({ id: HOST, email: 'host@example.com' }).disable(AT))
    const stranger = await signedIn(subject, 'other')

    const refused = await disabled.get('/events/mariage/moderate')
    const unknown = await stranger.get('/events/mariage/moderate')

    expect(refused.body).toEqual(unknown.body)
  })

  it('gives the role back once the account is enabled again, because the membership row survived', async () => {
    const subject = harness()
    seedWedding(subject)
    const agent = await signedIn(subject, 'host')
    const host = aUser({ id: HOST, email: 'host@example.com' })
    await subject.users.save(host.disable(AT))

    await subject.users.save(host.enable())

    expect((await agent.get('/events/mariage/manage')).status).toBe(200)
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

/**
 * `requirePasswordCurrent`, the server-side half of `mustChangePassword` (P3-03).
 *
 * Built the way `routes/siteOperatorScope.test.ts` sweeps the operator's own invariant:
 * the route table is read off the **assembled** server rather than hand-listed, so a
 * route mounted later is covered the day it lands rather than the day somebody
 * remembers to add it here. Unlike that sweep, this one needs no placeholder for a
 * route's `:parameters` at all — `requirePasswordCurrent` is mounted at `/api` and
 * answers by **path prefix**, ahead of every specific router, so it refuses
 * `GET /api/events/:eventSlug/moderation` requested with that literal, unresolved
 * segment exactly as it would refuse the real slug. A route that reached a router before
 * answering could not be swept this way; one that cannot be reached without the
 * question being asked first can.
 *
 * Only one `SITE_ADMIN` mode: `OPERATOR_ROUTES` in `siteOperatorScope.test.ts` is empty
 * today, so there is nothing under `/api/site` for this sweep to find in either mode.
 * Extend it the way that file extends across both modes once P3-13 mounts the first one.
 */
describe('requirePasswordCurrent: mustChangePassword enforced server-side (P3-03)', () => {
  /**
   * Mounted ahead of the whole session stack (`server.ts`), so there is no principal yet
   * for either to meet this gate — not an exemption, since there is nothing here for one
   * to exempt, but listed for the same stale-entry guard the real exemptions get.
   */
  const NOT_GATED: Readonly<Record<string, string>> = {
    'get /api/health': 'a liveness probe carries no session at all',
    'get /api/ready': 'the same seam as liveness',
  }

  const FLAGGED = '66666666-6666-4666-8666-666666666666'
  const FLAGGED_EMAIL = 'invite@example.test'

  type HarnessOverrides = NonNullable<Parameters<typeof buildServerHarness>[0]>

  const buildGateHarness = (overrides: HarnessOverrides = {}): ServerHarness =>
    buildServerHarness({
      ...overrides,
      usecases: {
        authenticateUser: signInByAddress({ [FLAGGED_EMAIL]: FLAGGED }),
        // Always succeeds, so the three-exemptions test below proves the route is
        // genuinely reachable rather than merely "not refused by this gate".
        changePassword: async () => ok(undefined),
        // `GET /api/events` is one of the two routes this file's "source of the flag"
        // cases ask *while the flag is clear*, to prove the gate lets an ordinary
        // request through rather than refusing everything unconditionally.
        listEventsForHost: async () => ok([]),
        ...overrides.usecases,
      },
    })

  /** Seeds the flagged account into storage and signs it in with a live CSRF token. */
  const flaggedCaller = async (subject: ServerHarness) => {
    subject.users.seed(aUser({ id: FLAGGED, email: FLAGGED_EMAIL, mustChangePassword: true }))
    return signedInAs(subject.app, FLAGGED_EMAIL)
  }

  const nameOf = (route: Route): string => `${route.method} ${route.path}`

  it('lists no exemption that is not a mounted route', () => {
    const mounted = new Set(mountedRoutes(buildGateHarness().app).map(nameOf))
    const keys = [...Object.keys(PASSWORD_CHANGE_EXEMPT), ...Object.keys(NOT_GATED)]

    expect(keys.filter((key) => !mounted.has(key))).toEqual([])
  })

  it('exempts a route once, or not at all', () => {
    const keys = [...Object.keys(PASSWORD_CHANGE_EXEMPT), ...Object.keys(NOT_GATED)]

    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([])
  })

  /** Issues the request a route describes, with a CSRF header for an unsafe method. */
  const send = (agent: request.Agent, route: Route, csrf: string): request.Test => {
    switch (route.method) {
      case 'get':
        return agent.get(route.path)
      case 'post':
        return agent.post(route.path).set(CSRF_HEADER, csrf)
      case 'patch':
        return agent.patch(route.path).set(CSRF_HEADER, csrf)
      case 'put':
        return agent.put(route.path).set(CSRF_HEADER, csrf)
      case 'delete':
        return agent.delete(route.path).set(CSRF_HEADER, csrf)
      default:
        throw new Error(`this sweep does not know how to issue a ${route.method} request`)
    }
  }

  describe('every mounted /api route but the three exemptions', () => {
    /**
     * Read once, at collection, the same way `siteOperatorScope.test.ts`'s own
     * per-route sweep does: a walk that throws on a shape it refuses to guess at
     * aborts the whole file with no case named otherwise, and this fails in its own
     * named case instead.
     */
    const table = ((): { readonly routes: readonly Route[]; readonly unreadable: unknown } => {
      try {
        const routes = mountedRoutes(buildGateHarness().app).filter((route) => {
          const name = nameOf(route)
          return PASSWORD_CHANGE_EXEMPT[name] === undefined && NOT_GATED[name] === undefined
        })
        return { routes, unreadable: null }
      } catch (error) {
        return { routes: [], unreadable: error }
      }
    })()

    it('reads the whole route table before sweeping it', () => {
      if (table.unreadable !== null) throw table.unreadable
      expect(table.routes.length).toBeGreaterThan(0)
    })

    it.each(table.routes.map((route): [string, Route] => [nameOf(route), route]))(
      'refuses %s with 403 auth.passwordChangeRequired while the flag is set',
      async (_name, route) => {
        const subject = buildGateHarness()
        const { agent, csrf } = await flaggedCaller(subject)

        const response = await send(agent, route, csrf)

        expect(response.status).toBe(403)
        expect(response.body.error.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE)
      },
    )
  })

  describe('the three exemptions, proven reachable rather than merely not refused', () => {
    it('still answers GET /api/auth/me, truthfully, while the flag is set', async () => {
      const subject = buildGateHarness()
      const { agent } = await flaggedCaller(subject)

      const response = await agent.get('/api/auth/me')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        authenticated: true,
        user: { mustChangePassword: true },
      })
    })

    it('still answers POST /api/auth/password, the only door out', async () => {
      const subject = buildGateHarness()
      const { agent, csrf } = await flaggedCaller(subject)

      const response = await agent
        .post('/api/auth/password')
        .set(CSRF_HEADER, csrf)
        .send({ currentPassword: 'peu-importe-ici', newPassword: 'une-autre-phrase-suffisante' })

      expect(response.status).toBe(204)
    })

    it('still answers POST /api/auth/logout, whatever state the account is in', async () => {
      const subject = buildGateHarness()
      const { agent, csrf } = await flaggedCaller(subject)

      const response = await agent.post('/api/auth/logout').set(CSRF_HEADER, csrf).send({})

      expect(response.status).toBe(204)
    })
  })

  describe('routes mounted ahead of the whole session stack', () => {
    it.each(Object.keys(NOT_GATED))(
      'answers %s normally, since the flag never reaches it',
      async (name) => {
        const subject = buildGateHarness()
        const { agent, csrf } = await flaggedCaller(subject)
        const route = mountedRoutes(subject.app).find((candidate) => nameOf(candidate) === name)
        if (route === undefined) throw new Error(`no route named "${name}" is mounted`)

        const response = await send(agent, route, csrf)

        expect(response.status).not.toBe(403)
      },
    )
  })

  describe('the source of the flag', () => {
    it('blocks a session the moment storage says so, even though it was clean at login', async () => {
      // The direct test of "read from storage, not the session": the cookie this agent
      // holds was minted while the account had no flag at all, so a session-cached
      // answer would still say so. The mutation this guards against is
      // `requirePasswordCurrent` (or `attachUser`) going back to reading the session.
      const subject = buildGateHarness()
      const user = aUser({ id: FLAGGED, email: FLAGGED_EMAIL, mustChangePassword: false })
      subject.users.seed(user)
      const { agent, csrf } = await signedInAs(subject.app, FLAGGED_EMAIL)
      await agent.get('/api/events').expect(200)

      await subject.users.save(user.requirePasswordChange())

      const response = await agent.post('/api/events').set(CSRF_HEADER, csrf).send({})

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE)
    })

    it('lets the same session back in once storage clears the flag, with no fresh login', async () => {
      const subject = buildGateHarness()
      const user = aUser({ id: FLAGGED, email: FLAGGED_EMAIL, mustChangePassword: true })
      subject.users.seed(user)
      const { agent } = await signedInAs(subject.app, FLAGGED_EMAIL)
      await agent.get('/api/events').expect(403)

      // Any hash other than the fixture's own default clears the flag (`User.
      // withPasswordHash`) — standing in here for what `POST /api/auth/password` does
      // through the use case, without driving a real bcrypt round trip.
      const rotated = user.withPasswordHash('hash:une-autre-phrase-suffisante')
      if (!rotated.ok) throw new Error('fixture: expected the rotated hash to differ')
      await subject.users.save(rotated.value)

      const response = await agent.get('/api/events')

      expect(response.status).toBe(200)
    })
  })
})
