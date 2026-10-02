import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asAccountTokenId,
  asClientId,
  asEventId,
  asUserId,
  type AccountTokenId,
} from '../../../domain/shared/ids'
import type { InvitationTarget } from '../../../domain/users/accountToken'
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
 * The subject brings the repositories of the tables it writes, over the same storage, so the
 * suite reads its results through the ports that own them rather than around them. It must
 * hold, before the suite runs: the accounts {@link ACCEPTANCE_ACCOUNTS}, the event
 * {@link ACCEPTANCE_EVENT} with {@link ACCEPTANCE_HOST} as its owner, and the client
 * {@link ACCEPTANCE_CLIENT} with no member.
 */

export const ACCEPTANCE_HOST = 'user-host'
export const ACCEPTANCE_ACCOUNTS = [ACCEPTANCE_HOST, 'user-existing'] as const
export const ACCEPTANCE_EVENT = 'event-1'
export const ACCEPTANCE_CLIENT = 'client-1'

export interface AcceptanceSubject {
  readonly acceptance: InvitationAcceptance
  readonly tokens: AccountTokenRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly clients: ClientRepository
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

    const accept = (
      tokenId: AccountTokenId,
      account: AcceptInvitationRecord['account'],
      grant: InvitationTarget = EVENT_TARGET,
      now: Date = atPlus(1_000),
    ) => subject.acceptance.accept({ tokenId, now, account, grant })

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

        expect(await accept(id, { kind: 'new', user: newAccount() }, CLIENT_OWNER)).toBe('accepted')

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
              user: newAccount(`user-${index}`, `racer-${index}@example.test`),
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
          accept(second, { kind: 'new', user: newAccount('user-b') }, CLIENT_OWNER),
        ])

        expect([...outcomes].sort()).toEqual(['accepted', 'emailTaken'])
        const loser = outcomes[0] === 'emailTaken' ? 'tok-1' : 'tok-2'
        expect(await usable(loser)).toBe(true)
      })

      it('stores nothing at all when the place the link grants is gone', async () => {
        const id = await issue('tok-1')
        const gone: InvitationTarget = { ...EVENT_TARGET, eventId: asEventId('event-gone') }

        await expect(accept(id, { kind: 'new', user: newAccount() }, gone)).rejects.toThrow()

        // The transaction rolled back: no account, and the link was not spent.
        expect(await subject.users.findById(asUserId('user-new'))).toBeNull()
        expect(await usable('tok-1')).toBe(true)
      })
    })

    // ------------------------------------------------------- an existing account --

    describe('for an existing account', () => {
      const existing = (emailVerifiedAt: Date | null = null) =>
        ({ kind: 'existing', userId: asUserId('user-existing'), emailVerifiedAt }) as const

      it('spends the link and grants the role, and changes nothing else about the account', async () => {
        const before = await subject.users.findById(asUserId('user-existing'))
        const id = await issue('tok-1')

        expect(await accept(id, existing())).toBe('accepted')

        expect((await roleIn('user-existing'))?.role).toBe('moderator')
        expect(await usable('tok-1')).toBe(false)
        expect((await subject.users.findById(asUserId('user-existing')))?.toProps()).toEqual(
          before?.toProps(),
        )
      })

      it('stamps the mailbox as proved when told to, and keeps the first proof after that', async () => {
        const first = await issue('tok-1')
        const second = await issue('tok-2', CLIENT_OWNER)

        await accept(first, existing(atPlus(1_000)))
        await accept(second, existing(atPlus(5_000)), CLIENT_OWNER, atPlus(5_000))

        const stored = await subject.users.findById(asUserId('user-existing'))
        expect(stored?.emailVerifiedAt?.toISOString()).toBe(atPlus(1_000).toISOString())
      })

      it('leaves the mailbox unverified when it is not told to stamp it', async () => {
        const id = await issue('tok-1')

        await accept(id, existing(null))

        expect(
          (await subject.users.findById(asUserId('user-existing')))?.emailVerifiedAt,
        ).toBeNull()
      })

      it('never lowers a role the account already holds in that event', async () => {
        const id = await issue('tok-1')
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
        const id = await issue('tok-1', CLIENT_MEMBER)
        await subject.clients.grantMember({
          clientId: asClientId(ACCEPTANCE_CLIENT),
          userId: asUserId('user-existing'),
          role: 'owner',
          grantedAt: AT,
        })

        expect(await accept(id, existing(), CLIENT_MEMBER)).toBe('accepted')

        expect(
          await subject.clients.memberRole(
            asClientId(ACCEPTANCE_CLIENT),
            asUserId('user-existing'),
          ),
        ).toBe('owner')
      })

      it('writes nothing for a link that cannot be spent', async () => {
        const id = await issue('tok-1')
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
