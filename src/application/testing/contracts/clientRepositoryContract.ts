import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asClientId,
  asEventId,
  asUserId,
  type ClientId,
  type EventId,
} from '../../../domain/shared/ids'
import type { ClientMembership, ClientRepository, ClientRole } from '../../ports/clientRepository'
import { AT, aClient, aClientCeilings, atPlus } from '../builders'

/**
 * The shared `ClientRepository` contract.
 *
 * `client_members` references `users`, and `contextForEvent` reads `events.client_id`
 * (added by this same migration, wired starting at G2-04/P3-05). Neither table is this
 * port's own to seed, so each implementation supplies `linkEvent` the same way
 * `membershipRepositoryContract` has each implementation supply `setDisabled`: the
 * arrangement is adapter-specific, the assertion stays inside the port.
 */

export const CLIENT_CONTRACT_FIXTURES = {
  userIds: ['user-owner', 'user-member'],
  eventIds: ['evt-wedding', 'evt-gala'],
} as const

const OWNER = asUserId('user-owner')
const MEMBER = asUserId('user-member')
const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const aMembership = (
  clientId: ClientId,
  userId: ClientMembership['userId'],
  role: ClientRole,
  grantedAt: Date = AT,
): ClientMembership => ({ clientId, userId, role, grantedAt })

/** Points an event's `client_id` at a client, however the implementation stores that. */
export type LinkEventToClient = (eventId: EventId, clientId: ClientId) => Promise<void>

