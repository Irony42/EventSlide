import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, atPlus, aUser } from '../../testing/builders'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeListModerators, type ListModerators } from './listModerators'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('listModerators', () => {
  let users: FakeUserRepository
  let memberships: FakeMembershipRepository
  let listModerators: ListModerators

  beforeEach(() => {
    users = new FakeUserRepository()
    memberships = new FakeMembershipRepository({ users })
    listModerators = makeListModerators({ memberships })

    users.seed(
      aUser({ id: OWNER, email: 'hote@example.test', displayName: 'Camille' }),
      aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
      aUser({ id: STRANGER, email: 'inconnu@example.test' }),
    )
    memberships.seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: atPlus(1_000) },
      { eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
  })

  it('lists the memberships of this event with the identity behind each one', async () => {
    const result = await listModerators({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok && result.value).toEqual([
      {
        eventId: WEDDING,
        userId: MODERATOR,
        role: 'moderator',
        grantedAt: atPlus(1_000),
        email: 'moderateur@example.test',
        displayName: null,
      },
      {
        eventId: WEDDING,
        userId: OWNER,
        role: 'owner',
        grantedAt: AT,
        email: 'hote@example.test',
        displayName: 'Camille',
      },
    ])
  })

  it('never reports another event: the gala owner is absent from the wedding', async () => {
    const result = await listModerators({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok && result.value.map((membership) => membership.userId)).not.toContain(STRANGER)
  })

  it('answers notFound, not forbidden, for a caller with no part in the event', async () => {
    const result = await listModerators({ eventId: WEDDING, actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a moderator, who is in scope but is not the host', async () => {
    const result = await listModerators({ eventId: WEDDING, actorId: MODERATOR })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
  })
})
