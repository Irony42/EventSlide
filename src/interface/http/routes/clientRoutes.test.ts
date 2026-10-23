import { beforeEach, describe, expect, it } from 'vitest'
import type request from 'supertest'
import type { ApproveInvitation } from '../../../application/usecases/clients/approveInvitation'
import { makeApproveInvitation } from '../../../application/usecases/clients/approveInvitation'
import { AT, aClient, aUser, anAccountToken } from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { asAccountTokenId, asClientId, asUserId } from '../../../domain/shared/ids'
import { CSRF_HEADER } from '../middleware/csrf'
import {
  A_PATH_NOBODY_WROTE,
  anonymousCaller,
  signedInAs,
  signInByAddress,
} from '../testing/signIn'
import { buildServerHarness, type ServerHarness } from '../testing/serverHarness'

/**
 * `POST /api/client/invitations/:invitationId/approve`: the owner's half of R1 of the
 * operator guard (free plan G2-12, paid plan P3-14), through the assembled server and the real
 * use case over the in-memory fakes.
 *
 * The rule itself (who may approve, what is written) is held at ring 2 in
 * `approveInvitation.test.ts` and `operatorGuard.test.ts`. What is held **here** is what only
 * the wire can break: that the route needs a session, that the actor is the session's and
 * nobody else's, that each refusal reaches the caller with its own status, and that the route
 * does not exist at all on a box without `SITE_ADMIN=on`.
 */

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const STRANGER = '44444444-4444-4444-8444-444444444444'
const OPERATOR_OWNER = '55555555-5555-4555-8555-555555555555'
const CLIENT = 'client-1'
const INVITATION = '66666666-6666-4666-8666-666666666666'

const ACCOUNTS: Readonly<Record<string, string>> = {
  'ops@example.test': OPERATOR,
  'proprio@example.test': OWNER,
  'membre@example.test': MEMBER,
  'inconnu@example.test': STRANGER,
  'ops-proprio@example.test': OPERATOR_OWNER,
}

const approvePath = (id: string): string => `/api/client/invitations/${id}/approve`

