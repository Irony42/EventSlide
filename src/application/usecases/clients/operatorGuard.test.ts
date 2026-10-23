import { beforeEach, describe, expect, it } from 'vitest'
import { err } from '../../../domain/shared/result'
import {
  asAccountTokenId,
  asClientId,
  asEventId,
  asUserId,
  type AccountTokenId,
} from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { AT, anEvent } from '../../testing/builders'
import type { FakeMailer } from '../../testing/fakeMailer'
import {
  CLIENT_ID,
  MEMBER_ID,
  NEWCOMER,
  NEW_CLIENT_ID,
  OPERATOR_ID,
  OWNER_2_ID,
  OWNER_ID,
  STRANGER_ID,
  WEDDING_ID,
  makeOperatorGuardWorld,
  type OperatorGuardWorld,
} from '../../testing/operatorGuardWorld'

/**
 * The operator's anti-escalation guard, rule by rule (free plan G2-12, paid plan P3-14,
 * decision D-16), driven through the **real use cases** over the in-memory fakes, the way a
 * caller meets them.
 *
 * Each `describe` is one rule of the plan's table, named by its number, and each case in it is
 * a way an operator (`user-operator`, `site_role = operator`, a member of no client) could end
 * up holding a client's account or content, and does not. The finer cases (who may approve,
 * what a refused log does, the races) are in each use case's own file; this file is the one to
 * read to see whether the plan's six sentences hold.
 *
 * The world: `client-1` has an event and three members (two owners and one member);
 * `client-new` has nothing; the mailer is the one a box has or does not.
 */

/** A box with no mail relay: the production `NullMailer`'s answer, written out. */
const noRelay: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

const PASSWORD = 'un mot de passe solide 2026'
const credentials = { password: PASSWORD, displayName: 'Nouveau Venu' }
const HOUR = 60 * 60 * 1000

