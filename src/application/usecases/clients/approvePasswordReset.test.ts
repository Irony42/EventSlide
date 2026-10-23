import { beforeEach, describe, expect, it } from 'vitest'
import { err } from '../../../domain/shared/result'
import {
  asAccountTokenId,
  asClientId,
  asUserId,
  type AccountTokenId,
} from '../../../domain/shared/ids'
import { mailFailure } from '../../ports/mailer'
import { AT, anAccountToken, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import {
  CLIENT_ID,
  MEMBER_ID,
  NEW_CLIENT_ID,
  OPERATOR_ID,
  OWNER_2_ID,
  OWNER_ID,
  STRANGER_ID,
  makeOperatorGuardWorld,
  type OperatorGuardWorld,
} from '../../testing/operatorGuardWorld'
import { makeApprovePasswordReset } from './approvePasswordReset'

describe('approvePasswordReset', () => {
  let world: OperatorGuardWorld

  /** An operator's request for a link to reset `userId`, as it stands before any owner has seen it. */
  const requestFor = async (userId: string): Promise<AccountTokenId> => {
    const asked = await world.useCases.issuePasswordResetForAccount({
      actorId: asUserId(OPERATOR_ID),
      userId: asUserId(userId),
      locale: 'fr',
    })
    if (!asked.ok || asked.value.delivery !== 'pendingApproval') throw new Error('fixture')
    return asked.value.approvalId
  }

  const approve = (actorId: string, requestId: AccountTokenId) =>
    world.useCases.approvePasswordReset({ actorId: asUserId(actorId), requestId })

  const redeem = (userId: string, approvalId: AccountTokenId) =>
    world.useCases.issuePasswordResetForAccount({
      actorId: asUserId(OPERATOR_ID),
      userId: asUserId(userId),
      locale: 'fr',
      approvalId,
    })

  beforeEach(async () => {
    world = makeOperatorGuardWorld({
      mailer: { canDeliver: false, send: async () => err(mailFailure('notConfigured')) },
      mode: 'copyLinkWithOwnerApproval',
    })
    await world.seatTheClient()
  })

  describe('another owner of the account’s client (R2)', () => {
    it('lets the operator be handed a link, once, which is all approving does', async () => {
      const requestId = await requestFor(MEMBER_ID)
      expect((await redeem(MEMBER_ID, requestId)).ok).toBe(false)

      expect((await approve(OWNER_ID, requestId)).ok).toBe(true)

      const handed = await redeem(MEMBER_ID, requestId)
      expect(handed.ok && handed.value.delivery).toBe('link')
    })

    it('hands the owner nothing: approving is not receiving a link, and changes no password', async () => {
      const requestId = await requestFor(MEMBER_ID)
      const member = await world.users.findById(asUserId(MEMBER_ID))

      const result = await approve(OWNER_ID, requestId)

      expect(result).toEqual({ ok: true, value: undefined })
      expect(await world.users.findById(asUserId(MEMBER_ID))).toEqual(member)
      expect((await world.tokens.findById(requestId))?.consumedAt).toBeNull()
    })

    it('records who approved and when', async () => {
      const requestId = await requestFor(MEMBER_ID)

      await approve(OWNER_2_ID, requestId)

      expect(await world.tokens.findById(requestId)).toMatchObject({
        approvedBy: OWNER_2_ID,
        approvedAt: AT,
      })
    })

    it('writes one line saying the owner approved, in the client’s log (R5)', async () => {
      const requestId = await requestFor(MEMBER_ID)

      await approve(OWNER_ID, requestId)

      const lines = (await world.logged()).filter((line) => line.action === 'account.resetApproved')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({
        actor: { kind: 'member', userId: OWNER_ID },
        subject: { type: 'account', id: MEMBER_ID },
        clientId: CLIENT_ID,
        details: {},
      })
    })

    it('succeeds without a second line when it is approved again', async () => {
      const requestId = await requestFor(MEMBER_ID)
      await approve(OWNER_ID, requestId)

      const again = await approve(OWNER_2_ID, requestId)

      expect(again.ok).toBe(true)
      expect(
        (await world.logged()).filter((line) => line.action === 'account.resetApproved'),
      ).toHaveLength(1)
    })

    it('approves a request for another owner of the client', async () => {
      const requestId = await requestFor(OWNER_2_ID)

      expect((await approve(OWNER_ID, requestId)).ok).toBe(true)
    })
  })

  describe('who may not', () => {
    it('refuses the account itself: nobody approves their own reset', async () => {
      const requestId = await requestFor(OWNER_2_ID)

      const result = await approve(OWNER_2_ID, requestId)

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect((await world.tokens.findById(requestId))?.approvedAt).toBeNull()
    })

    it('refuses a member who is not an owner', async () => {
      const requestId = await requestFor(OWNER_2_ID)

      const result = await approve(MEMBER_ID, requestId)

      expect(!result.ok && result.error.kind).toBe('forbidden')
    })

    it('refuses an operator even when the client made them an owner', async () => {
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId(OPERATOR_ID),
        role: 'owner',
        grantedAt: AT,
      })
      const requestId = await requestFor(MEMBER_ID)

      const result = await approve(OPERATOR_ID, requestId)

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect((await world.tokens.findById(requestId))?.approvedAt).toBeNull()
    })

    it('answers an operator and a stranger alike, as a request that does not exist', async () => {
      const requestId = await requestFor(MEMBER_ID)

      for (const actor of [OPERATOR_ID, STRANGER_ID]) {
        const result = await approve(actor, requestId)
        expect(!result.ok && result.error, actor).toMatchObject({
          kind: 'notFound',
          code: 'reset.requestNotFound',
        })
      }
    })

    it('answers an owner of another client as a stranger', async () => {
      await world.clients.grantMember({
        clientId: asClientId(NEW_CLIENT_ID),
        userId: asUserId(STRANGER_ID),
        role: 'owner',
        grantedAt: AT,
      })
      const requestId = await requestFor(MEMBER_ID)

      const result = await approve(STRANGER_ID, requestId)

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })

    it('refuses an owner whose account has been switched off', async () => {
      const requestId = await requestFor(MEMBER_ID)
      const owner = await world.users.findById(asUserId(OWNER_ID))
      await world.users.save(owner!.disable(AT))

      const result = await approve(OWNER_ID, requestId)

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })

    it('refuses once the account has left the client, whose consent is then nobody’s', async () => {
      const requestId = await requestFor(MEMBER_ID)
      await world.clients.revokeMember(asClientId(CLIENT_ID), asUserId(MEMBER_ID))

      const result = await approve(OWNER_ID, requestId)

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })

    it('refuses once the account has joined a second client, whose consent would be two', async () => {
      const requestId = await requestFor(MEMBER_ID)
      await world.clients.grantMember({
        clientId: asClientId(NEW_CLIENT_ID),
        userId: asUserId(MEMBER_ID),
        role: 'member',
        grantedAt: AT,
      })

      const result = await approve(OWNER_ID, requestId)

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })
  })

  describe('what is not a request waiting for an owner', () => {
    const notFound = (result: Awaited<ReturnType<typeof approve>>) =>
      !result.ok &&
      result.error.code === 'reset.requestNotFound' &&
      result.error.kind === 'notFound'

    it('is not found for an id nobody wrote', async () => {
      expect(notFound(await approve(OWNER_ID, asAccountTokenId('ghost')))).toBe(true)
    })

    it('is not found for a reset link that never waited for anyone', async () => {
      await world.tokens.save(
        anAccountToken({ id: 'tok-free', userId: MEMBER_ID, createdBy: OPERATOR_ID }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-free')))).toBe(true)
    })

    it('is not found for an invitation, which has its own approval', async () => {
      await world.tokens.save(
        anAccountToken({
          id: 'tok-invite',
          purpose: 'invitation',
          userId: null,
          clientId: CLIENT_ID,
          clientRole: 'member',
          requiresApproval: true,
          createdBy: OPERATOR_ID,
        }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-invite')))).toBe(true)
    })

    it.each([
      ['spent', { consumedAt: AT }],
      ['revoked', { revokedAt: AT }],
      ['expired', { createdAt: atPlus(-2 * 60 * 60 * 1000) }],
    ] as const)('is not found for a request that is %s', async (_state, patch) => {
      await world.tokens.save(
        anAccountToken({
          id: 'tok-dead',
          userId: MEMBER_ID,
          requiresApproval: true,
          createdBy: OPERATOR_ID,
          ...patch,
        }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-dead')))).toBe(true)
    })
  })

  describe('the line comes first (R5)', () => {
    it('leaves the request unapproved when the log cannot take the line', async () => {
      const requestId = await requestFor(MEMBER_ID)
      const refusing = makeApprovePasswordReset({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        audit: new FakeAuditLog(),
        clock: world.clock,
      })

      await expect(refusing({ actorId: asUserId(OWNER_ID), requestId })).rejects.toThrow(
        /FOREIGN KEY/,
      )

      expect((await world.tokens.findById(requestId))?.approvedAt).toBeNull()
    })

    it('refuses, writing nothing, when the log would not name the account', async () => {
      // An account whose id the log's own rules refuse: a space is not in the alphabet of an id.
      world.tokens.withAccounts(asUserId('not an id'))
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId('not an id'),
        role: 'member',
        grantedAt: AT,
      })
      await world.tokens.save(
        anAccountToken({
          id: 'tok-odd',
          userId: 'not an id',
          requiresApproval: true,
          createdBy: OPERATOR_ID,
        }),
      )

      const result = await approve(OWNER_ID, asAccountTokenId('tok-odd'))

      expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
      expect((await world.tokens.findById(asAccountTokenId('tok-odd')))?.approvedAt).toBeNull()
    })
  })

  describe('two approvals at once', () => {
    const racing = (rival: 'approves' | 'revokes') =>
      makeApprovePasswordReset({
        users: world.users,
        clients: world.clients,
        tokens: {
          findById: (id) => world.tokens.findById(id),
          approve: async (id, _by, now) => {
            if (rival === 'approves') await world.tokens.approve(id, asUserId(OWNER_2_ID), now)
            else {
              const row = await world.tokens.findById(id)
              await world.tokens.revokeOutstanding(row!.email, 'passwordReset', now)
            }
            return false
          },
        },
        audit: world.audit,
        clock: world.clock,
      })

    it('succeeds for the loser when the winner approved it', async () => {
      const requestId = await requestFor(MEMBER_ID)

      expect((await racing('approves')({ actorId: asUserId(OWNER_ID), requestId })).ok).toBe(true)
    })

    it('is not found for the loser when what beat them was a revocation', async () => {
      const requestId = await requestFor(MEMBER_ID)

      const result = await racing('revokes')({ actorId: asUserId(OWNER_ID), requestId })

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })
  })
})
