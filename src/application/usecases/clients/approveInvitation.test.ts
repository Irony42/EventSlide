import { beforeEach, describe, expect, it } from 'vitest'
import {
  asAccountTokenId,
  asClientId,
  asUserId,
  type AccountTokenId,
} from '../../../domain/shared/ids'
import { AT, anAccountToken, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import {
  CLIENT_ID,
  MEMBER_ID,
  NEWCOMER,
  NEW_CLIENT_ID,
  OPERATOR_ID,
  OWNER_2_ID,
  OWNER_ID,
  STRANGER_ID,
  makeOperatorGuardWorld,
  type OperatorGuardWorld,
} from '../../testing/operatorGuardWorld'
import { makeApproveInvitation } from './approveInvitation'

describe('approveInvitation', () => {
  let world: OperatorGuardWorld
  let invitationId: AccountTokenId
  let token: string

  const approve = (actorId: string, id: AccountTokenId = invitationId) =>
    world.useCases.approveInvitation({ actorId: asUserId(actorId), invitationId: id })

  /** What an operator's invitation into the client looks like once it is written and mailed. */
  beforeEach(async () => {
    world = makeOperatorGuardWorld({
      mailer: {
        canDeliver: false,
        send: async () => {
          throw new Error('no relay')
        },
      },
    })
    await world.seatTheClient()
    const invited = await world.useCases.inviteToClientAsOperator({
      actorId: asUserId(OPERATOR_ID),
      clientId: asClientId(CLIENT_ID),
      email: NEWCOMER,
      role: 'owner',
      locale: 'fr',
    })
    if (!invited.ok || invited.value.delivery !== 'link') throw new Error('fixture')
    invitationId = invited.value.invitationId
    token = invited.value.link.split('/').pop() ?? ''
  })

  const opens = async (): Promise<boolean> => (await world.useCases.previewInvitation({ token })).ok

  describe('an owner of the client', () => {
    it('makes the invitation usable, which is all approving does', async () => {
      expect(await opens()).toBe(false)

      const result = await approve(OWNER_ID)

      expect(result.ok).toBe(true)
      expect(await opens()).toBe(true)
    })

    it('records who approved and when, on the invitation', async () => {
      await approve(OWNER_ID)

      expect(await world.tokens.findById(invitationId)).toMatchObject({
        approvedBy: OWNER_ID,
        approvedAt: AT,
      })
    })

    it('neither spends the link nor makes the invitee an account: the invitee still has to accept', async () => {
      await approve(OWNER_ID)

      expect((await world.tokens.findById(invitationId))?.consumedAt).toBeNull()
      expect(
        await world.users.findByEmail((await world.tokens.findById(invitationId))!.email),
      ).toBeNull()
      expect(
        await world.clients.memberRole(asClientId(CLIENT_ID), asUserId(STRANGER_ID)),
      ).toBeNull()
    })

    it('lets any owner of the client approve, not only the first', async () => {
      expect((await approve(OWNER_2_ID)).ok).toBe(true)
    })

    it('writes one line saying the owner approved, which the client reads (R5)', async () => {
      await approve(OWNER_ID)

      const lines = (await world.logged()).filter((line) => line.action === 'invitation.approved')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({
        actor: { kind: 'member', userId: OWNER_ID },
        subject: { type: 'invitation', id: invitationId },
        clientId: CLIENT_ID,
        details: {},
      })
    })

    it('succeeds without a second line when it is approved again', async () => {
      await approve(OWNER_ID)
      const again = await approve(OWNER_2_ID)

      expect(again.ok).toBe(true)
      expect(
        (await world.logged()).filter((line) => line.action === 'invitation.approved'),
      ).toHaveLength(1)
      expect((await world.tokens.findById(invitationId))?.approvedBy).toBe(OWNER_ID)
    })
  })

  describe('who may not (R1: an approval is the client’s consent)', () => {
    it('refuses a member who is not an owner, in scope and not entitled', async () => {
      const result = await approve(MEMBER_ID)

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect(await opens()).toBe(false)
    })

    it('refuses an operator who is an owner of the client too: the consent is not theirs to give', async () => {
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId(OPERATOR_ID),
        role: 'owner',
        grantedAt: AT,
      })

      const result = await approve(OPERATOR_ID)

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect(await opens()).toBe(false)
      expect((await world.tokens.findById(invitationId))?.approvedAt).toBeNull()
    })

    it('answers an operator who is no part of the client as it answers a stranger', async () => {
      const operator = await approve(OPERATOR_ID)
      const stranger = await approve(STRANGER_ID)

      expect(!operator.ok && operator.error).toMatchObject({
        kind: 'notFound',
        code: 'invitation.notFound',
      })
      expect(!stranger.ok && stranger.error).toMatchObject({
        kind: 'notFound',
        code: 'invitation.notFound',
      })
    })

    it('answers an owner of another client as a stranger, so ids cannot be probed across clients', async () => {
      await world.clients.grantMember({
        clientId: asClientId(NEW_CLIENT_ID),
        userId: asUserId(STRANGER_ID),
        role: 'owner',
        grantedAt: AT,
      })

      const result = await approve(STRANGER_ID)

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
      expect(await opens()).toBe(false)
    })

    it('refuses an owner whose account has been switched off', async () => {
      const owner = await world.users.findById(asUserId(OWNER_ID))
      await world.users.save(owner!.disable(AT))

      const result = await approve(OWNER_ID)

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })

    it('refuses an account that does not exist', async () => {
      const result = await approve('nobody')

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })
  })

  describe('what is not an invitation waiting for an owner', () => {
    const notFound = (result: Awaited<ReturnType<typeof approve>>) =>
      !result.ok && result.error.code === 'invitation.notFound' && result.error.kind === 'notFound'

    it('is not found for an id nobody wrote', async () => {
      expect(notFound(await approve(OWNER_ID, asAccountTokenId('ghost')))).toBe(true)
    })

    it('is not found for an invitation that never waited for anyone', async () => {
      await world.tokens.save(
        anAccountToken({
          id: 'tok-free',
          purpose: 'invitation',
          userId: null,
          clientId: CLIENT_ID,
          clientRole: 'member',
          createdBy: OPERATOR_ID,
        }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-free')))).toBe(true)
    })

    it('is not found for an invitation to an event, which waits for nobody and is the event owner’s', async () => {
      await world.tokens.save(
        anAccountToken({
          id: 'tok-event',
          purpose: 'invitation',
          userId: null,
          eventId: 'event-wedding',
          eventRole: 'moderator',
          requiresApproval: true,
          createdBy: OWNER_ID,
        }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-event')))).toBe(true)
    })

    it('is not found for a password-reset request, which has its own approval', async () => {
      await world.tokens.save(
        anAccountToken({
          id: 'tok-reset',
          purpose: 'passwordReset',
          userId: MEMBER_ID,
          requiresApproval: true,
          createdBy: OPERATOR_ID,
        }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-reset')))).toBe(true)
    })

    it.each([
      ['spent', { consumedAt: AT }],
      ['revoked', { revokedAt: AT }],
      ['expired', { createdAt: atPlus(-8 * 24 * 60 * 60 * 1000) }],
    ] as const)('is not found for an invitation that is %s', async (_state, patch) => {
      await world.tokens.save(
        anAccountToken({
          id: 'tok-dead',
          purpose: 'invitation',
          userId: null,
          clientId: CLIENT_ID,
          clientRole: 'member',
          requiresApproval: true,
          createdBy: OPERATOR_ID,
          ...patch,
        }),
      )

      expect(notFound(await approve(OWNER_ID, asAccountTokenId('tok-dead')))).toBe(true)
    })
  })

  describe('the line comes first (R5)', () => {
    it('leaves the invitation unapproved when the log cannot take the line', async () => {
      const refusing = makeApproveInvitation({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        audit: new FakeAuditLog(),
        clock: world.clock,
      })

      await expect(refusing({ actorId: asUserId(OWNER_ID), invitationId })).rejects.toThrow(
        /FOREIGN KEY/,
      )

      expect((await world.tokens.findById(invitationId))?.approvedAt).toBeNull()
    })

    it('refuses, writing nothing, when the log would not name the invitation', async () => {
      await world.tokens.save(
        anAccountToken({
          id: 'not an id',
          purpose: 'invitation',
          userId: null,
          clientId: CLIENT_ID,
          clientRole: 'member',
          requiresApproval: true,
          createdBy: OPERATOR_ID,
        }),
      )

      const result = await approve(OWNER_ID, asAccountTokenId('not an id'))

      expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
      expect((await world.tokens.findById(asAccountTokenId('not an id')))?.approvedAt).toBeNull()
    })
  })

  describe('two approvals at once', () => {
    /** Somebody else's approval lands between the read and the write. */
    const racing = (rival: 'approves' | 'revokes') =>
      makeApproveInvitation({
        users: world.users,
        clients: world.clients,
        tokens: {
          findById: (id) => world.tokens.findById(id),
          approve: async (id, _by, now) => {
            if (rival === 'approves') await world.tokens.approve(id, asUserId(OWNER_2_ID), now)
            else
              await world.tokens.revokeOutstanding(
                (await world.tokens.findById(id))!.email,
                'invitation',
                now,
              )
            return false
          },
        },
        audit: world.audit,
        clock: world.clock,
      })

    it('succeeds for the loser when the winner approved it, since the invitation is now usable', async () => {
      const result = await racing('approves')({ actorId: asUserId(OWNER_ID), invitationId })

      expect(result.ok).toBe(true)
    })

    it('is not found for the loser when what beat them was a revocation', async () => {
      const result = await racing('revokes')({ actorId: asUserId(OWNER_ID), invitationId })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })
  })
})
