import { describe, expect, it } from 'vitest'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
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