describe('POST /api/client/invitations/:invitationId/approve', () => {
  let subject: ServerHarness
  let tokens: FakeAccountTokenRepository
  let audit: FakeAuditLog

  const build = async (siteAdmin: boolean): Promise<void> => {
    tokens = new FakeAccountTokenRepository()
      .withAccounts(
        asUserId(OPERATOR),
        asUserId(OWNER),
        asUserId(MEMBER),
        asUserId(STRANGER),
        asUserId(OPERATOR_OWNER),
      )
      .withClients(asClientId(CLIENT))
    audit = new FakeAuditLog().withAccounts(
      asUserId(OPERATOR),
      asUserId(OWNER),
      asUserId(MEMBER),
      asUserId(STRANGER),
      asUserId(OPERATOR_OWNER),
    )

    // The use case is built over the harness's own accounts and clients, which exist only once
    // the harness does, so the route is handed a function that reads the real one when called.
    let approve: ApproveInvitation = async () => {
      throw new Error('the harness was not built yet')
    }
    subject = buildServerHarness({
      config: { siteAdmin },
      usecases: {
        authenticateUser: signInByAddress(ACCOUNTS),
        approveInvitation: (input) => approve(input),
      },
    })
    approve = makeApproveInvitation({
      users: subject.users,
      clients: subject.clients,
      tokens,
      audit,
      clock: subject.clock,
    })

    subject.users.seed(
      aUser({ id: OPERATOR, email: 'ops@example.test', siteRole: 'operator' }),
      aUser({ id: OWNER, email: 'proprio@example.test' }),
      aUser({ id: MEMBER, email: 'membre@example.test' }),
      aUser({ id: STRANGER, email: 'inconnu@example.test' }),
      aUser({ id: OPERATOR_OWNER, email: 'ops-proprio@example.test', siteRole: 'operator' }),
    )
    subject.clients.seed(aClient({ id: CLIENT }))
    await subject.clients.grantMember({
      clientId: asClientId(CLIENT),
      userId: asUserId(OWNER),
      role: 'owner',
      grantedAt: AT,
    })
    await subject.clients.grantMember({
      clientId: asClientId(CLIENT),
      userId: asUserId(MEMBER),
      role: 'member',
      grantedAt: AT,
    })
    await subject.clients.grantMember({
      clientId: asClientId(CLIENT),
      userId: asUserId(OPERATOR_OWNER),
      role: 'owner',
      grantedAt: AT,
    })
    await tokens.save(
      anAccountToken({
        id: INVITATION,
        purpose: 'invitation',
        userId: null,
        email: 'nouveau@example.test',
        clientId: CLIENT,
        clientRole: 'owner',
        requiresApproval: true,
        createdBy: OPERATOR,
      }),
    )
  }

  const post = async (
    email: string,
    id: string = INVITATION,
    body: object = {},
  ): Promise<request.Response> => {
    const { agent, csrf } = await signedInAs(subject.app, email)
    return agent.post(approvePath(id)).set(CSRF_HEADER, csrf).send(body)
  }

  const approvedAt = async () => (await tokens.findById(asAccountTokenId(INVITATION)))?.approvedAt

  describe('with SITE_ADMIN=on', () => {
    beforeEach(async () => {
      await build(true)
    })

    it('lets an owner of the client approve the invitation, answering 204 and nothing else', async () => {
      const response = await post('proprio@example.test')

      expect(response.status).toBe(204)
      expect(response.text).toBe('')
      expect(await approvedAt()).toEqual(AT)
    })

    it('writes the line the client reads, with the signed-in owner as its actor', async () => {
      await post('proprio@example.test')

      const [line] = (await audit.list({ limit: 10 })).items
      expect(line).toMatchObject({
        action: 'invitation.approved',
        actor: { kind: 'member', userId: OWNER },
        subject: { type: 'invitation', id: INVITATION },
        clientId: CLIENT,
      })
    })

    it('takes the actor from the session and nowhere in the request', async () => {
      // A member who names the owner in the body is still the member, and is refused.
      const response = await post('membre@example.test', INVITATION, {
        actorId: OWNER,
        userId: OWNER,
      })

      expect(response.status).toBe(403)
      expect(await approvedAt()).toBeNull()
    })

    it('answers 401 to a caller with no session, and approves nothing', async () => {
      const { agent, csrf } = await anonymousCaller(subject.app)

      const response = await agent.post(approvePath(INVITATION)).set(CSRF_HEADER, csrf).send({})

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('auth.required')
      expect(await approvedAt()).toBeNull()
    })

    it('answers 403 to a member of the client who is not an owner', async () => {
      const response = await post('membre@example.test')

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('auth.forbidden')
      expect(await approvedAt()).toBeNull()
    })

    it('answers 403 to an operator, even one the client made an owner', async () => {
      const response = await post('ops-proprio@example.test')

      expect(response.status).toBe(403)
      expect(await approvedAt()).toBeNull()
    })

    it('answers an operator who is no part of the client, and a stranger, with the 404 of an invitation that does not exist', async () => {
      const operator = await post('ops@example.test')
      const stranger = await post('inconnu@example.test')
      const unknown = await post('proprio@example.test', '77777777-7777-4777-8777-777777777777')

      for (const response of [operator, stranger, unknown]) {
        expect(response.status).toBe(404)
        expect(response.body.error.code).toBe('invitation.notFound')
      }
      expect(operator.body).toEqual(unknown.body)
      expect(await approvedAt()).toBeNull()
    })

    it('answers 400 to an id that is not one, before any storage is asked', async () => {
      const response = await post('proprio@example.test', 'not-an-id')

      expect(response.status).toBe(400)
    })

    it('answers 204 again when it is approved a second time, and writes nothing more', async () => {
      await post('proprio@example.test')

      const again = await post('proprio@example.test')

      expect(again.status).toBe(204)
      expect((await audit.list({ limit: 10 })).items).toHaveLength(1)
    })

    it('is refused by the CSRF gate without its token, like every unsafe request', async () => {
      const { agent } = await signedInAs(subject.app, 'proprio@example.test')

      const response = await agent.post(approvePath(INVITATION)).send({})

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('request.csrfMissing')
      expect(await approvedAt()).toBeNull()
    })
  })

  describe('with SITE_ADMIN=off', () => {
    beforeEach(async () => {
      await build(false)
    })

    it('does not exist: it answers as a path nobody wrote, even to the owner it would have served', async () => {
      const { agent, csrf } = await signedInAs(subject.app, 'proprio@example.test')

      const response = await agent.post(approvePath(INVITATION)).set(CSRF_HEADER, csrf).send({})
      const unknown = await agent.post(A_PATH_NOBODY_WROTE).set(CSRF_HEADER, csrf).send({})

      expect(response.status).toBe(404)
      expect(response.body).toEqual(unknown.body)
      expect(response.body.error.code).toBe('route.notFound')
      expect(await approvedAt()).toBeNull()
    })
  })
})
