import type { Request } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { anEvent, aGuest, AT } from '../../../application/testing/builders'
import { resolvePublicEvent, requireRole } from './authz'
import {
  guestScopeOf,
  hostScopeOf,
  moderatorScopeOf,
  publicEventOf,
  userOf,
  withGuest,
  withModerator,
  withPublicEvent,
} from './scope'
import { sendNoContent } from '../presenters/send'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { Logger } from '../../../application/ports/logger'
import type { RequestContext } from '../types'

const OWNER = '11111111-1111-4111-8111-111111111111'

/** What the logger was asked, so a test can read the reason a wiring failure gave. */
const recording = (): { logger: Logger; errors: Array<Record<string, unknown> | undefined> } => {
  const errors: Array<Record<string, unknown> | undefined> = []
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (_message, fields) => void errors.push(fields),
    child: () => logger,
  }
  return { logger, errors }
}

const carrier = (context: RequestContext): Pick<Request, 'context'> => ({ context })

describe('the scope helpers', () => {
  const { logger, errors } = recording()
  const bare: RequestContext = { requestId: 'req-1', logger }
  const user = { kind: 'user', userId: asUserId(OWNER), email: 'hote@example.test' } as const

  it('answers every missing piece with one server.unexpected, never a fallback principal', () => {
    // A route mounted without its authorization middleware is a wiring bug and has to
    // break rather than serve an anonymous caller: that is how 1.0 let one session reach
    // every party. The kind is what has the error handler answer an opaque 500.
    for (const missing of [
      () => userOf(carrier(bare)),
      () => hostScopeOf(carrier(bare)),
      () => hostScopeOf(carrier({ ...bare, user })),
      // An event but no role: `requireRole` sets both, so one without the other is not a state
      () => hostScopeOf(carrier({ ...bare, user, event: anEvent({}) })),
      () => guestScopeOf(carrier(bare)),
      () => moderatorScopeOf(carrier(bare)),
      () => moderatorScopeOf(carrier({ ...bare, user })),
      () => publicEventOf(carrier(bare)),
    ]) {
      expect(missing).toThrowError(expect.objectContaining({ kind: 'unexpected' }))
    }
    expect(errors.length).toBeGreaterThan(0)
  })

  it('hands back what the middleware resolved', () => {
    const event = anEvent({ slug: 'mariage' })
    const guest = aGuest({})
    const context: RequestContext = {
      ...bare,
      user,
      event,
      role: 'owner',
      guest: { kind: 'guest', guest, eventId: event.id },
    }

    expect(userOf(carrier(context))).toBe(user)
    expect(hostScopeOf(carrier(context))).toEqual({ user, event, role: 'owner' })
    expect(guestScopeOf(carrier(context))).toEqual({ event, guest })
    expect(publicEventOf(carrier(context))).toBe(event)
    expect(moderatorScopeOf(carrier(context))).toEqual({
      eventId: event.id,
      slug: 'mariage',
      actor: { kind: 'host', userId: user.userId },
    })
  })
})

describe('the wrappers in front of a handler', () => {
  const guarded = () =>
    buildHarness({
      routes: (app, deps) => {
        app.post('/sign-in', signInAs({ userId: OWNER, email: 'hote@example.test' }))
        // No authorization middleware at all, for each wrapper.
        app.get(
          '/bare/guest',
          withGuest(async (_scope, _req, res) => sendNoContent(res)),
        )
        app.get(
          '/bare/moderator',
          withModerator(async (_scope, _req, res) => sendNoContent(res)),
        )
        app.get(
          '/bare/public',
          withPublicEvent(async (_event, _req, res) => sendNoContent(res)),
        )
        // The event resolved, no guest and no user: what a public route leaves behind.
        app.get(
          '/events/:eventSlug/half/guest',
          resolvePublicEvent(deps),
          withGuest(async (_scope, _req, res) => sendNoContent(res)),
        )
        app.get(
          '/events/:eventSlug/half/moderator',
          resolvePublicEvent(deps),
          withModerator(async (_scope, _req, res) => sendNoContent(res)),
        )
        app.get(
          '/events/:eventSlug/ok',
          requireRole('moderator', deps),
          withModerator(async (_scope, _req, res) => sendNoContent(res)),
        )
      },
    })

  it.each(['/bare/guest', '/bare/moderator', '/bare/public'])(
    'answers %s with the same opaque 500 when no middleware ran',
    async (path) => {
      const response = await request(guarded().app).get(path)

      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe('server.unexpected')
      // The deliberate refusal, not a dereference of `undefined`: the error handler
      // stamps a `requestId` into the details of anything it did not expect.
      expect(response.body.error.details).toEqual({})
    },
  )

  it.each(['guest', 'moderator'])(
    'answers 500, not 401 or 404, when the event resolved but no %s did',
    async (kind) => {
      const subject = guarded()
      subject.events.seed(anEvent({ slug: 'mariage', status: 'live' }))

      const response = await request(subject.app).get(`/events/mariage/half/${kind}`)

      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe('server.unexpected')
    },
  )

  it('runs the handler when the middleware did its work', async () => {
    const subject = guarded()
    const event = anEvent({ slug: 'mariage', ownerId: OWNER })
    subject.events.seed(event)
    subject.memberships.seed({
      eventId: event.id,
      userId: asUserId(OWNER),
      role: 'owner',
      grantedAt: AT,
    })
    const agent = request.agent(subject.app)
    await agent.post('/sign-in')

    expect((await agent.get('/events/mariage/ok')).status).toBe(204)
  })

  it('runs the cleanup of withGuest on every exit, including a throw', async () => {
    const ran: string[] = []
    const subject = buildHarness({
      routes: (app, deps) => {
        app.get(
          '/events/:eventSlug/cleanup',
          (req, _res, next) => {
            // Stand in for requireGuest, which needs a token and a guest row.
            req.context.event = anEvent({ slug: 'mariage', status: 'live' })
            req.context.guest = {
              kind: 'guest',
              guest: aGuest({}),
              eventId: req.context.event.id,
            }
            next()
          },
          withGuest(
            async () => {
              throw new Error('boom')
            },
            { cleanup: async () => void ran.push('cleaned') },
          ),
        )
        void deps
      },
    })

    const response = await request(subject.app).get('/events/mariage/cleanup')

    expect(response.status).toBe(500)
    expect(ran).toEqual(['cleaned'])
  })
})
