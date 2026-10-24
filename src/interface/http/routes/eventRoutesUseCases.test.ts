import { describe, expect, it } from 'vitest'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { err, ok } from '../../../domain/shared/result'
import { CSRF_HEADER } from '../middleware/csrf'
import { buildServerHarness } from '../testing/serverHarness'
import { signedInAs, signInByAddress } from '../testing/signIn'
import type { HttpUseCases } from '../useCases'

/**
 * The three event routes that used to build their own use case (HTTP-M-05) answer from the bag the
 * composition root hands the router, like every other route.
 *
 * `renameEvent`, `listModerators` and `revokeModerator` were composed inside `eventRoutes.ts` from
 * `deps.events`, `deps.memberships` and `deps.bus`, so they were in neither `HttpUseCases` nor
 * `src/main/usecases.ts`: a logger, an audit line or a clock added to the others in `main` never
 * reached them, and a test could not hand the route a stub. A stub is the proof here: each route
 * answers with the code a stub invents, which no real use case could produce.
 */

const OWNER = '11111111-1111-4111-8111-111111111111'
const A_MODERATOR = '22222222-2222-4222-8222-222222222222'

const STUBBED = (name: string) => async () => err(DomainError.conflict(`test.${name}Stub`))

const ownerOfMariage = async (stubs: Partial<HttpUseCases>) => {
  const subject = buildServerHarness({
    usecases: { authenticateUser: signInByAddress({ 'host@example.test': OWNER }), ...stubs },
  })
  subject.users.seed(aUser({ id: OWNER, email: 'host@example.test' }))
  subject.events.seed(anEvent({ id: 'evt-1', slug: 'mariage', ownerId: OWNER, status: 'live' }))
  subject.memberships.seed({
    eventId: asEventId('evt-1'),
    userId: asUserId(OWNER),
    role: 'owner',
    grantedAt: AT,
  })
  return { subject, ...(await signedInAs(subject.app, 'host@example.test')) }
}

describe('the event routes that used to compose their own use case', () => {
  it('renames an event through the bag', async () => {
    const { agent, csrf } = await ownerOfMariage({ renameEvent: STUBBED('rename') })

    const response = await agent
      .patch('/api/events/mariage')
      .set(CSRF_HEADER, csrf)
      .send({ name: 'Autre nom' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('test.renameStub')
  })

  it('lists moderators through the bag', async () => {
    const { agent } = await ownerOfMariage({ listModerators: STUBBED('list') })

    const response = await agent.get('/api/events/mariage/moderators')

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('test.listStub')
  })

  it('revokes a moderator through the bag', async () => {
    const { agent, csrf } = await ownerOfMariage({ revokeModerator: STUBBED('revoke') })

    const response = await agent
      .delete(`/api/events/mariage/moderators/${A_MODERATOR}`)
      .set(CSRF_HEADER, csrf)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('test.revokeStub')
  })
})

/**
 * Every answer that carries an event takes what it holds and the limits it is under from one
 * use case (HTTP-M-06). Each route runs its own use case, which hands back an `Event`; what is
 * left (the counts, the limits) used to be fetched by two more use cases, one of them the host's
 * whole dashboard of which the handler kept a single row.
 *
 * A stub is the proof, as above: `getEventView` answers a count only it could invent, and every
 * other use case that is not named is not wired, so a handler that went back to the dashboard
 * listing or to the limits on its own would fail here with a 500.
 */
describe('the answers that carry an event', () => {
  const MARIAGE = anEvent({ id: 'evt-1', slug: 'mariage', ownerId: OWNER, status: 'live' })
  const VIEW = {
    event: MARIAGE,
    counts: { photoCount: 777, pendingCount: 7, guestCount: 77, usedBytes: 7_777 },
    limits: { quotaBytes: 4_242, liveWindowEnd: null },
  }
  const OWN_RESULT = async () => ok(MARIAGE)

  const ROUTES = [
    {
      name: 'creating',
      method: 'post',
      path: '/api/events',
      body: { name: 'Autre' },
      own: 'createEvent',
      status: 201,
    },
    {
      name: 'reading',
      method: 'get',
      path: '/api/events/mariage',
      body: undefined,
      own: 'getEventBySlug',
      status: 200,
    },
    {
      name: 'renaming',
      method: 'patch',
      path: '/api/events/mariage',
      body: { name: 'Autre nom' },
      own: 'renameEvent',
      status: 200,
    },
    {
      name: 'changing the settings',
      method: 'patch',
      path: '/api/events/mariage/settings',
      body: { allowCaptions: false },
      own: 'updateEventSettings',
      status: 200,
    },
    {
      name: 'opening or closing',
      method: 'post',
      path: '/api/events/mariage/status',
      body: { status: 'closed' },
      own: 'changeEventStatus',
      status: 200,
    },
    {
      name: 'scheduling',
      method: 'patch',
      path: '/api/events/mariage/schedule',
      body: { scheduledOpenAt: null, scheduledCloseAt: null },
      own: 'scheduleEvent',
      status: 200,
    },
    {
      name: 'rotating the join code',
      method: 'post',
      path: '/api/events/mariage/join-code',
      body: undefined,
      own: 'rotateJoinCode',
      status: 200,
    },
  ] as const

  it.each(ROUTES)(
    '$name an event answers with the counts and the quota of getEventView',
    async ({ method, path, body, own, status }) => {
      const { agent, csrf } = await ownerOfMariage({
        // The view is asked about the event the route's own use case handed back, not about
        // another one the handler had in scope.
        getEventView: async ({ event }) => {
          expect(event).toBe(MARIAGE)
          return VIEW
        },
        [own]: OWN_RESULT,
      })

      const request = agent[method](path)
      const response =
        method === 'get' ? await request : await request.set(CSRF_HEADER, csrf).send(body ?? {})

      expect(response.status, JSON.stringify(response.body)).toBe(status)
      expect(response.body).toMatchObject({
        photoCount: 777,
        pendingCount: 7,
        guestCount: 77,
        usedBytes: 7_777,
        quotaBytes: 4_242,
      })
    },
  )

  it('answers nothing of the view when the route’s own use case refused', async () => {
    const { agent, csrf } = await ownerOfMariage({
      getEventView: async () => {
        throw new Error('the view must not be read for a refusal')
      },
      renameEvent: STUBBED('rename'),
    })

    const response = await agent
      .patch('/api/events/mariage')
      .set(CSRF_HEADER, csrf)
      .send({ name: 'Autre nom' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('test.renameStub')
  })
})
