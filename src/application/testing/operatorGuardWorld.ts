import type { OperatorResetLinks } from '../../domain/clients/operatorGuard'
import { asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { makeAcceptInvitation } from '../usecases/auth/acceptInvitation'
import { makeIssueInvitation } from '../usecases/auth/issueInvitation'
import { makeIssuePasswordResetForAccount } from '../usecases/auth/issuePasswordResetForAccount'
import { makePreviewInvitation } from '../usecases/auth/previewInvitation'
import { makeRegisterModerator } from '../usecases/auth/registerModerator'
import { makeResetPassword } from '../usecases/auth/resetPassword'
import { makeApproveInvitation } from '../usecases/clients/approveInvitation'
import { makeApprovePasswordReset } from '../usecases/clients/approvePasswordReset'
import { makeInviteToClientAsOperator } from '../usecases/clients/inviteToClientAsOperator'
import type { Logger } from '../ports/logger'
import type { Mailer } from '../ports/mailer'
import { AT, aClient, aUser, anEvent } from './builders'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import { FakeAuditLog } from './fakeAuditLog'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClock } from './fakeClock'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeInvitationAcceptance } from './fakeInvitationAcceptance'
import { FakeMailer } from './fakeMailer'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakePasswordHasher } from './fakePasswordHasher'
import { FakeSecretTokens } from './fakeSecretTokens'
import { FakeUserRepository } from './fakeUserRepository'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * A box run for other people, with the cast the operator guard (G2-12 / P3-14) is about.
 *
 * **Who exists**, all before the test starts and every one of them able to sign in:
 *
 * - `user-operator`, the operator: `siteRole` `operator`, and a member of **no** client.
 * - `user-owner` and `user-owner-2`, the two owners of {@link CLIENT_ID} ("Camille et Sacha"):
 *   the second is what "another owner" means.
 * - `user-member`, a member of the same client who is not an owner.
 * - `user-stranger`, an account that belongs to no client.
 *
 * **What exists**: `client-1`, with those three members and (unless told otherwise) one event,
 * `event-wedding`, owned by `user-owner`; and `client-new`, a client with no member and no event
 * at all, which is the case the operator is allowed to handle alone.
 *
 * Nobody exists at {@link NEWCOMER}, the address invitations are written to.
 *
 * The use cases are the real ones over these fakes, built the way the composition root builds
 * them, so a rule is held where a caller would meet it.
 */

export const OPERATOR_ID = 'user-operator'
export const OWNER_ID = 'user-owner'
export const OWNER_2_ID = 'user-owner-2'
export const MEMBER_ID = 'user-member'
export const STRANGER_ID = 'user-stranger'
export const CLIENT_ID = 'client-1'
export const NEW_CLIENT_ID = 'client-new'
export const WEDDING_ID = 'event-wedding'
export const NEWCOMER = 'nouveau@example.test'
export const PUBLIC_URL = 'https://photos.example.test'

export interface OperatorGuardWorldOptions {
  /** Default: a mailer that delivers. Pass the production `NullMailer`'s shape for no relay. */
  readonly mailer?: Mailer
  /** `OPERATOR_RESET_LINKS`. Default `mailOnly`, the default of every box. */
  readonly mode?: OperatorResetLinks
  /** Whether `client-1` has an event. Default `true`: a client somebody is using. */
  readonly clientHasEvents?: boolean
}

