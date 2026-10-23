import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asAccountTokenId,
  asClientId,
  asEventId,
  asUserId,
  type AccountTokenId,
} from '../../../domain/shared/ids'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { InvitationTarget } from '../../../domain/users/accountToken'
import type { AuditLog } from '../../ports/auditLog'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { AcceptInvitationRecord, InvitationAcceptance } from '../../ports/invitationAcceptance'
import type { MembershipRepository, UserRepository } from '../../ports/userRepository'
import { AT, aUser, anAccountToken, atPlus } from '../builders'

/**
 * The shared `InvitationAcceptance` contract, run against the in-memory fake and the SQLite
 * adapter.
 *
 * What has to be the same in both is the thing the port exists for: **accepting an invitation
 * is all-or-nothing, and exactly one acceptance of a link can win.** A link that cannot be
 * spent writes nothing; an address that is taken writes nothing and leaves the link alive;
 * two people racing for one link, or for one new address, leave one winner and one untouched
 * loser. A fake kinder than the transaction about any of these would let every use-case test
 * above it pass against a product that was broken.
 *
 * What a link grants is read from the link, so the suite never names it when it accepts: it
 * names the account, and the link says the rest.
 *
 * The subject brings the repositories of the tables it writes, over the same storage, so the
 * suite reads its results through the ports that own them rather than around them (the audit
 * log included, for the entry an acceptance may carry: G2-20). It must
 * hold, before the suite runs: the accounts {@link ACCEPTANCE_ACCOUNTS} (each at
 * `<id>@example.test`), the event {@link ACCEPTANCE_EVENT} with {@link ACCEPTANCE_HOST} as its
 * owner, and the client {@link ACCEPTANCE_CLIENT} with no member.
 */

export const ACCEPTANCE_HOST = 'user-host'
export const ACCEPTANCE_ACCOUNTS = [ACCEPTANCE_HOST, 'user-existing'] as const
/** The address of `user-existing`: both subjects seed every account at `<id>@example.test`. */
export const ACCEPTANCE_EXISTING_EMAIL = 'user-existing@example.test'
export const ACCEPTANCE_EVENT = 'event-1'
export const ACCEPTANCE_CLIENT = 'client-1'

export interface AcceptanceSubject {
  readonly acceptance: InvitationAcceptance
  readonly tokens: AccountTokenRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly clients: ClientRepository
  /** Reads the log the acceptance writes its entry into, over the same storage. */
  readonly audit: AuditLog
  readonly dispose?: () => Promise<void>
}

const NEWCOMER = 'nouveau@example.test'

const EVENT_TARGET: InvitationTarget = {
  kind: 'event',
  eventId: asEventId(ACCEPTANCE_EVENT),
  role: 'moderator',
}
const CLIENT_OWNER: InvitationTarget = {
  kind: 'client',
  clientId: asClientId(ACCEPTANCE_CLIENT),
  role: 'owner',
}
const CLIENT_MEMBER: InvitationTarget = { ...CLIENT_OWNER, role: 'member' }