export const clientRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{
    repo: ClientRepository
    linkEvent: LinkEventToClient
    dispose?: () => Promise<void>
  }>,
): void => {
  describe(`ClientRepository contract: ${name}`, () => {
    let repo: ClientRepository
    let linkEvent: LinkEventToClient
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      linkEvent = subject.linkEvent
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    // ------------------------------------------------------------ save / find --

    it('round-trips a client saved and read back', async () => {
      await repo.save(aClient({ id: 'client-1', name: 'Atelier Photo Camille' }))

      const found = await repo.findById(asClientId('client-1'))

      expect(found?.name.value).toBe('Atelier Photo Camille')
    })

    it('reports no client for an unknown id', async () => {
      expect(await repo.findById(asClientId('ghost'))).toBeNull()
    })

    it('round-trips every ceiling, not only the ones the free tier uses', async () => {
      const ceilings = aClientCeilings({
        maxEvents: 3,
        maxTotalBytes: 500_000_000,
        maxEventQuotaBytes: 50_000_000,
        maxRetentionDays: 90,
        clipsAllowed: false,
        liveAllowed: false,
        maxLiveDays: 14,
        maxEventsPerPeriod: 30,
        periodStartedAt: AT,
      })

      await repo.save(aClient({ id: 'client-1', ceilings }))

      const found = await repo.findById(asClientId('client-1'))
      expect(found?.ceilings.toProps()).toEqual(ceilings.toProps())
    })

    it('round-trips a contact email', async () => {
      await repo.save(aClient({ id: 'client-1', contactEmail: 'contact@example.test' }))

      expect((await repo.findById(asClientId('client-1')))?.contactEmail?.value).toBe(
        'contact@example.test',
      )
    })

    it('round-trips no contact email as null', async () => {
      await repo.save(aClient({ id: 'client-1', contactEmail: null }))

      expect((await repo.findById(asClientId('client-1')))?.contactEmail).toBeNull()
    })

    it('round-trips the lifecycle fields', async () => {
      await repo.save(
        aClient({
          id: 'client-1',
          suspendedAt: AT,
          purgeAfter: atPlus(1_000),
          retentionCapSince: atPlus(2_000),
        }),
      )

      const found = await repo.findById(asClientId('client-1'))
      expect(found?.suspendedAt).toEqual(AT)
      expect(found?.purgeAfter).toEqual(atPlus(1_000))
      expect(found?.retentionCapSince).toEqual(atPlus(2_000))
    })

    it('round-trips the per-period counter', async () => {
      await repo.save(aClient({ id: 'client-1', eventsCreatedInPeriod: 7 }))

      expect((await repo.findById(asClientId('client-1')))?.eventsCreatedInPeriod).toBe(7)
    })

    it('round-trips the locale', async () => {
      await repo.save(aClient({ id: 'client-1', locale: 'de' }))

      expect((await repo.findById(asClientId('client-1')))?.locale).toBe('de')
    })

    it('updates a client on a second save, rather than creating a duplicate', async () => {
      await repo.save(aClient({ id: 'client-1', name: 'Atelier Photo Camille' }))

      await repo.save(aClient({ id: 'client-1', name: 'Studio Jean' }))

      expect((await repo.findById(asClientId('client-1')))?.name.value).toBe('Studio Jean')
    })

    // ------------------------------------------------------------------- list --

    it('lists clients newest first', async () => {
      await repo.save(aClient({ id: 'client-1', createdAt: AT }))
      await repo.save(aClient({ id: 'client-2', createdAt: atPlus(1_000) }))

      const page = await repo.list({ limit: 10 })

      expect(page.items.map((client) => client.id)).toEqual(['client-2', 'client-1'])
      expect(page.next).toBeNull()
    })

    it('breaks a created-at tie by descending id', async () => {
      await repo.save(aClient({ id: 'client-a', createdAt: AT }))
      await repo.save(aClient({ id: 'client-b', createdAt: AT }))

      const page = await repo.list({ limit: 10 })

      expect(page.items.map((client) => client.id)).toEqual(['client-b', 'client-a'])
    })

    it('pages, resuming exactly where the previous page left off', async () => {
      await repo.save(aClient({ id: 'client-1', createdAt: AT }))
      await repo.save(aClient({ id: 'client-2', createdAt: atPlus(1_000) }))
      await repo.save(aClient({ id: 'client-3', createdAt: atPlus(2_000) }))

      const first = await repo.list({ limit: 2 })
      expect(first.items.map((client) => client.id)).toEqual(['client-3', 'client-2'])
      expect(first.next).toBe('client-2')

      const second = await repo.list({ after: asClientId('client-2'), limit: 2 })
      expect(second.items.map((client) => client.id)).toEqual(['client-1'])
      expect(second.next).toBeNull()
    })

    it('reports no next cursor on the last page', async () => {
      await repo.save(aClient({ id: 'client-1' }))

      expect((await repo.list({ limit: 10 })).next).toBeNull()
    })

    it('yields an empty page for a cursor that no longer exists', async () => {
      await repo.save(aClient({ id: 'client-1' }))

      const page = await repo.list({ after: asClientId('ghost'), limit: 10 })

      expect(page.items).toEqual([])
      expect(page.next).toBeNull()
    })

    it('yields an empty page from an empty repository', async () => {
      const page = await repo.list({ limit: 10 })

      expect(page.items).toEqual([])
      expect(page.next).toBeNull()
    })

    // ------------------------------------------------------------- membership --

    it.each(['owner', 'member'] as const)('grants and reports the %s role', async (role) => {
      await repo.save(aClient({ id: 'client-1' }))

      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, role))

      expect(await repo.memberRole(asClientId('client-1'), OWNER)).toBe(role)
    })

    it('reports no role for a user with no part in the client', async () => {
      await repo.save(aClient({ id: 'client-1' }))

      expect(await repo.memberRole(asClientId('client-1'), OWNER)).toBeNull()
    })

    it('reports no role for a member of another client', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.save(aClient({ id: 'client-2' }))
      await repo.grantMember(aMembership(asClientId('client-2'), MEMBER, 'member'))

      expect(await repo.memberRole(asClientId('client-1'), MEMBER)).toBeNull()
    })

    it('replaces the role when a membership is granted again', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'member'))

      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner', atPlus(1_000)))

      expect(await repo.memberRole(asClientId('client-1'), OWNER)).toBe('owner')
    })

    it('keeps one row per client and user across a re-grant', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'member'))

      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))

      expect(await repo.membershipsForUser(OWNER)).toHaveLength(1)
    })

    it('lists the client accounts a user belongs to, most recently granted first', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.save(aClient({ id: 'client-2' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner', atPlus(0)))
      await repo.grantMember(aMembership(asClientId('client-2'), OWNER, 'owner', atPlus(1_000)))

      const memberships = await repo.membershipsForUser(OWNER)

      expect(memberships.map((membership) => membership.clientId)).toEqual(['client-2', 'client-1'])
    })

    it('breaks a grant-time tie by ascending client id', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.save(aClient({ id: 'client-2' }))
      await repo.grantMember(aMembership(asClientId('client-2'), OWNER, 'owner'))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))

      const memberships = await repo.membershipsForUser(OWNER)

      expect(memberships.map((membership) => membership.clientId)).toEqual(['client-1', 'client-2'])
    })

    it('lists the memberships of one user only', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))

      expect(await repo.membershipsForUser(MEMBER)).toEqual([])
    })

    it('revokes a membership', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))

      await repo.revokeMember(asClientId('client-1'), OWNER)

      expect(await repo.memberRole(asClientId('client-1'), OWNER)).toBeNull()
    })

    it('is idempotent on revoke', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))
      await repo.revokeMember(asClientId('client-1'), OWNER)

      await expect(repo.revokeMember(asClientId('client-1'), OWNER)).resolves.toBeUndefined()
    })

    it('leaves the same user membership of another client alone', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.save(aClient({ id: 'client-2' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))
      await repo.grantMember(aMembership(asClientId('client-2'), OWNER, 'owner'))

      await repo.revokeMember(asClientId('client-1'), OWNER)

      expect(await repo.memberRole(asClientId('client-2'), OWNER)).toBe('owner')
    })

    // --------------------------------------------------------- contextForEvent --

    it('reports the ceilings of the client that owns an event', async () => {
      await repo.save(aClient({ id: 'client-1', ceilings: aClientCeilings({ maxEvents: 5 }) }))
      await linkEvent(WEDDING, asClientId('client-1'))

      const context = await repo.contextForEvent(WEDDING)

      expect(context?.clientId).toBe('client-1')
      expect(context?.ceilings.maxEvents).toBe(5)
      expect(context?.suspended).toBe(false)
    })

    it('reports suspended true for a suspended client', async () => {
      await repo.save(aClient({ id: 'client-1', suspendedAt: AT }))
      await linkEvent(WEDDING, asClientId('client-1'))

      expect((await repo.contextForEvent(WEDDING))?.suspended).toBe(true)
    })

    it('reports no context for an event with no client', async () => {
      expect(await repo.contextForEvent(GALA)).toBeNull()
    })

    // ------------------------------------------------------------- deleteIfEmpty --

    it('deletes a client with no member and no event', async () => {
      await repo.save(aClient({ id: 'client-1' }))

      expect(await repo.deleteIfEmpty(asClientId('client-1'))).toBe(true)
      expect(await repo.findById(asClientId('client-1'))).toBeNull()
    })

    it('refuses to delete a client that has a member', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await repo.grantMember(aMembership(asClientId('client-1'), OWNER, 'owner'))

      expect(await repo.deleteIfEmpty(asClientId('client-1'))).toBe(false)
      expect(await repo.findById(asClientId('client-1'))).not.toBeNull()
    })

    it('refuses to delete a client that has an event', async () => {
      await repo.save(aClient({ id: 'client-1' }))
      await linkEvent(WEDDING, asClientId('client-1'))

      expect(await repo.deleteIfEmpty(asClientId('client-1'))).toBe(false)
      expect(await repo.findById(asClientId('client-1'))).not.toBeNull()
    })

    it('reports false for a client that does not exist', async () => {
      expect(await repo.deleteIfEmpty(asClientId('ghost'))).toBe(false)
    })
  })
}