/** A logger that says nothing, for a test that asserts on state and not on what was logged. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
}

export const makeOperatorGuardWorld = (options: OperatorGuardWorldOptions = {}) => {
  const clock = new FakeClock(AT)
  const secrets = new FakeSecretTokens()
  const ids = new SequentialIdGenerator()
  const hasher = new FakePasswordHasher()
  const mailer = options.mailer ?? new FakeMailer()
  const mode = options.mode ?? 'mailOnly'

  const users = new FakeUserRepository().seed(
    aUser({ id: OPERATOR_ID, email: 'operateur@example.test', siteRole: 'operator' }),
    aUser({ id: OWNER_ID, email: 'proprio@example.test', displayName: 'Camille' }),
    aUser({ id: OWNER_2_ID, email: 'coproprio@example.test', displayName: 'Sacha' }),
    aUser({ id: MEMBER_ID, email: 'membre@example.test', displayName: 'Alex' }),
    aUser({ id: STRANGER_ID, email: 'inconnu@example.test', displayName: 'Robin' }),
  )
  const clients = new FakeClientRepository().seed(
    aClient({ id: CLIENT_ID, name: 'Camille et Sacha' }),
    aClient({ id: NEW_CLIENT_ID, name: 'Client neuf' }),
  )
  const events = new FakeEventRepository({ clients })
  if (options.clientHasEvents ?? true) {
    events.seed(
      anEvent({
        id: WEDDING_ID,
        ownerId: OWNER_ID,
        clientId: CLIENT_ID,
        name: 'Mariage de Camille',
        slug: 'mariage-de-camille',
      }),
    )
  }
  const memberships = new FakeMembershipRepository({ users })
  if (options.clientHasEvents ?? true) {
    memberships.seed({
      eventId: asEventId(WEDDING_ID),
      userId: asUserId(OWNER_ID),
      role: 'owner',
      grantedAt: AT,
    })
  }

  const grant = (userId: string, role: 'owner' | 'member'): Promise<void> =>
    clients.grantMember({
      clientId: asClientId(CLIENT_ID),
      userId: asUserId(userId),
      role,
      grantedAt: AT,
    })

  const tokens = new FakeAccountTokenRepository()
    .withAccounts(
      asUserId(OPERATOR_ID),
      asUserId(OWNER_ID),
      asUserId(OWNER_2_ID),
      asUserId(MEMBER_ID),
      asUserId(STRANGER_ID),
    )
    .withEvents(asEventId(WEDDING_ID))
    .withClients(asClientId(CLIENT_ID), asClientId(NEW_CLIENT_ID))
  const audit = new FakeAuditLog().withAccounts(
    asUserId(OPERATOR_ID),
    asUserId(OWNER_ID),
    asUserId(OWNER_2_ID),
    asUserId(MEMBER_ID),
    asUserId(STRANGER_ID),
  )
  const acceptance = new FakeInvitationAcceptance({ tokens, users, memberships, clients, audit })

  const issueInvitation = makeIssueInvitation({
    tokens,
    secrets,
    mailer,
    ids,
    clock,
    logger: silentLogger,
    publicUrl: PUBLIC_URL,
  })

  const readers = { tokens, secrets, events, clients, memberships, users }

  const useCases = {
    issueInvitation,
    inviteToClientAsOperator: makeInviteToClientAsOperator({
      users,
      clients,
      tokens,
      issueInvitation,
      audit,
      clock,
    }),
    approveInvitation: makeApproveInvitation({ users, clients, tokens, audit, clock }),
    approvePasswordReset: makeApprovePasswordReset({ users, clients, tokens, audit, clock }),
    issuePasswordResetForAccount: makeIssuePasswordResetForAccount({
      users,
      clients,
      tokens,
      secrets,
      mailer,
      ids,
      clock,
      logger: silentLogger,
      publicUrl: PUBLIC_URL,
      mode,
      audit,
    }),
    previewInvitation: makePreviewInvitation({ ...readers, clock }),
    acceptInvitation: makeAcceptInvitation({
      ...readers,
      users,
      hasher,
      acceptance,
      ids,
      clock,
    }),
    resetPassword: makeResetPassword({ users, tokens, secrets, hasher, clock }),
    registerModerator: makeRegisterModerator({ events, users, memberships, issueInvitation }),
  }

  return {
    clock,
    secrets,
    ids,
    hasher,
    mailer,
    users,
    clients,
    events,
    memberships,
    tokens,
    audit,
    acceptance,
    useCases,
    /** The client's roster: the two owners and the member, as the cast above says. */
    seatTheClient: async (): Promise<void> => {
      await grant(OWNER_ID, 'owner')
      await grant(OWNER_2_ID, 'owner')
      await grant(MEMBER_ID, 'member')
    },
    /** What the log holds, newest first, whole. */
    logged: async () => (await audit.list({ limit: 100 })).items,
  }
}

export type OperatorGuardWorld = ReturnType<typeof makeOperatorGuardWorld>
