import { describe, expect, it } from 'vitest'
import { asAccountTokenId, asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { AT, aClient, anAccountToken, aUser } from './builders'
import {
  ACCEPTANCE_ACCOUNTS,
  ACCEPTANCE_CLIENT,
  ACCEPTANCE_EVENT,
  ACCEPTANCE_HOST,
  invitationAcceptanceContract,
} from './contracts/invitationAcceptanceContract'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import { FakeAuditLog } from './fakeAuditLog'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeInvitationAcceptance } from './fakeInvitationAcceptance'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakeUserRepository } from './fakeUserRepository'

const world = () => {
  const users = new FakeUserRepository().seed(
    ...ACCEPTANCE_ACCOUNTS.map((id) => aUser({ id, email: `${id}@example.test` })),
  )
  const tokens = new FakeAccountTokenRepository()
    .withAccounts(...ACCEPTANCE_ACCOUNTS.map(asUserId))
    .withEvents(asEventId(ACCEPTANCE_EVENT))
    .withClients(asClientId(ACCEPTANCE_CLIENT))
  const memberships = new FakeMembershipRepository({ users }).seed({
    eventId: asEventId(ACCEPTANCE_EVENT),
    userId: asUserId(ACCEPTANCE_HOST),
    role: 'owner',
    grantedAt: new Date(0),
  })
  const clients = new FakeClientRepository().seed(aClient({ id: ACCEPTANCE_CLIENT }))
  const audit = new FakeAuditLog()
  return { users, tokens, memberships, clients, audit }
}

invitationAcceptanceContract('fake', async () => {
  const parts = world()
  return { ...parts, acceptance: new FakeInvitationAcceptance(parts) }
})

describe('FakeInvitationAcceptance', () => {
  it('goes on after a call that failed, since the queue only orders the calls', async () => {
    const parts = world()
    const acceptance = new FakeInvitationAcceptance(parts)
    await parts.tokens.save(
      anAccountToken({
        id: 'tok-1',
        purpose: 'invitation',
        email: 'user-existing@example.test',
        userId: null,
        eventId: ACCEPTANCE_EVENT,
        eventRole: 'moderator',
        createdBy: ACCEPTANCE_HOST,
      }),
    )
    const tokenId = asAccountTokenId('tok-1')
    const now = new Date(AT.getTime() + 1_000)

    const failed = acceptance.accept({
      tokenId,
      now,
      account: { kind: 'existing', userId: asUserId('user-gone'), emailVerifiedAt: null },
    })
    const next = acceptance.accept({
      tokenId,
      now,
      account: { kind: 'existing', userId: asUserId('user-existing'), emailVerifiedAt: null },
    })

    await expect(failed).rejects.toThrow(/does not exist/)
    await expect(next).resolves.toBe('accepted')
  })
})
