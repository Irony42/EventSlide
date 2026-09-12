import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT } from '../../testing/builders'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makeRevokeModerator, type RevokeModerator } from './revokeModerator'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const CO_OWNER = asUserId('user-co-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('revokeModerator', () => {
  let memberships: FakeMembershipRepository
  let revokeModerator: RevokeModerator

  beforeEach(() => {
    memberships = new FakeMembershipRepository()
    revokeModerator = makeRevokeModerator({ memberships })

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
