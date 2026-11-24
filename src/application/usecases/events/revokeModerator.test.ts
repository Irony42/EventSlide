import { beforeEach, describe, expect, it } from 'vitest'
import { PushSubscription } from '../../../domain/push/pushSubscription'
import { FakePushSubscriptionRepository } from '../../testing/fakePushSubscriptionRepository'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, aUser } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeRevokeModerator, type RevokeModerator } from './revokeModerator'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const CO_OWNER = asUserId('user-co-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('revokeModerator', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let pushSubscriptions: FakePushSubscriptionRepository
  let revokeModerator: RevokeModerator

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, slug: 'gala-acme', joinCode: 'B4N9PT' }),
    )
    memberships = new FakeMembershipRepository()
    pushSubscriptions = new FakePushSubscriptionRepository()
    revokeModerator = makeRevokeModerator({ events, memberships, pushSubscriptions })

    memberships.seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
      { eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
  })

  it('removes the membership for the host', async () => {
    const result = await revokeModerator({
      eventId: WEDDING,
      actorId: OWNER,
      userId: MODERATOR,
    })

    expect(result.ok).toBe(true)
    expect(await memberships.roleFor(WEDDING, MODERATOR)).toBeNull()
  })

  it('removes a moderator whose account has been disabled, which is the tidying-up case', async () => {
    // `roleFor` refuses a disabled account, and asking it for the row about to be deleted
    // would have answered `membership.notFound` about somebody the owner's moderator list
    // is still showing them — a dead end with no way out short of re-enabling the account.
    const users = new FakeUserRepository().seed(aUser({ id: MODERATOR }).disable(AT))
    memberships = new FakeMembershipRepository({ users }).seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
    )
    revokeModerator = makeRevokeModerator({
      events,
      memberships,
      pushSubscriptions: new FakePushSubscriptionRepository(),
    })

    const result = await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: MODERATOR })

    expect(result.ok).toBe(true)
    expect(await memberships.membershipFor(WEDDING, MODERATOR)).toBeNull()
  })

  it('forgets the browsers the member asked to be told on, for this event only', async () => {
    const mine = (id: string, eventId: typeof WEDDING) =>
      PushSubscription.create({
        id,
        userId: OWNER,
        eventId,
        endpoint: `https://fcm.googleapis.com/${id}`,
        p256dh: 'B' + 'A'.repeat(86),
        auth: 'A'.repeat(22),
        createdAt: AT,
      })
    await pushSubscriptions.upsert(mine('s-1', WEDDING), 10)
    await pushSubscriptions.upsert(mine('s-2', GALA), 10)
    memberships.seed({ eventId: WEDDING, userId: STRANGER, role: 'owner', grantedAt: AT })

    expect(await pushSubscriptions.listByEvent(WEDDING)).toHaveLength(1)
    await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: OWNER })

    expect(await pushSubscriptions.listByEvent(WEDDING)).toHaveLength(0)
    expect(await pushSubscriptions.listByEvent(GALA)).toHaveLength(1)
  })

  it('leaves the account alone elsewhere: only this event loses the membership', async () => {
    memberships.seed({ eventId: GALA, userId: MODERATOR, role: 'owner', grantedAt: AT })

    await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: MODERATOR })

    expect(await memberships.roleFor(GALA, MODERATOR)).toBe('owner')
  })

  it('refuses to remove the only owner, which would leave the album unowned', async () => {
    // There is no route through which to appoint a new owner afterwards — inviting is
    // itself an owner's action — so this has to be refused rather than repaired later.
    const result = await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: OWNER })

    expect(!result.ok && result.error.code).toBe('membership.lastOwner')
    expect(await memberships.roleFor(WEDDING, OWNER)).toBe('owner')
  })

  it('lets an owner step back once a co-owner exists', async () => {
    memberships.seed({ eventId: WEDDING, userId: CO_OWNER, role: 'owner', grantedAt: AT })

    const result = await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: OWNER })

    expect(result.ok).toBe(true)
    expect(await memberships.countByRole(WEDDING, 'owner')).toBe(1)
  })

  it('counts owners per event, so another event owner does not stand in for this one', async () => {
    // The gala's owner must not make the wedding's only owner removable.
    const result = await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: OWNER })

    expect(!result.ok && result.error.code).toBe('membership.lastOwner')
  })

  it('answers notFound for a user who holds no membership on this event', async () => {
    const result = await revokeModerator({ eventId: WEDDING, actorId: OWNER, userId: STRANGER })

    expect(!result.ok && result.error.code).toBe('membership.notFound')
  })

  it('answers notFound, not forbidden, for a caller with no part in the event', async () => {
    const result = await revokeModerator({
      eventId: WEDDING,
      actorId: STRANGER,
      userId: MODERATOR,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a moderator: one who could revoke could take the event', async () => {
    const result = await revokeModerator({
      eventId: WEDDING,
      actorId: MODERATOR,
      userId: OWNER,
    })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
  })
})