export const invitationAcceptanceContract = (
  name: string,
  makeSubject: () => Promise<AcceptanceSubject>,
): void => {
  describe(`InvitationAcceptance contract: ${name}`, () => {
    let subject: AcceptanceSubject

    beforeEach(async () => {
      subject = await makeSubject()
    })

    afterEach(async () => {
      await subject.dispose?.()
    })

    /** An invitation for the newcomer's address, stored and ready to be spent. */
    const issue = async (
      id: string,
      target: InvitationTarget = EVENT_TARGET,
      over: Parameters<typeof anAccountToken>[0] = {},
    ): Promise<AccountTokenId> => {
      await subject.tokens.save(
        anAccountToken({
          id,
          purpose: 'invitation',
          email: NEWCOMER,
          userId: null,
          ...(target.kind === 'event'
            ? { eventId: target.eventId, eventRole: target.role }
            : { clientId: target.clientId, clientRole: target.role }),
          delivery: 'mail',
          createdBy: ACCEPTANCE_HOST,
          ...over,
        }),
      )
      return asAccountTokenId(id)
    }

    const newAccount = (id = 'user-new', email = NEWCOMER, over = {}) =>
      aUser({ id, email, displayName: 'Camille', mustChangePassword: false, ...over })

    /** An invitation written to the address of the existing account, for it to accept. */
    const issueForExisting = (id: string, target: InvitationTarget = EVENT_TARGET) =>
      issue(id, target, { email: ACCEPTANCE_EXISTING_EMAIL })

    const accept = (
      tokenId: AccountTokenId,
      account: AcceptInvitationRecord['account'],
      now: Date = atPlus(1_000),
    ) => subject.acceptance.accept({ tokenId, now, account })

    const clientRoleOf = (userId: string) =>
      subject.clients.memberRole(asClientId(ACCEPTANCE_CLIENT), asUserId(userId))

    const usable = async (id: string): Promise<boolean> =>
      (await subject.tokens.findUsable(
        anAccountToken({ id }).tokenDigest,
        'invitation',
        atPlus(2_000),
      )) !== null

    const roleIn = (userId: string) =>
      subject.memberships.membershipFor(asEventId(ACCEPTANCE_EVENT), asUserId(userId))

    // ------------------------------------------------------------ a new account --

    describe('for a new account', () => {
      it('creates the account exactly as it was built, spends the link and grants the role', async () => {
        const id = await issue('tok-1')
        const user = newAccount()

        expect(await accept(id, { kind: 'new', user })).toBe('accepted')

        const stored = await subject.users.findById(asUserId('user-new'))
        expect(stored?.toProps()).toEqual(user.toProps())
        expect(await usable('tok-1')).toBe(false)
        expect((await roleIn('user-new'))?.role).toBe('moderator')
        expect((await roleIn('user-new'))?.grantedAt.toISOString()).toBe(
          atPlus(1_000).toISOString(),
        )
      })

      it('makes the account a member of the client when the link was to a client', async () => {
        const id = await issue('tok-1', CLIENT_OWNER)

        expect(await accept(id, { kind: 'new', user: newAccount() })).toBe('accepted')

        expect(
          await subject.clients.memberRole(asClientId(ACCEPTANCE_CLIENT), asUserId('user-new')),
        ).toBe('owner')
        expect(await roleIn('user-new')).toBeNull()
      })

      it('creates no account for a link that was already spent, and says it was spent', async () => {
        const id = await issue('tok-1')
        await accept(id, { kind: 'new', user: newAccount() })

        const second = newAccount('user-second', 'autre@example.test')
        expect(await accept(id, { kind: 'new', user: second })).toBe('spent')

        expect(await subject.users.findById(asUserId('user-second'))).toBeNull()
        expect(await roleIn('user-second')).toBeNull()
      })

      it.each([
        ['an unknown link', async () => asAccountTokenId('tok-nobody')],
        [
          'a revoked link',
          async () => {
            const id = await issue('tok-1')
            await subject.tokens.revokeOutstandingInvitations(
              anAccountToken({ email: NEWCOMER }).email,
              EVENT_TARGET,
              atPlus(500),
            )
            return id
          },
        ],
        ['an expired link', async () => issue('tok-1', EVENT_TARGET, { expiresAt: atPlus(900) })],
        [
          'a link still waiting for an approval it needs',
          async () => issue('tok-1', EVENT_TARGET, { requiresApproval: true }),
        ],
      ])('writes nothing for %s', async (_label, arrange) => {
        const id = await arrange()

        expect(await accept(id, { kind: 'new', user: newAccount() })).toBe('spent')

        expect(await subject.users.findById(asUserId('user-new'))).toBeNull()
        expect(await roleIn('user-new')).toBeNull()
      })

      it('refuses an address that already has an account, writes nothing and leaves the link usable', async () => {
        const id = await issue('tok-1', EVENT_TARGET, { email: 'existing@example.test' })
        await subject.users.save(aUser({ id: 'user-taken', email: 'existing@example.test' }))

        const outcome = await accept(id, {
          kind: 'new',
          user: newAccount('user-new', 'existing@example.test'),
        })

        expect(outcome).toBe('emailTaken')
        expect(await subject.users.findById(asUserId('user-new'))).toBeNull()
        expect(await roleIn('user-new')).toBeNull()
        expect(
          await subject.tokens.findUsable(
            anAccountToken({ id: 'tok-1' }).tokenDigest,
            'invitation',
            atPlus(2_000),
          ),
        ).not.toBeNull()
      })

      it('answers a spent link as spent even when the address is taken too', async () => {
        const id = await issue('tok-1')
        await accept(id, { kind: 'new', user: newAccount() })

        const outcome = await accept(id, { kind: 'new', user: newAccount('user-again') })

        expect(outcome).toBe('spent')
      })

      it('lets exactly one of several simultaneous acceptances of one link win', async () => {
        const id = await issue('tok-1')

        const outcomes = await Promise.all(
          Array.from({ length: 6 }, (_unused, index) =>
            accept(id, {
              kind: 'new',
              user: newAccount(`user-${index}`),
            }),
          ),
        )

        expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1)
        expect(outcomes.filter((outcome) => outcome === 'spent')).toHaveLength(5)
        const created = await Promise.all(
          Array.from({ length: 6 }, (_unused, index) =>
            subject.users.findById(asUserId(`user-${index}`)),
          ),
        )
        expect(created.filter((user) => user !== null)).toHaveLength(1)
      })

      it('lets one of two links for one new address win, and leaves the other usable', async () => {
        const first = await issue('tok-1')
        const second = await issue('tok-2', CLIENT_OWNER)

        const outcomes = await Promise.all([
          accept(first, { kind: 'new', user: newAccount('user-a') }),
          accept(second, { kind: 'new', user: newAccount('user-b') }),
        ])

        expect([...outcomes].sort()).toEqual(['accepted', 'emailTaken'])
        const loser = outcomes[0] === 'emailTaken' ? 'tok-1' : 'tok-2'
        expect(await usable(loser)).toBe(true)
      })

      it('never overwrites an account that has the id it was given, and spends nothing', async () => {
        const id = await issue('tok-1')
        const before = await subject.users.findById(asUserId('user-existing'))

        await expect(
          accept(id, { kind: 'new', user: newAccount('user-existing') }),
        ).rejects.toThrow()

        // The transaction rolled back: the account that held the id is exactly as it was, the
        // address is still free, and the link was not spent.
        expect((await subject.users.findById(asUserId('user-existing')))?.toProps()).toEqual(
          before?.toProps(),
        )
        expect(await subject.users.findByEmail(newAccount().email)).toBeNull()
        expect(await usable('tok-1')).toBe(true)
      })

      it('refuses an account at another address than the one the link was written to, and spends nothing', async () => {
        const id = await issue('tok-1')

        await expect(
          accept(id, { kind: 'new', user: newAccount('user-new', 'stranger@example.test') }),
        ).rejects.toThrow()

        expect(await subject.users.findById(asUserId('user-new'))).toBeNull()
        expect(await roleIn('user-new')).toBeNull()
        expect(await usable('tok-1')).toBe(true)
      })

      it('spends no link that is not an invitation, and creates nothing for it', async () => {
        await subject.tokens.save(
          anAccountToken({
            id: 'tok-reset',
            purpose: 'passwordReset',
            email: NEWCOMER,
            userId: ACCEPTANCE_HOST,
          }),
        )

        const outcome = await accept(asAccountTokenId('tok-reset'), {
          kind: 'new',
          user: newAccount(),
        })

        expect(outcome).toBe('spent')
        expect(await subject.users.findById(asUserId('user-new'))).toBeNull()
        expect(
          await subject.tokens.findUsable(
            anAccountToken({ id: 'tok-reset' }).tokenDigest,
            'passwordReset',
            atPlus(2_000),
          ),
        ).not.toBeNull()
      })
    })

    // ------------------------------------------------------- an existing account --

    // ---------------------------------------------- the acceptance of the terms --

    /** The entry the use case writes for the terms of use (G2-20), for the account that accepted. */
    const termsEntry = (userId: string, clientId: string | null = null): AuditEntry => {
      const entry = AuditEntry.create({
        at: atPlus(1_000),
        actor: { kind: 'member', userId: asUserId(userId) },
        action: 'account.termsAccepted',
        subject: { type: 'account', id: userId },
        clientId: clientId === null ? null : asClientId(clientId),
        details: { version: '2027-01' },
      })
      if (!entry.ok) throw new Error('the fixture entry was refused')
      return entry.value
    }

    const logged = async () => (await subject.audit.list({ limit: 50 })).items

    describe('with an audit entry (the acceptance of the terms, G2-20)', () => {
      it('writes nothing to the log when the caller gives no entry, which is every box that asks for no terms', async () => {
        const id = await issue('tok-1', CLIENT_OWNER)

        expect(await accept(id, { kind: 'new', user: newAccount() })).toBe('accepted')

        expect(await logged()).toEqual([])
      })

      it('writes the entry the caller built, once, when a new account is accepted', async () => {
        const id = await issue('tok-1', CLIENT_OWNER)

        const outcome = await subject.acceptance.accept({
          tokenId: id,
          now: atPlus(1_000),
          account: { kind: 'new', user: newAccount() },
          audit: termsEntry('user-new', ACCEPTANCE_CLIENT),
        })

        expect(outcome).toBe('accepted')
        const rows = await logged()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          action: 'account.termsAccepted',
          actor: { kind: 'member', userId: 'user-new' },
          subject: { type: 'account', id: 'user-new' },
          clientId: ACCEPTANCE_CLIENT,
          details: { version: '2027-01' },
        })
      })

      it('writes the entry with the acceptance of an existing account too', async () => {
        const id = await issueForExisting('tok-1')

        const outcome = await subject.acceptance.accept({
          tokenId: id,
          now: atPlus(1_000),
          account: { kind: 'existing', userId: asUserId('user-existing'), emailVerifiedAt: null },
          audit: termsEntry('user-existing'),
        })

        expect(outcome).toBe('accepted')
        expect((await logged()).map((row) => row.actor.userId)).toEqual(['user-existing'])
      })

      it('writes no entry for a link that cannot be spent, since nobody agreed to anything', async () => {
        const id = await issue('tok-1')
        await accept(id, { kind: 'new', user: newAccount() })

        const outcome = await subject.acceptance.accept({
          tokenId: id,
          now: atPlus(1_000),
          account: { kind: 'new', user: newAccount('user-other', 'autre@example.test') },
          audit: termsEntry('user-other'),
        })

        expect(outcome).toBe('spent')
        expect(await logged()).toEqual([])
      })

      it('writes no entry for an address that is taken, and leaves the link usable', async () => {
        const id = await issueForExisting('tok-1')

        const outcome = await subject.acceptance.accept({
          tokenId: id,
          now: atPlus(1_000),
          account: {
            kind: 'new',
            user: newAccount('user-new', ACCEPTANCE_EXISTING_EMAIL),
          },
          audit: termsEntry('user-new'),
        })

        expect(outcome).toBe('emailTaken')
        expect(await logged()).toEqual([])
        expect(await usable('tok-1')).toBe(true)
      })

      it('undoes the whole acceptance when the log refuses the entry, so nobody holds an account that agreed to nothing on record', async () => {
        const id = await issue('tok-1')

        await expect(
          subject.acceptance.accept({
            tokenId: id,
            now: atPlus(1_000),
            account: { kind: 'new', user: newAccount() },
            // An actor the box has never heard of: the foreign key refuses the row.
            audit: termsEntry('user-ghost'),
          }),
        ).rejects.toThrow()

        expect(await subject.users.findById(asUserId('user-new'))).toBeNull()
        expect(await roleIn('user-new')).toBeNull()
        expect(await usable('tok-1')).toBe(true)
        expect(await logged()).toEqual([])
      })
    })

    describe('for an existing account', () => {
      const existing = (emailVerifiedAt: Date | null = null) =>
        ({ kind: 'existing', userId: asUserId('user-existing'), emailVerifiedAt }) as const

      it('spends the link and grants the role, and changes nothing else about the account', async () => {
        const before = await subject.users.findById(asUserId('user-existing'))
        const id = await issueForExisting('tok-1')

        expect(await accept(id, existing())).toBe('accepted')

        expect((await roleIn('user-existing'))?.role).toBe('moderator')
        expect(await usable('tok-1')).toBe(false)
        expect((await subject.users.findById(asUserId('user-existing')))?.toProps()).toEqual(
          before?.toProps(),
        )
      })

      it('stamps the mailbox as proved when told to, and keeps the first proof after that', async () => {
        const first = await issueForExisting('tok-1')
        const second = await issueForExisting('tok-2', CLIENT_OWNER)

        await accept(first, existing(atPlus(1_000)))
        await accept(second, existing(atPlus(5_000)), atPlus(5_000))

        const stored = await subject.users.findById(asUserId('user-existing'))
        expect(stored?.emailVerifiedAt?.toISOString()).toBe(atPlus(1_000).toISOString())
      })

      it('leaves the mailbox unverified when it is not told to stamp it', async () => {
        const id = await issueForExisting('tok-1')

        await accept(id, existing(null))

        expect(
          (await subject.users.findById(asUserId('user-existing')))?.emailVerifiedAt,
        ).toBeNull()
      })

      it('never lowers a role the account already holds in that event', async () => {
        const id = await issueForExisting('tok-1')
        await subject.memberships.grant({
          eventId: asEventId(ACCEPTANCE_EVENT),
          userId: asUserId('user-existing'),
          role: 'owner',
          grantedAt: AT,
        })

        expect(await accept(id, existing())).toBe('accepted')

        expect((await roleIn('user-existing'))?.role).toBe('owner')
        expect((await roleIn('user-existing'))?.grantedAt.toISOString()).toBe(AT.toISOString())
        expect(await usable('tok-1')).toBe(false)
      })

      it('never lowers a role the account already holds in that client', async () => {
        const id = await issueForExisting('tok-1', CLIENT_MEMBER)
        await subject.clients.grantMember({
          clientId: asClientId(ACCEPTANCE_CLIENT),
          userId: asUserId('user-existing'),
          role: 'owner',
          grantedAt: AT,
        })

        expect(await accept(id, existing())).toBe('accepted')

        expect(await clientRoleOf('user-existing')).toBe('owner')
      })

      it('raises a member to owner when the link says owner, since the invitation says so', async () => {
        const id = await issueForExisting('tok-1', CLIENT_OWNER)
        await subject.clients.grantMember({
          clientId: asClientId(ACCEPTANCE_CLIENT),
          userId: asUserId('user-existing'),
          role: 'member',
          grantedAt: AT,
        })

        expect(await accept(id, existing())).toBe('accepted')

        expect(await clientRoleOf('user-existing')).toBe('owner')
      })

      it('makes a client member of an account that is not one yet, with the role the link says', async () => {
        const id = await issueForExisting('tok-1', CLIENT_MEMBER)

        await accept(id, existing())

        expect(await clientRoleOf('user-existing')).toBe('member')
      })

      it('refuses a link written to another address, and spends nothing', async () => {
        const id = await issue('tok-1')

        await expect(accept(id, existing())).rejects.toThrow()

        expect(await roleIn('user-existing')).toBeNull()
        expect(await usable('tok-1')).toBe(true)
      })

      it('writes nothing for a link that cannot be spent', async () => {
        const id = await issueForExisting('tok-1')
        await accept(id, existing())
        await subject.memberships.revoke(asEventId(ACCEPTANCE_EVENT), asUserId('user-existing'))

        expect(await accept(id, existing())).toBe('spent')

        expect(await roleIn('user-existing')).toBeNull()
      })

      it('stores nothing at all when the account is gone', async () => {
        const id = await issue('tok-1')

        await expect(
          accept(id, { kind: 'existing', userId: asUserId('user-gone'), emailVerifiedAt: null }),
        ).rejects.toThrow()

        expect(await usable('tok-1')).toBe(true)
      })
    })
  })
}
