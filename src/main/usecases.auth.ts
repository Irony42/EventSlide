import { makeAuthenticateUser } from '../application/usecases/auth/authenticateUser'
import { makeAcceptInvitation } from '../application/usecases/auth/acceptInvitation'
import { makeBootstrapOwner } from '../application/usecases/auth/bootstrapOwner'
import { makeChangePassword } from '../application/usecases/auth/changePassword'
import { makeDeleteOwnAccount } from '../application/usecases/auth/deleteOwnAccount'
import { makeConfirmTotpEnrollment } from '../application/usecases/auth/confirmTotpEnrollment'
import { makeDisableAccount } from '../application/usecases/auth/disableAccount'
import { makeEnableAccount } from '../application/usecases/auth/enableAccount'
import { makeDisableSecondFactor } from '../application/usecases/auth/disableSecondFactor'
import { makeEnrollTotp } from '../application/usecases/auth/enrollTotp'
import { makeRegenerateRecoveryCodes } from '../application/usecases/auth/regenerateRecoveryCodes'
import { makePreviewInvitation } from '../application/usecases/auth/previewInvitation'
import { makeRegisterModerator } from '../application/usecases/auth/registerModerator'
import { makeRequestPasswordReset } from '../application/usecases/auth/requestPasswordReset'
import { makeResetPassword } from '../application/usecases/auth/resetPassword'
import { makeRevokeOtherSessions } from '../application/usecases/auth/revokeOtherSessions'
import { makeStepUp } from '../application/usecases/auth/stepUp'
import type { Adapters, UseCasePolicy } from './usecases'
import {
  verifySecondFactorFrom,
  invitationReaders,
  accountDeleter,
  type SharedHooks,
} from './usecases.shared'

/** The auth slice of the use-case bag: composition only, built by `buildUseCases`. */
export const authUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { issueInvitation }: SharedHooks,
) => ({
  // auth
  authenticateUser: makeAuthenticateUser({
    users: adapters.users,
    factors: adapters.secondFactors,
    hasher: adapters.passwordHasher,
    clock: adapters.clock,
  }),
  changePassword: makeChangePassword({
    users: adapters.users,
    hasher: adapters.passwordHasher,
    clock: adapters.clock,
  }),
  revokeOtherSessions: makeRevokeOtherSessions({
    users: adapters.users,
    clock: adapters.clock,
  }),
  requestPasswordReset: makeRequestPasswordReset({
    users: adapters.users,
    tokens: adapters.accountTokens,
    secrets: adapters.secretTokens,
    mailer: adapters.mailer,
    ids: adapters.ids,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
  }),
  resetPassword: makeResetPassword({
    users: adapters.users,
    tokens: adapters.accountTokens,
    secrets: adapters.secretTokens,
    hasher: adapters.passwordHasher,
    clock: adapters.clock,
  }),
  verifySecondFactor: verifySecondFactorFrom(adapters),
  enrollTotp: makeEnrollTotp({
    users: adapters.users,
    factors: adapters.secondFactors,
    hasher: adapters.passwordHasher,
    vault: adapters.mfaVault,
    ids: adapters.ids,
    clock: adapters.clock,
    issuer: policy.mfaIssuer,
  }),
  confirmTotpEnrollment: makeConfirmTotpEnrollment({
    users: adapters.users,
    factors: adapters.secondFactors,
    vault: adapters.mfaVault,
    engine: adapters.totpEngine,
    secrets: adapters.secretTokens,
    ids: adapters.ids,
    audit: adapters.audit,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
  stepUp: makeStepUp({
    users: adapters.users,
    factors: adapters.secondFactors,
    hasher: adapters.passwordHasher,
    verifySecondFactor: verifySecondFactorFrom(adapters),
  }),
  regenerateRecoveryCodes: makeRegenerateRecoveryCodes({
    users: adapters.users,
    factors: adapters.secondFactors,
    secrets: adapters.secretTokens,
    ids: adapters.ids,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  disableSecondFactor: makeDisableSecondFactor({
    users: adapters.users,
    factors: adapters.secondFactors,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /**
   * Built, and called by nothing yet: the operator API that puts its authorization in front
   * of it is its own item. Constructed here rather than there so the dependencies it needs —
   * the audit log among them — are wired once, with the rest of the auth use cases.
   */
  disableAccount: makeDisableAccount({
    users: adapters.users,
    clients: adapters.clients,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /** The operator's account acts (G2-14 part 3): behind `/api/site`, a second factor and a step-up. */
  enableAccount: makeEnableAccount({
    users: adapters.users,
    clients: adapters.clients,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  deleteAccount: accountDeleter(adapters),
  /** A person erases their own account (`DELETE /api/auth/account`): the same erasure, behind their password. */
  deleteOwnAccount: makeDeleteOwnAccount({
    stepUp: makeStepUp({
      users: adapters.users,
      factors: adapters.secondFactors,
      hasher: adapters.passwordHasher,
      verifySecondFactor: verifySecondFactorFrom(adapters),
    }),
    deleteAccount: accountDeleter(adapters),
  }),
  /**
   * Previewing and accepting an invitation (G2-09 / P3-10): the invitee's, a link in a mail
   * and the account it creates. Writing one is the mechanism under the callers that decide
   * who may invite (`registerModerator`, `provisionClientOwner`), which build it for
   * themselves from `invitationIssuer`: it is not on this bag, so no route can reach it.
   */
  previewInvitation: makePreviewInvitation({
    ...invitationReaders(adapters),
    clock: adapters.clock,
    terms: policy.termsOfUse,
  }),
  acceptInvitation: makeAcceptInvitation({
    ...invitationReaders(adapters),
    users: adapters.users,
    hasher: adapters.passwordHasher,
    acceptance: adapters.invitationAcceptance,
    ids: adapters.ids,
    clock: adapters.clock,
    terms: policy.termsOfUse,
  }),
  registerModerator: makeRegisterModerator({
    events: adapters.events,
    users: adapters.users,
    memberships: adapters.memberships,
    issueInvitation,
  }),
  bootstrapOwner: makeBootstrapOwner({
    users: adapters.users,
    hasher: adapters.passwordHasher,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
})
