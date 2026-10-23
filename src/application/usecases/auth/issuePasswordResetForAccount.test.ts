import { beforeEach, describe, expect, it } from 'vitest'
import { err } from '../../../domain/shared/result'
import {
  asAccountTokenId,
  asClientId,
  asUserId,
  type AccountTokenId,
} from '../../../domain/shared/ids'
import { PASSWORD_RESET_MAX_REQUESTS_PER_HOUR } from '../../../domain/users/accountToken'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { AT, aUser } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import type { FakeMailer } from '../../testing/fakeMailer'
import {
  CLIENT_ID,
  MEMBER_ID,
  NEW_CLIENT_ID,
  OPERATOR_ID,
  OWNER_2_ID,
  OWNER_ID,
  PUBLIC_URL,
  STRANGER_ID,
  silentLogger,
  makeOperatorGuardWorld,
  type OperatorGuardWorld,
  type OperatorGuardWorldOptions,
} from '../../testing/operatorGuardWorld'
import { makeIssuePasswordResetForAccount } from './issuePasswordResetForAccount'

/** A box with no mail relay: the production `NullMailer`'s answer, written out. */
const noRelay: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

const HOUR = 60 * 60 * 1000

describe('issuePasswordResetForAccount', () => {
  let world: OperatorGuardWorld

  const build = async (options: OperatorGuardWorldOptions = {}): Promise<void> => {
    world = makeOperatorGuardWorld(options)
    await world.seatTheClient()
  }

  const reset = (userId: string, extra: { actorId?: string; approvalId?: AccountTokenId } = {}) =>
    world.useCases.issuePasswordResetForAccount({
      actorId: asUserId(extra.actorId ?? OPERATOR_ID),
      userId: asUserId(userId),
      locale: 'fr',
      ...(extra.approvalId === undefined ? {} : { approvalId: extra.approvalId }),
    })

  const sent = (): FakeMailer => world.mailer as FakeMailer
  const mailedToken = (): string =>
    /\/password\/reset\/([^\s/]+)/.exec(sent().sent.at(-1)?.text ?? '')?.[1] ?? ''

  describe('on a box that can mail, in either mode (R2)', () => {
    describe.each(['mailOnly', 'copyLinkWithOwnerApproval'] as const)('with %s', (mode) => {
      beforeEach(async () => {
        await build({ mode })
      })

      it('mails the link to the address on record and answers that it did, nothing more', async () => {
        const result = await reset(MEMBER_ID)

        expect(result).toEqual({
          ok: true,
          value: { delivery: 'mail', expiresAt: new Date(AT.getTime() + HOUR) },
        })
        expect(sent().sent).toHaveLength(1)
        expect(sent().sent[0]?.to).toBe('membre@example.test')
      })

      it('never lets the answer carry the token, the link or the address, which only the mail holds', async () => {
        const result = await reset(MEMBER_ID)

        const answered = JSON.stringify(result)
        expect(mailedToken()).not.toBe('')
        expect(answered).not.toContain(mailedToken())
        expect(answered).not.toContain('/password/reset/')
        expect(answered).not.toContain('example.test')
        expect(Object.keys(result.ok ? result.value : {}).sort()).toEqual(['delivery', 'expiresAt'])
      })

      it('issues a link that really resets the password, so the mail is the whole of what the account holder needs', async () => {
        await reset(MEMBER_ID)

        const used = await world.useCases.resetPassword({
          token: mailedToken(),
          newPassword: 'un nouveau mot de passe bien long',
        })

        expect(used.ok).toBe(true)
      })

      it('writes the operator as its author and records that it travelled by mail', async () => {
        await reset(MEMBER_ID)

        expect(world.tokens.all).toHaveLength(1)
        expect(world.tokens.all[0]).toMatchObject({
          purpose: 'passwordReset',
          userId: MEMBER_ID,
          delivery: 'mail',
          createdBy: OPERATOR_ID,
          requiresApproval: false,
        })
      })

      it('leaves one live link, the new one, as the self-service reset does', async () => {
        await reset(MEMBER_ID)
        const first = mailedToken()
        await reset(MEMBER_ID)

        const old = await world.useCases.resetPassword({
          token: first,
          newPassword: 'un nouveau mot de passe bien long',
        })

        expect(old.ok).toBe(false)
        expect(
          (
            await world.useCases.resetPassword({
              token: mailedToken(),
              newPassword: 'un nouveau mot de passe bien long',
            })
          ).ok,
        ).toBe(true)
      })

      it('writes one line, naming the account, that says no link was shown (R5)', async () => {
        await reset(MEMBER_ID)

        const lines = await world.logged()
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatchObject({
          action: 'account.resetIssued',
          actor: { kind: 'operator', userId: OPERATOR_ID },
          subject: { type: 'account', id: MEMBER_ID },
          clientId: CLIENT_ID,
          details: { linkShown: false },
        })
      })

      it('writes a line in each client the account belongs to, so each owner reads it in their own log', async () => {
        await world.clients.grantMember({
          clientId: asClientId(NEW_CLIENT_ID),
          userId: asUserId(MEMBER_ID),
          role: 'member',
          grantedAt: AT,
        })

        await reset(MEMBER_ID)

        expect((await world.logged()).map((line) => line.clientId).sort()).toEqual(
          [CLIENT_ID, NEW_CLIENT_ID].sort(),
        )
      })

      it('writes one line with no client for an account that belongs to none', async () => {
        await reset(STRANGER_ID)

        const lines = await world.logged()
        expect(lines).toHaveLength(1)
        expect(lines[0]?.clientId).toBeNull()
      })

      it('holds neither the token nor the link nor the address in the line', async () => {
        await reset(MEMBER_ID)

        const written = JSON.stringify(await world.logged())
        expect(written).not.toContain(mailedToken())
        expect(written).not.toContain('example.test')
      })

      it('is held to the hourly cap on one inbox, whoever asked', async () => {
        for (let count = 0; count < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR; count += 1) {
          expect((await reset(MEMBER_ID)).ok).toBe(true)
        }

        const over = await reset(MEMBER_ID)

        expect(!over.ok && over.error.kind).toBe('rateLimited')
        expect(sent().sent).toHaveLength(PASSWORD_RESET_MAX_REQUESTS_PER_HOUR)
      })

      it('says so when the relay refuses, and shows no link instead', async () => {
        sent().failNextWith('rejected')

        const result = await reset(MEMBER_ID)

        expect(!result.ok && result.error.code).toBe('reset.mailNotSent')
        expect(JSON.stringify(result)).not.toContain('/password/reset/')
      })
    })
  })

  describe('on a box with no relay, under mailOnly, the default (R2)', () => {
    beforeEach(async () => {
      await build({ mailer: noRelay, mode: 'mailOnly' })
    })

    it('issues nothing and says a mailer is required, rather than hand anybody a link', async () => {
      const result = await reset(MEMBER_ID)

      expect(!result.ok && result.error).toMatchObject({
        kind: 'conflict',
        code: 'reset.mailerRequired',
      })
      expect(world.tokens.all).toHaveLength(0)
      expect(await world.logged()).toHaveLength(0)
    })

    it('does not change its answer because the operator names an approval', async () => {
      const result = await reset(MEMBER_ID, { approvalId: asAccountTokenId('anything') })

      expect(!result.ok).toBe(true)
      expect(world.tokens.all).toHaveLength(0)
    })

    it('is what a box that never set OPERATOR_RESET_LINKS does', async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay })
      await world.seatTheClient()

      const result = await reset(MEMBER_ID)

      expect(!result.ok && result.error.code).toBe('reset.mailerRequired')
    })
  })

  describe('on a box with no relay, under copyLinkWithOwnerApproval, the opt-in (R2)', () => {
    beforeEach(async () => {
      await build({ mailer: noRelay, mode: 'copyLinkWithOwnerApproval' })
    })

    const request = async (userId = MEMBER_ID): Promise<AccountTokenId> => {
      const result = await reset(userId)
      if (!result.ok || result.value.delivery !== 'pendingApproval') throw new Error('fixture')
      return result.value.approvalId
    }

    const approvedRequest = async (userId = MEMBER_ID): Promise<AccountTokenId> => {
      const requestId = await request(userId)
      const approved = await world.useCases.approvePasswordReset({
        actorId: asUserId(OWNER_ID),
        requestId,
      })
      if (!approved.ok) throw new Error('fixture')
      return requestId
    }

    it('answers that the request waits for an owner, with an id and no link', async () => {
      const result = await reset(MEMBER_ID)

      expect(result.ok && result.value).toMatchObject({ delivery: 'pendingApproval' })
      expect(Object.keys(result.ok ? result.value : {}).sort()).toEqual([
        'approvalId',
        'delivery',
        'expiresAt',
      ])
      expect(JSON.stringify(result)).not.toContain('/password/reset/')
    })

    it('keeps the secret minted for the request to itself: it is in no answer and no line', async () => {
      const result = await reset(MEMBER_ID)
      // The first secret this world mints is the request's own, and it is dropped: the row is
      // there so that an owner has something to approve, and nobody holds a way to spend it.
      const minted = 'secret-1'

      expect(JSON.stringify(result)).not.toContain(minted)
      expect(JSON.stringify(await world.logged())).not.toContain(minted)
    })

    it('records the request as the operator’s, waiting, and shown to nobody', async () => {
      const requestId = await request()

      expect(await world.tokens.findById(requestId)).toMatchObject({
        purpose: 'passwordReset',
        userId: MEMBER_ID,
        createdBy: OPERATOR_ID,
        requiresApproval: true,
        approvedAt: null,
        consumedAt: null,
      })
    })

    it('writes a line saying the operator asked, in the client of the account (R5)', async () => {
      await request()

      expect(await world.logged()).toMatchObject([
        {
          action: 'account.resetRequested',
          actor: { kind: 'operator', userId: OPERATOR_ID },
          subject: { type: 'account', id: MEMBER_ID },
          clientId: CLIENT_ID,
          details: {},
        },
      ])
    })

    it('refuses to redeem a request that no owner has approved', async () => {
      const requestId = await request()

      const result = await reset(MEMBER_ID, { approvalId: requestId })

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
      expect(world.tokens.all).toHaveLength(1)
    })

    it('hands the operator a link only once another owner approved, and the link works', async () => {
      const requestId = await approvedRequest()

      const result = await reset(MEMBER_ID, { approvalId: requestId })

      expect(result.ok && result.value.delivery).toBe('link')
      const link = result.ok && result.value.delivery === 'link' ? result.value.link : ''
      expect(link.startsWith(`${PUBLIC_URL}/password/reset/`)).toBe(true)
      const used = await world.useCases.resetPassword({
        token: link.split('/').pop() ?? '',
        newPassword: 'un nouveau mot de passe bien long',
      })
      expect(used.ok).toBe(true)
    })

    it('writes a line saying a link was shown, which the owner reads (R5)', async () => {
      const requestId = await approvedRequest()
      await reset(MEMBER_ID, { approvalId: requestId })

      const issued = (await world.logged()).find((line) => line.action === 'account.resetIssued')
      expect(issued).toMatchObject({
        actor: { kind: 'operator', userId: OPERATOR_ID },
        subject: { type: 'account', id: MEMBER_ID },
        clientId: CLIENT_ID,
        details: { linkShown: true },
      })
    })

    it('spends the request: one approval is one link', async () => {
      const requestId = await approvedRequest()
      await reset(MEMBER_ID, { approvalId: requestId })

      const again = await reset(MEMBER_ID, { approvalId: requestId })

      expect(!again.ok && again.error.code).toBe('reset.requestNotFound')
      expect((await world.tokens.findById(requestId))?.consumedAt).toEqual(AT)
    })

    it('does not count the redemption against the cap a second time', async () => {
      const requestId = await approvedRequest()
      await request()
      await request()

      const result = await reset(MEMBER_ID, { approvalId: requestId })

      expect(result.ok && result.value.delivery).toBe('link')
    })

    it('binds the request to the operator who made it', async () => {
      const requestId = await approvedRequest()
      world.users.seed(
        aUser({ id: 'user-operator-2', email: 'autre-op@example.test', siteRole: 'operator' }),
      )

      const result = await reset(MEMBER_ID, { actorId: 'user-operator-2', approvalId: requestId })

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })

    it('binds the request to the account it was for', async () => {
      const requestId = await approvedRequest(MEMBER_ID)

      const result = await reset(OWNER_2_ID, { approvalId: requestId })

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })

    it('does not redeem a request that is not a request: an unknown id, a spent link, an invitation', async () => {
      const unknown = await reset(MEMBER_ID, { approvalId: asAccountTokenId('ghost') })
      expect(!unknown.ok && unknown.error.code).toBe('reset.requestNotFound')

      const invited = await world.useCases.inviteToClientAsOperator({
        actorId: asUserId(OPERATOR_ID),
        clientId: asClientId(CLIENT_ID),
        email: 'quelquun@example.test',
        role: 'member',
        locale: 'fr',
      })
      const invitation = invited.ok ? invited.value.invitationId : asAccountTokenId('x')
      const wrong = await reset(MEMBER_ID, { approvalId: invitation })
      expect(!wrong.ok && wrong.error.code).toBe('reset.requestNotFound')
    })

    it('does not redeem a request that has expired', async () => {
      const requestId = await approvedRequest()
      world.clock.advance(HOUR)

      const result = await reset(MEMBER_ID, { approvalId: requestId })

      expect(!result.ok && result.error.code).toBe('reset.requestNotFound')
    })

    it('has no approver for an account that belongs to no client, and says so', async () => {
      const result = await reset(STRANGER_ID)

      expect(!result.ok && result.error.code).toBe('reset.approverUnavailable')
      expect(world.tokens.all).toHaveLength(0)
    })

    it('has none for an account in two clients, whose consent would be two', async () => {
      await world.clients.grantMember({
        clientId: asClientId(NEW_CLIENT_ID),
        userId: asUserId(MEMBER_ID),
        role: 'member',
        grantedAt: AT,
      })

      const result = await reset(MEMBER_ID)

      expect(!result.ok && result.error.code).toBe('reset.approverUnavailable')
    })

    it('mails instead of showing anything the moment the box can mail', async () => {
      await build({ mode: 'copyLinkWithOwnerApproval' })

      const result = await reset(MEMBER_ID)

      expect(result.ok && result.value.delivery).toBe('mail')
    })

    it('is held to the cap on requests too, so a request cannot be repeated to spam an inbox of nothing', async () => {
      for (let count = 0; count < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR; count += 1) {
        await request()
      }

      const over = await reset(MEMBER_ID)

      expect(!over.ok && over.error.kind).toBe('rateLimited')
    })
  })

  describe('who may ask, and for whom', () => {
    beforeEach(async () => {
      await build()
    })

    it('refuses an account that does not operate the box, owners and members of the client included', async () => {
      for (const actor of [OWNER_ID, OWNER_2_ID, MEMBER_ID, STRANGER_ID]) {
        const result = await reset(MEMBER_ID, { actorId: actor })
        expect(!result.ok && result.error.code, actor).toBe('auth.forbidden')
      }
      expect(world.tokens.all).toHaveLength(0)
      expect(sent().sent).toHaveLength(0)
    })

    it('refuses an operator whose account is switched off, which holds no authority', async () => {
      const operator = await world.users.findById(asUserId(OPERATOR_ID))
      await world.users.save(operator!.disable(AT))

      const result = await reset(MEMBER_ID)

      expect(!result.ok && result.error.code).toBe('auth.forbidden')
    })

    it('refuses an account that does not exist', async () => {
      const result = await reset('nobody')

      expect(!result.ok && result.error.code).toBe('user.notFound')
    })

    it('refuses a disabled account, whose new password would open nothing', async () => {
      const member = await world.users.findById(asUserId(MEMBER_ID))
      await world.users.save(member!.disable(AT))

      const result = await reset(MEMBER_ID)

      expect(!result.ok && result.error.code).toBe('account.disabled')
      expect(sent().sent).toHaveLength(0)
    })
  })

  describe('the line comes first (R5)', () => {
    it('sends no mail and saves no link when the log cannot take the line', async () => {
      await build()
      const refusing = makeIssuePasswordResetForAccount({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        secrets: world.secrets,
        mailer: world.mailer,
        ids: world.ids,
        clock: world.clock,
        logger: silentLogger,
        publicUrl: PUBLIC_URL,
        mode: 'mailOnly',
        audit: new FakeAuditLog(),
      })

      await expect(
        refusing({ actorId: asUserId(OPERATOR_ID), userId: asUserId(MEMBER_ID), locale: 'fr' }),
      ).rejects.toThrow(/FOREIGN KEY/)

      expect(sent().sent).toHaveLength(0)
      expect(world.tokens.all).toHaveLength(0)
    })

    it('writes no request when the log cannot take the line', async () => {
      await build({ mailer: noRelay, mode: 'copyLinkWithOwnerApproval' })
      const refusing = makeIssuePasswordResetForAccount({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        secrets: world.secrets,
        mailer: noRelay,
        ids: world.ids,
        clock: world.clock,
        logger: silentLogger,
        publicUrl: PUBLIC_URL,
        mode: 'copyLinkWithOwnerApproval',
        audit: new FakeAuditLog(),
      })

      await expect(
        refusing({ actorId: asUserId(OPERATOR_ID), userId: asUserId(MEMBER_ID), locale: 'fr' }),
      ).rejects.toThrow(/FOREIGN KEY/)

      expect(world.tokens.all).toHaveLength(0)
    })

    it('hands no link out when the log cannot take the line, and the approval is the cost', async () => {
      await build({ mailer: noRelay, mode: 'copyLinkWithOwnerApproval' })
      const asked = await reset(MEMBER_ID)
      const requestId =
        asked.ok && asked.value.delivery === 'pendingApproval'
          ? asked.value.approvalId
          : asAccountTokenId('x')
      await world.useCases.approvePasswordReset({ actorId: asUserId(OWNER_ID), requestId })
      const refusing = makeIssuePasswordResetForAccount({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        secrets: world.secrets,
        mailer: noRelay,
        ids: world.ids,
        clock: world.clock,
        logger: silentLogger,
        publicUrl: PUBLIC_URL,
        mode: 'copyLinkWithOwnerApproval',
        audit: new FakeAuditLog(),
      })

      await expect(
        refusing({
          actorId: asUserId(OPERATOR_ID),
          userId: asUserId(MEMBER_ID),
          locale: 'fr',
          approvalId: requestId,
        }),
      ).rejects.toThrow(/FOREIGN KEY/)

      expect(world.tokens.all).toHaveLength(1)
    })

    it('refuses, writing nothing, an account the log would not name', async () => {
      await build()
      world.users.seed(aUser({ id: 'not an id', email: 'bizarre@example.test' }))
      world.tokens.withAccounts(asUserId('not an id'))

      const result = await reset('not an id')

      expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
      expect(sent().sent).toHaveLength(0)
      expect(world.tokens.all).toHaveLength(0)
    })

    it('refuses a request, writing nothing, for an account the log would not name', async () => {
      await build({ mailer: noRelay, mode: 'copyLinkWithOwnerApproval' })
      world.users.seed(aUser({ id: 'not an id', email: 'bizarre@example.test' }))
      world.tokens.withAccounts(asUserId('not an id'))
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId('not an id'),
        role: 'member',
        grantedAt: AT,
      })

      const result = await reset('not an id')

      expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
      expect(world.tokens.all).toHaveLength(0)
    })
  })
})
