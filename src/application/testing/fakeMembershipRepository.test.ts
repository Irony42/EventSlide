import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { membershipRepositoryContract } from './contracts/membershipRepositoryContract'
import { AT, aUser } from './builders'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakeUserRepository } from './fakeUserRepository'

membershipRepositoryContract('fake', async () => ({ repo: new FakeMembershipRepository() }))

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')

describe('FakeMembershipRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakeMembershipRepository()

    expect(repo.seed({ eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT })).toBe(repo)
  })
})

/**
 * `listForEvent` is a join over `users` in SQLite. The shared contract has only a
 * `MembershipRepository`, so the identity columns are asserted here instead.
 */
describe('FakeMembershipRepository user identity', () => {
  it('reports the email and name of a linked account', async () => {
    const users = new FakeUserRepository().seed(
      aUser({ id: HOST, email: 'camille@example.test', displayName: 'Camille' }),
    )
    const repo = new FakeMembershipRepository({ users }).seed({
      eventId: WEDDING,
      userId: HOST,
      role: 'owner',
      grantedAt: AT,
    })

    const members = await repo.listForEvent(WEDDING)

    expect(members.map(({ email, displayName }) => ({ email, displayName }))).toEqual([
      { email: 'camille@example.test', displayName: 'Camille' },
    ])
  })

  it('reports a placeholder in a reserved domain when no account is linked', async () => {
    // Visibly not an address, so a test that asserts on it fails instead of quietly
    // agreeing with a fabricated one. The adapter cannot reach this state: the
    // membership row carries a foreign key to `users`.
    const repo = new FakeMembershipRepository().seed({
      eventId: WEDDING,
      userId: HOST,
      role: 'owner',
      grantedAt: AT,
    })

    const members = await repo.listForEvent(WEDDING)

    expect(members.map((member) => member.email)).toEqual(['user-host@unlinked.invalid'])
  })

  it('reports no display name for an account that never set one', async () => {
    const users = new FakeUserRepository().seed(aUser({ id: HOST, displayName: null }))
    const repo = new FakeMembershipRepository({ users }).seed({
      eventId: WEDDING,
      userId: HOST,
      role: 'owner',
      grantedAt: AT,
    })

    const members = await repo.listForEvent(WEDDING)

    expect(members.map((member) => member.displayName)).toEqual([null])
  })
})
