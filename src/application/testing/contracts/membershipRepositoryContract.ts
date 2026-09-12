import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EventRole } from '../../../domain/events/eventRole'
import { asEventId, asUserId, type EventId, type UserId } from '../../../domain/shared/ids'
import type { Membership, MembershipRepository } from '../../ports/userRepository'
import { AT, atPlus } from '../builders'

/**
 * The shared `MembershipRepository` contract.
 *
 * This is the port authorization calls on every `/admin` request, so `roleFor`
 * answering `null` for the wrong event is the single most important case in the file:
 * it is the difference between `requireRole('moderator')` meaning "moderator of the
 * event in this URL" and meaning "is logged in". 1.0 kept one `partyId` on the user
 * row, so lending the moderation screen for one wedding handed over every event on the
 * box.
 *
 * `email` and `displayName` on a `MembershipWithUser` come from a join over `users`,
 * which this port cannot seed. They are therefore asserted in each implementation's
 * own test, with a user repository in place; here the listing is judged on membership
 * identity, role and order.
 */

/** `event_memberships` references both `events` and `users`. */
export const MEMBERSHIP_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-host', 'user-mod'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const HOST = asUserId('user-host')
const MOD = asUserId('user-mod')

const membership = (
  eventId: EventId,
  userId: UserId,
  role: EventRole,
  grantedAt: Date = AT,
): Membership => ({ eventId, userId, role, grantedAt })

export const membershipRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: MembershipRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`MembershipRepository contract: ${name}`, () => {
    let repo: MembershipRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    // ----------------------------------------------------------- authorization --

    const roles: readonly EventRole[] = ['owner', 'moderator']

    it.each(roles)('reports the %s role granted on an event', async (role) => {
      await repo.grant(membership(WEDDING, HOST, role))

      expect(await repo.roleFor(WEDDING, HOST)).toBe(role)
    })

    it('reports no role for a user with no part in the event', async () => {
      expect(await repo.roleFor(WEDDING, HOST)).toBeNull()
    })

    it('reports no role for a moderator of another event', async () => {
      await repo.grant(membership(GALA, MOD, 'moderator'))

      expect(await repo.roleFor(WEDDING, MOD)).toBeNull()
    })

    it('replaces the role when a membership is granted again', async () => {
      await repo.grant(membership(WEDDING, MOD, 'owner'))

      await repo.grant(membership(WEDDING, MOD, 'moderator'))

      expect(await repo.roleFor(WEDDING, MOD)).toBe('moderator')
    })

    it('keeps one row per user and event across a re-grant', async () => {
      await repo.grant(membership(WEDDING, MOD, 'owner'))

      await repo.grant(membership(WEDDING, MOD, 'moderator'))

      expect(await repo.listForEvent(WEDDING)).toHaveLength(1)
    })

    // --------------------------------------------------------- event listing --

    it('lists the members of an event, most recently granted first', async () => {
      await repo.grant(membership(WEDDING, HOST, 'owner', atPlus(0)))
      await repo.grant(membership(WEDDING, MOD, 'moderator', atPlus(1_000)))

      const members = await repo.listForEvent(WEDDING)

      expect(members.map((member) => member.userId)).toEqual([MOD, HOST])
    })

    it('breaks a grant-time tie by ascending user id', async () => {
      await repo.grant(membership(WEDDING, MOD, 'moderator', AT))
      await repo.grant(membership(WEDDING, HOST, 'owner', AT))

      const members = await repo.listForEvent(WEDDING)

      expect(members.map((member) => member.userId)).toEqual([HOST, MOD])
    })

    it('carries the identity, role and grant time of every listed member', async () => {
      await repo.grant(membership(WEDDING, HOST, 'owner', atPlus(1_000)))

      const members = await repo.listForEvent(WEDDING)

      expect(
        members.map(({ eventId, userId, role, grantedAt }) => ({
          eventId,
          userId,
          role,
          grantedAt,
        })),
      ).toEqual([{ eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: atPlus(1_000) }])
    })

    it('lists the members of one event only', async () => {
      await repo.grant(membership(GALA, MOD, 'moderator'))

      expect(await repo.listForEvent(WEDDING)).toEqual([])
    })

    // ---------------------------------------------------------- user listing --

    it('lists the events a user takes part in, most recently granted first', async () => {
      await repo.grant(membership(WEDDING, MOD, 'moderator', atPlus(0)))
      await repo.grant(membership(GALA, MOD, 'moderator', atPlus(1_000)))

      const memberships = await repo.listForUser(MOD)

      expect(memberships.map((each) => each.eventId)).toEqual([GALA, WEDDING])
    })

    it('breaks a grant-time tie by ascending event id', async () => {
      await repo.grant(membership(WEDDING, MOD, 'moderator', AT))
      await repo.grant(membership(GALA, MOD, 'moderator', AT))

      const memberships = await repo.listForUser(MOD)

      expect(memberships.map((each) => each.eventId)).toEqual([GALA, WEDDING])
    })

    it('lists the memberships of one user only', async () => {
      await repo.grant(membership(WEDDING, HOST, 'owner'))

      expect(await repo.listForUser(MOD)).toEqual([])
    })

    // ---------------------------------------------------------------- counts --

    it.each(roles)('counts the members of an event holding the %s role', async (role) => {
      await repo.grant(membership(WEDDING, HOST, 'owner'))
      await repo.grant(membership(WEDDING, MOD, 'moderator'))

      expect(await repo.countByRole(WEDDING, role)).toBe(1)
    })

    it('counts zero for a role nobody holds at the event', async () => {
      await repo.grant(membership(WEDDING, MOD, 'moderator'))

      expect(await repo.countByRole(WEDDING, 'owner')).toBe(0)
    })

    it('never counts another event owner, so the last-owner rule stays per event', async () => {
      await repo.grant(membership(GALA, HOST, 'owner'))

      expect(await repo.countByRole(WEDDING, 'owner')).toBe(0)
    })

    it('stops counting a role once the membership is re-granted as another', async () => {
      await repo.grant(membership(WEDDING, MOD, 'owner'))

      await repo.grant(membership(WEDDING, MOD, 'moderator'))

      expect(await repo.countByRole(WEDDING, 'owner')).toBe(0)
    })

    // ---------------------------------------------------------------- revoke --

    it('revokes a membership', async () => {
      await repo.grant(membership(WEDDING, MOD, 'moderator'))

      await repo.revoke(WEDDING, MOD)

      expect(await repo.roleFor(WEDDING, MOD)).toBeNull()
    })

    it('is idempotent on revoke', async () => {
      await repo.grant(membership(WEDDING, MOD, 'moderator'))
      await repo.revoke(WEDDING, MOD)

      await expect(repo.revoke(WEDDING, MOD)).resolves.toBeUndefined()
    })

    it('leaves the same user membership at another event alone', async () => {
      await repo.grant(membership(GALA, MOD, 'moderator'))

      await repo.revoke(WEDDING, MOD)

      expect(await repo.roleFor(GALA, MOD)).toBe('moderator')
    })
  })
}