describe('the operator guard', () => {
  let world: OperatorGuardWorld

  const tokenOf = (link: string): string => link.split('/').pop() ?? ''

  /** The operator invites `NEWCOMER` into a client; on a box with no relay the link comes back. */
  const operatorInvites = async (
    clientId: string,
    role: 'owner' | 'member' = 'owner',
    email = NEWCOMER,
  ) => {
    const result = await world.useCases.inviteToClientAsOperator({
      actorId: asUserId(OPERATOR_ID),
      clientId: asClientId(clientId),
      email,
      role,
      locale: 'fr',
    })
    if (!result.ok || result.value.delivery !== 'link') throw new Error('fixture')
    return { id: result.value.invitationId, token: tokenOf(result.value.link) }
  }

  const emailOf = (address: string): EmailAddress => {
    const parsed = EmailAddress.create(address)
    if (!parsed.ok) throw new Error('fixture')
    return parsed.value
  }

  const accountOf = async (address: string) => {
    const parsed = EmailAddress.create(address)
    if (!parsed.ok) throw new Error('fixture')
    return world.users.findByEmail(parsed.value)
  }

  const accepts = (token: string) => world.useCases.acceptInvitation({ token, credentials })
  const opens = async (token: string): Promise<boolean> =>
    (await world.useCases.previewInvitation({ token })).ok

  describe('R1: an operator’s invitation into a client with events waits for an owner', () => {
    beforeEach(async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay })
      await world.seatTheClient()
    })

    it('opens nothing for an operator who invites themselves into a client that has an event', async () => {
      const own = await operatorInvites(CLIENT_ID, 'owner', 'operateur@example.test')

      const asOperator = await world.useCases.acceptInvitation({
        token: own.token,
        signedInUserId: asUserId(OPERATOR_ID),
      })

      expect(!asOperator.ok && asOperator.error.code).toBe('invitation.notFound')
      expect(
        await world.clients.memberRole(asClientId(CLIENT_ID), asUserId(OPERATOR_ID)),
      ).toBeNull()
    })

    it('opens nothing for an address the operator controls, and creates no account for it', async () => {
      const { token } = await operatorInvites(CLIENT_ID)

      const result = await accepts(token)

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
      expect(await accountOf(NEWCOMER)).toBeNull()
    })

    it('opens nothing for a member invitation either, which is also a place in somebody’s account', async () => {
      const { token } = await operatorInvites(CLIENT_ID, 'member')

      expect((await accepts(token)).ok).toBe(false)
    })

    it('opens once an owner of the client approved it, and not before', async () => {
      const { id, token } = await operatorInvites(CLIENT_ID)
      expect(await opens(token)).toBe(false)

      await world.useCases.approveInvitation({ actorId: asUserId(OWNER_ID), invitationId: id })

      expect(await opens(token)).toBe(true)
      const accepted = await accepts(token)
      expect(accepted.ok).toBe(true)
      const created = await accountOf(NEWCOMER)
      expect(await world.clients.memberRole(asClientId(CLIENT_ID), created!.id)).toBe('owner')
    })

    it('is usable at once into a client that has no event, the one case the operator handles alone', async () => {
      const { token } = await operatorInvites(NEW_CLIENT_ID)

      expect(await opens(token)).toBe(true)
      expect((await accepts(token)).ok).toBe(true)
    })

    it('is judged again when it is spent: an invitation written for an empty client dies with its first event', async () => {
      const { token } = await operatorInvites(NEW_CLIENT_ID)
      await world.events.save(
        anEvent({
          id: 'event-first',
          ownerId: OWNER_ID,
          clientId: NEW_CLIENT_ID,
          name: 'Premier événement',
          slug: 'premier-evenement',
          joinCode: 'M3N5PQ',
        }),
      )

      expect(await opens(token)).toBe(false)
      expect((await accepts(token)).ok).toBe(false)
    })

    it('is judged again when it is spent in the other direction too: the customer signing up kills the second invitation an operator wrote in the meantime', async () => {
      const { token: firstOwner } = await operatorInvites(NEW_CLIENT_ID)
      const { token: accomplice } = await operatorInvites(
        NEW_CLIENT_ID,
        'owner',
        'inconnu@example.test',
      )

      // The customer accepts, and the client has a member.
      expect((await accepts(firstOwner)).ok).toBe(true)

      expect(await opens(accomplice)).toBe(false)
    })

    it('does not let an operator raise a member to owner, or add themselves beside the customer, in a client that has no event yet', async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay, clientHasEvents: false })
      await world.seatTheClient()

      const promote = await operatorInvites(CLIENT_ID, 'owner', 'membre@example.test')
      const beside = await operatorInvites(CLIENT_ID, 'owner', 'operateur@example.test')

      expect(
        (
          await world.useCases.acceptInvitation({
            token: promote.token,
            signedInUserId: asUserId(MEMBER_ID),
          })
        ).ok,
      ).toBe(false)
      expect(
        (
          await world.useCases.acceptInvitation({
            token: beside.token,
            signedInUserId: asUserId(OPERATOR_ID),
          })
        ).ok,
      ).toBe(false)
      expect(await world.clients.memberRole(asClientId(CLIENT_ID), asUserId(MEMBER_ID))).toBe(
        'member',
      )
    })

    it('does not exempt an operator the client made an owner: what they write waits, and dies with the first event', async () => {
      // The one thing an owner's own invitation is exempt from is R1, and an operator who is an
      // owner by the client's choice is still who R1 is about.
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId(OPERATOR_ID),
        role: 'owner',
        grantedAt: AT,
      })
      const written = await world.useCases.issueInvitation({
        email: 'inconnu@example.test',
        locale: 'fr',
        place: { kind: 'client', clientId: asClientId(CLIENT_ID), role: 'owner', name: 'Camille' },
        createdBy: asUserId(OPERATOR_ID),
      })
      if (!written.ok || written.value.delivery !== 'link') throw new Error('fixture')

      expect(await opens(tokenOf(written.value.link))).toBe(false)
      expect(
        (await world.useCases.acceptInvitation({ token: tokenOf(written.value.link), credentials }))
          .ok,
      ).toBe(false)
    })

    it('lets the operator write the invitation again after that, and it now waits for an owner', async () => {
      await operatorInvites(NEW_CLIENT_ID)
      await world.events.save(
        anEvent({
          id: 'event-first',
          ownerId: OWNER_ID,
          clientId: NEW_CLIENT_ID,
          name: 'Premier événement',
          slug: 'premier-evenement',
          joinCode: 'M3N5PQ',
        }),
      )

      const again = await world.useCases.inviteToClientAsOperator({
        actorId: asUserId(OPERATOR_ID),
        clientId: asClientId(NEW_CLIENT_ID),
        email: NEWCOMER,
        role: 'owner',
        locale: 'fr',
      })

      expect(again.ok && again.value.pendingApproval).toBe(true)
    })
  })

  describe('R1: an empty client admits exactly one live operator invitation (G2-14)', () => {
    beforeEach(() => {
      world = makeOperatorGuardWorld({ mailer: noRelay })
    })

    const writes = async (email: string, role: 'owner' | 'member' = 'owner') => {
      const result = await world.useCases.inviteToClientAsOperator({
        actorId: asUserId(OPERATOR_ID),
        clientId: asClientId(NEW_CLIENT_ID),
        email,
        role,
        locale: 'fr',
      })
      if (!result.ok || result.value.delivery !== 'link') throw new Error('fixture')
      return { waits: result.value.pendingApproval, token: tokenOf(result.value.link) }
    }

    it('lets the first through and makes a second, to another address, wait', async () => {
      const first = await writes('premier@example.test')
      const second = await writes('second@example.test')

      expect([first.waits, second.waits]).toEqual([false, true])
    })

    it('opens nothing for the second, and still lets the first in: the customer is not locked out by it', async () => {
      const first = await writes('premier@example.test')
      const second = await writes('second@example.test')

      expect(await opens(second.token)).toBe(false)
      expect((await accepts(second.token)).ok).toBe(false)
      expect((await accepts(first.token)).ok).toBe(true)
    })

    it('does not count an address that is sent its own link again: the new one replaces the old', async () => {
      await writes('premier@example.test')
      const again = await writes('premier@example.test')

      expect(again.waits).toBe(false)
      expect(await opens(again.token)).toBe(true)
    })

    it('does not count what can no longer be accepted: a revoked invitation, or one that has expired', async () => {
      await writes('premier@example.test')
      await world.tokens.revokeOutstandingInvitations(
        emailOf('premier@example.test'),
        { kind: 'client', clientId: asClientId(NEW_CLIENT_ID), role: 'owner' },
        world.clock.now(),
      )
      const afterRevocation = await writes('second@example.test')
      world.clock.advance(8 * 24 * HOUR)
      const afterExpiry = await writes('troisieme@example.test')

      expect([afterRevocation.waits, afterExpiry.waits]).toEqual([false, false])
    })

    it('counts the invitation into **this** client only: another client’s waiting invitation is nothing to it', async () => {
      await world.useCases.inviteToClientAsOperator({
        actorId: asUserId(OPERATOR_ID),
        clientId: asClientId(CLIENT_ID),
        email: 'ailleurs@example.test',
        role: 'member',
        locale: 'fr',
      })

      const here = await writes('premier@example.test')

      expect(here.waits).toBe(false)
    })

    it('closes the chain it was written for: the account the operator brought in second approves nothing', async () => {
      // The customer is invited first, as provisioning does; the operator then tries to bring in an
      // account of its own, which waits and so never becomes an owner whose yes would count.
      const customer = await writes('client@example.test')
      const puppet = await writes('complice@example.test')
      await accepts(puppet.token)
      await accepts(customer.token)

      expect(await accountOf('complice@example.test')).toBeNull()
      expect(await accountOf('client@example.test')).not.toBeNull()
    })
  })

  describe('R2: an operator’s password reset is mailed, and the answer never carries a link', () => {
    const asksFor = (userId: string, approvalId?: AccountTokenId) =>
      world.useCases.issuePasswordResetForAccount({
        actorId: asUserId(OPERATOR_ID),
        userId: asUserId(userId),
        locale: 'fr',
        ...(approvalId === undefined ? {} : { approvalId }),
      })

    describe.each(['mailOnly', 'copyLinkWithOwnerApproval'] as const)(
      'on a box that can mail, with %s',
      (mode) => {
        beforeEach(async () => {
          world = makeOperatorGuardWorld({ mode })
          await world.seatTheClient()
        })

        it('goes to the mailbox on record, and the operator is told nothing but that it went', async () => {
          const result = await asksFor(OWNER_ID)

          const mailer = world.mailer as FakeMailer
          expect(mailer.sent.map((mail) => mail.to)).toEqual(['proprio@example.test'])
          expect(result).toEqual({
            ok: true,
            value: { delivery: 'mail', expiresAt: new Date(AT.getTime() + HOUR) },
          })
          const token = /\/password\/reset\/([^\s/]+)/.exec(mailer.sent[0]?.text ?? '')?.[1]
          expect(JSON.stringify(result)).not.toContain(token ?? 'unreachable')
        })
      },
    )

    describe('on a box with no relay, with the default mailOnly', () => {
      beforeEach(async () => {
        world = makeOperatorGuardWorld({ mailer: noRelay })
        await world.seatTheClient()
      })

      it('issues nothing at all, however the request is made and an owner approving cannot change it', async () => {
        const first = await asksFor(OWNER_ID)
        const withApproval = await asksFor(OWNER_ID, asAccountTokenId('anything'))

        expect(!first.ok && first.error.code).toBe('reset.mailerRequired')
        expect(!withApproval.ok).toBe(true)
        expect(world.tokens.all).toHaveLength(0)
      })

      it('gives an operator no way to be handed a link for an owner’s account', async () => {
        for (const target of [OWNER_ID, OWNER_2_ID, MEMBER_ID, STRANGER_ID]) {
          const result = await asksFor(target)
          expect(JSON.stringify(result), target).not.toContain('/password/reset/')
        }
        expect(world.tokens.all).toHaveLength(0)
      })
    })

    describe('on a box with no relay, with the opt-in copyLinkWithOwnerApproval', () => {
      beforeEach(async () => {
        world = makeOperatorGuardWorld({ mailer: noRelay, mode: 'copyLinkWithOwnerApproval' })
        await world.seatTheClient()
      })

      const requested = async (userId: string): Promise<AccountTokenId> => {
        const asked = await asksFor(userId)
        if (!asked.ok || asked.value.delivery !== 'pendingApproval') throw new Error('fixture')
        return asked.value.approvalId
      }

      it('hands a link to nobody before another owner of the client approved', async () => {
        const requestId = await requested(OWNER_2_ID)

        const early = await asksFor(OWNER_2_ID, requestId)

        expect(!early.ok && early.error.code).toBe('reset.requestNotFound')
        expect(JSON.stringify(early)).not.toContain('/password/reset/')
      })

      it('hands the operator a link once another owner approved, and the account’s owner cannot be that approver', async () => {
        const requestId = await requested(OWNER_2_ID)

        const self = await world.useCases.approvePasswordReset({
          actorId: asUserId(OWNER_2_ID),
          requestId,
        })
        expect(!self.ok && self.error.kind).toBe('forbidden')
        expect((await asksFor(OWNER_2_ID, requestId)).ok).toBe(false)

        await world.useCases.approvePasswordReset({ actorId: asUserId(OWNER_ID), requestId })
        const handed = await asksFor(OWNER_2_ID, requestId)

        expect(handed.ok && handed.value.delivery).toBe('link')
      })

      it('lets nobody but an owner approve: not the operator, not a member', async () => {
        const requestId = await requested(OWNER_2_ID)

        for (const actor of [OPERATOR_ID, MEMBER_ID]) {
          await world.useCases.approvePasswordReset({ actorId: asUserId(actor), requestId })
        }

        expect((await asksFor(OWNER_2_ID, requestId)).ok).toBe(false)
        expect((await world.tokens.findById(requestId))?.approvedAt).toBeNull()
      })
    })
  })

  describe('R3: ownership of a client moves only by an owner’s decision', () => {
    beforeEach(async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay })
      await world.seatTheClient()
    })

    it('does not move when an operator invites somebody to own the client, or themselves', async () => {
      const aStranger = await operatorInvites(CLIENT_ID, 'owner', 'inconnu@example.test')
      const aMember = await operatorInvites(CLIENT_ID, 'owner', 'membre@example.test')
      const self = await operatorInvites(CLIENT_ID, 'owner', 'operateur@example.test')

      expect(
        await world.useCases.acceptInvitation({
          token: aStranger.token,
          signedInUserId: asUserId(STRANGER_ID),
        }),
      ).toMatchObject({ ok: false })
      expect(
        await world.useCases.acceptInvitation({
          token: aMember.token,
          signedInUserId: asUserId(MEMBER_ID),
        }),
      ).toMatchObject({ ok: false })
      expect(
        await world.useCases.acceptInvitation({
          token: self.token,
          signedInUserId: asUserId(OPERATOR_ID),
        }),
      ).toMatchObject({ ok: false })

      for (const user of [STRANGER_ID, OPERATOR_ID]) {
        expect(await world.clients.memberRole(asClientId(CLIENT_ID), asUserId(user))).toBeNull()
      }
      expect(await world.clients.memberRole(asClientId(CLIENT_ID), asUserId(MEMBER_ID))).toBe(
        'member',
      )
    })

    it('does not move on a member’s say-so either: only an owner’s approval lets a member become one', async () => {
      const { id, token } = await operatorInvites(CLIENT_ID, 'owner', 'membre@example.test')

      const byMember = await world.useCases.approveInvitation({
        actorId: asUserId(MEMBER_ID),
        invitationId: id,
      })
      expect(!byMember.ok && byMember.error.kind).toBe('forbidden')
      expect(
        (
          await world.useCases.acceptInvitation({
            token,
            signedInUserId: asUserId(MEMBER_ID),
          })
        ).ok,
      ).toBe(false)

      await world.useCases.approveInvitation({ actorId: asUserId(OWNER_ID), invitationId: id })
      const promoted = await world.useCases.acceptInvitation({
        token,
        signedInUserId: asUserId(MEMBER_ID),
      })

      expect(promoted.ok).toBe(true)
      expect(await world.clients.memberRole(asClientId(CLIENT_ID), asUserId(MEMBER_ID))).toBe(
        'owner',
      )
    })

    it('gives an operator no door to approve their own way in, even once the client made them an owner', async () => {
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId(OPERATOR_ID),
        role: 'owner',
        grantedAt: AT,
      })
      const { id } = await operatorInvites(CLIENT_ID, 'owner', 'inconnu@example.test')

      const result = await world.useCases.approveInvitation({
        actorId: asUserId(OPERATOR_ID),
        invitationId: id,
      })

      expect(!result.ok && result.error.kind).toBe('forbidden')
    })
  })

  describe('R4: no operator action grants an event role, opens a session, or impersonates a client', () => {
    beforeEach(async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay })
      await world.seatTheClient()
    })

    it('writes only client invitations: nothing the operator’s use case writes names an event', async () => {
      await operatorInvites(CLIENT_ID)
      await operatorInvites(NEW_CLIENT_ID, 'member', 'autre@example.test')

      for (const token of world.tokens.all) {
        expect(token).toMatchObject({ eventId: null, eventRole: null })
      }
    })

    it('never honours an invitation to an event that an operator wrote, whoever holds the link', async () => {
      const written = await world.useCases.issueInvitation({
        email: NEWCOMER,
        locale: 'fr',
        place: {
          kind: 'event',
          eventId: asEventId(WEDDING_ID),
          role: 'moderator',
          name: 'Mariage de Camille',
        },
        createdBy: asUserId(OPERATOR_ID),
      })
      if (!written.ok || written.value.delivery !== 'link') throw new Error('fixture')
      const token = tokenOf(written.value.link)

      expect(await opens(token)).toBe(false)
      expect((await accepts(token)).ok).toBe(false)
      expect(
        await world.memberships.membershipFor(asEventId(WEDDING_ID), asUserId(OPERATOR_ID)),
      ).toBeNull()
    })

    it('makes an operator no member of an event by approving, inviting or resetting anything', async () => {
      const { id, token } = await operatorInvites(CLIENT_ID, 'owner', 'operateur@example.test')
      await world.useCases.approveInvitation({ actorId: asUserId(OWNER_ID), invitationId: id })
      await world.useCases.acceptInvitation({ token, signedInUserId: asUserId(OPERATOR_ID) })

      // Even as a member of the client, which the client chose, the operator is nobody in its events.
      expect(
        await world.memberships.roleFor(asEventId(WEDDING_ID), asUserId(OPERATOR_ID)),
      ).toBeNull()
      expect(await world.memberships.listForUser(asUserId(OPERATOR_ID))).toEqual([])
    })

    it('leaves the account being reset exactly as it was: no session, no password, no epoch', async () => {
      world = makeOperatorGuardWorld()
      await world.seatTheClient()
      const before = await world.users.findById(asUserId(MEMBER_ID))
      const stateBefore = await world.users.authStateFor(asUserId(MEMBER_ID))

      await world.useCases.issuePasswordResetForAccount({
        actorId: asUserId(OPERATOR_ID),
        userId: asUserId(MEMBER_ID),
        locale: 'fr',
      })

      expect(await world.users.findById(asUserId(MEMBER_ID))).toEqual(before)
      expect(await world.users.authStateFor(asUserId(MEMBER_ID))).toEqual(stateBefore)
    })
  })

  describe('R5: every action under R1 to R4 writes an audit line the client can read', () => {
    it('writes one for each, naming who did it and which client it concerns', async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay, mode: 'copyLinkWithOwnerApproval' })
      await world.seatTheClient()

      const invited = await operatorInvites(CLIENT_ID)
      await world.useCases.approveInvitation({
        actorId: asUserId(OWNER_ID),
        invitationId: invited.id,
      })
      const asked = await world.useCases.issuePasswordResetForAccount({
        actorId: asUserId(OPERATOR_ID),
        userId: asUserId(MEMBER_ID),
        locale: 'fr',
      })
      const requestId =
        asked.ok && asked.value.delivery === 'pendingApproval'
          ? asked.value.approvalId
          : asAccountTokenId('x')
      await world.useCases.approvePasswordReset({ actorId: asUserId(OWNER_ID), requestId })
      await world.useCases.issuePasswordResetForAccount({
        actorId: asUserId(OPERATOR_ID),
        userId: asUserId(MEMBER_ID),
        locale: 'fr',
        approvalId: requestId,
      })

      const lines = [...(await world.logged())].reverse()
      expect(lines.map((line) => [line.action, line.actor.kind, line.clientId])).toEqual([
        ['invitation.issued', 'operator', CLIENT_ID],
        ['invitation.approved', 'member', CLIENT_ID],
        ['account.resetRequested', 'operator', CLIENT_ID],
        ['account.resetApproved', 'member', CLIENT_ID],
        ['account.resetIssued', 'operator', CLIENT_ID],
      ])
      // What the client's owner reads is a list of facts, none of which is a secret or an address.
      expect(JSON.stringify(lines)).not.toMatch(/secret-|example\.test|\/password\/reset\//)
    })

    it('writes a line for a reset that was mailed too, which is the common case and the quietest', async () => {
      world = makeOperatorGuardWorld()
      await world.seatTheClient()

      await world.useCases.issuePasswordResetForAccount({
        actorId: asUserId(OPERATOR_ID),
        userId: asUserId(MEMBER_ID),
        locale: 'fr',
      })

      expect((await world.logged()).map((line) => [line.action, line.details])).toEqual([
        ['account.resetIssued', { linkShown: false }],
      ])
    })
  })

  describe('R6: inviting a moderator to an event stays the event owner’s', () => {
    beforeEach(async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay })
      await world.seatTheClient()
      await world.memberships.grant({
        eventId: asEventId(WEDDING_ID),
        userId: asUserId(MEMBER_ID),
        role: 'moderator',
        grantedAt: AT,
      })
    })

    const inviteModerator = (actor: string) =>
      world.useCases.registerModerator({
        eventId: asEventId(WEDDING_ID),
        actorId: asUserId(actor),
        email: NEWCOMER,
        locale: 'fr',
      })

    it('lets the owner of the event do it', async () => {
      expect((await inviteModerator(OWNER_ID)).ok).toBe(true)
    })

    it('refuses the operator, who is nobody in the event, as it refuses a stranger', async () => {
      const operator = await inviteModerator(OPERATOR_ID)
      const stranger = await inviteModerator(STRANGER_ID)

      expect(!operator.ok && operator.error).toMatchObject({
        kind: 'notFound',
        code: 'event.notFound',
      })
      expect(!stranger.ok && stranger.error).toMatchObject({
        kind: 'notFound',
        code: 'event.notFound',
      })
    })

    it('refuses an owner of the client who is no part of the event: the client is not the event', async () => {
      const result = await inviteModerator(OWNER_2_ID)

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })

    it('refuses a moderator of the event, who invites nobody', async () => {
      const result = await inviteModerator(MEMBER_ID)

      expect(!result.ok && result.error.kind).toBe('forbidden')
    })

    it('refuses an operator the event made a moderator, which is not an owner', async () => {
      await world.memberships.grant({
        eventId: asEventId(WEDDING_ID),
        userId: asUserId(OPERATOR_ID),
        role: 'moderator',
        grantedAt: AT,
      })

      const result = await inviteModerator(OPERATOR_ID)

      expect(!result.ok && result.error.kind).toBe('forbidden')
    })
  })
})
