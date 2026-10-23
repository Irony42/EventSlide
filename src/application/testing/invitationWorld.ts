import { asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { AT, aClient, aUser, anAccountToken, anEvent } from './builders'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClock } from './fakeClock'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeInvitationAcceptance } from './fakeInvitationAcceptance'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakePasswordHasher } from './fakePasswordHasher'
import { FakeSecretTokens } from './fakeSecretTokens'
import { FakeUserRepository } from './fakeUserRepository'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * A small box with an invitation in it, for the use cases that read or spend one
 * (`previewInvitation`, `acceptInvitation`).
 *
 * The cast, all of whom exist before the test starts:
 *
 * - **`user-host`** (`hote@example.test`), owner of `event-1`, "Mariage de Camille" — the
 *   person who writes the invitations.
 * - **`user-existing`** (`existant@example.test`), an enabled account with no part in the
 *   event. An invitation to this address is the "known address" case.
 * - **`client-1`**, "Camille et Sacha", with no member.
 *
 * Nobody else exists, and in particular nobody at `nouveau@example.test`: the address the
 * invitations are written to by default, which is the case this feature is about.
 */

export const NEWCOMER = 'nouveau@example.test'
export const EXISTING_EMAIL = 'existant@example.test'
export const HOST_ID = 'user-host'
export const EXISTING_ID = 'user-existing'
export const EVENT_ID = 'event-1'
export const CLIENT_ID = 'client-1'

export interface InvitationOptions {
  /** What it admits to. Default: moderating `event-1`. */
  readonly to?: 'event' | 'client-owner' | 'client-member'
  readonly email?: string
  readonly delivery?: 'mail' | 'link'
  /** Who wrote it. `null` for a system provisioning; default the host. */
  readonly createdBy?: string | null
  readonly requiresApproval?: boolean
  readonly expiresAt?: Date
  readonly revokedAt?: Date | null
  readonly consumedAt?: Date | null
}

export const makeInvitationWorld = () => {
  const clock = new FakeClock(AT)
  const secrets = new FakeSecretTokens()
  const ids = new SequentialIdGenerator()
  const hasher = new FakePasswordHasher()

  const users = new FakeUserRepository().seed(
    aUser({ id: HOST_ID, email: 'hote@example.test', displayName: 'Camille' }),
    aUser({ id: EXISTING_ID, email: EXISTING_EMAIL, displayName: 'Sacha' }),
  )
  const events = new FakeEventRepository().seed(
    anEvent({
      id: EVENT_ID,
      ownerId: HOST_ID,
      name: 'Mariage de Camille',
      slug: 'mariage-de-camille',
    }),
  )
  const memberships = new FakeMembershipRepository({ users }).seed({
    eventId: asEventId(EVENT_ID),
    userId: asUserId(HOST_ID),
    role: 'owner',
    grantedAt: AT,
  })
  const clients = new FakeClientRepository().seed(
    aClient({ id: CLIENT_ID, name: 'Camille et Sacha' }),
  )
  const tokens = new FakeAccountTokenRepository()
    .withAccounts(asUserId(HOST_ID), asUserId(EXISTING_ID))
    .withEvents(asEventId(EVENT_ID))
    .withClients(asClientId(CLIENT_ID))
  const acceptance = new FakeInvitationAcceptance({ tokens, users, memberships, clients })

  /** Writes an invitation straight into the store and returns the secret that opens it. */
  const invite = async (
    options: InvitationOptions = {},
  ): Promise<{ token: string; id: string }> => {
    const minted = secrets.mint()
    const to = options.to ?? 'event'
    const id = `invitation-${tokens.all.length + 1}`
    await tokens.save(
      anAccountToken({
        id,
        purpose: 'invitation',
        tokenDigest: minted.digest,
        email: options.email ?? NEWCOMER,
        userId: null,
        ...(to === 'event'
          ? { eventId: EVENT_ID, eventRole: 'moderator' as const }
          : { clientId: CLIENT_ID, clientRole: to === 'client-owner' ? 'owner' : 'member' }),
        delivery: options.delivery ?? 'mail',
        createdBy: options.createdBy === undefined ? HOST_ID : options.createdBy,
        requiresApproval: options.requiresApproval ?? false,
        ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
        ...(options.revokedAt === undefined ? {} : { revokedAt: options.revokedAt }),
        ...(options.consumedAt === undefined ? {} : { consumedAt: options.consumedAt }),
      } as Parameters<typeof anAccountToken>[0]),
    )
    return { token: minted.token, id }
  }

  return {
    clock,
    secrets,
    ids,
    hasher,
    users,
    events,
    memberships,
    clients,
    tokens,
    acceptance,
    invite,
  }
}

export type InvitationWorld = ReturnType<typeof makeInvitationWorld>
