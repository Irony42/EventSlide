import { EmailAddress } from '../domain/users/emailAddress'
import { makeProvisionClientOwner } from '../application/usecases/clients/provisionClientOwner'
import { makeConfirmSignup } from '../application/usecases/signups/confirmSignup'
import { makeNotifySignupOperator } from '../application/usecases/signups/notifySignupOperator'
import { makePreviewSignupConfirmation } from '../application/usecases/signups/previewSignupConfirmation'
import { makeRequestSignup } from '../application/usecases/signups/requestSignup'
import { makeSweepSignups } from '../application/usecases/signups/sweepSignups'
import type { Adapters, UseCasePolicy } from './usecases'
import { clientCreator, type SharedHooks } from './usecases.shared'

/**
 * The signup slice of the use-case bag (spec 31, ADR 0018): composition only, built by `buildUseCases`.
 *
 * Built whatever `SIGNUP` says, like every use case: the mode decides which routes answer (`404
 * feature.unavailable` while it is `off`), and each use case also refuses when it is off.
 *
 * `notifySignupOperator` is built once, here, because the mail it throttles is **one an hour for the
 * whole box**: the confirmation, the sweep and the operator's decisions all go through the same one.
 * It and `sweepSignups` have no route (the retention sweep calls the second).
 */
export const signupUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { issueInvitation }: SharedHooks,
) => {
  const notifyTo =
    policy.signup.notifyEmail === null ? null : EmailAddress.create(policy.signup.notifyEmail)
  const notifySignupOperator = makeNotifySignupOperator({
    mailer: adapters.mailer,
    // Validated at boot (`SIGNUP_NOTIFY_EMAIL` is an address or absent); an invalid one here is "nobody".
    to: notifyTo !== null && notifyTo.ok ? notifyTo.value : null,
    publicUrl: policy.publicUrl,
    clock: adapters.clock,
    logger: adapters.logger,
  })

  return {
    notifySignupOperator,
    requestSignup: makeRequestSignup({
      mode: policy.signup.mode,
      signups: adapters.signups,
      secrets: adapters.secretTokens,
      mailer: adapters.mailer,
      ids: adapters.ids,
      clock: adapters.clock,
      logger: adapters.logger,
      audit: adapters.audit,
      publicUrl: policy.publicUrl,
      maxPerDay: policy.signup.maxPerDay,
    }),
    previewSignupConfirmation: makePreviewSignupConfirmation({
      mode: policy.signup.mode,
      signups: adapters.signups,
      secrets: adapters.secretTokens,
      clock: adapters.clock,
    }),
    confirmSignup: makeConfirmSignup({
      mode: policy.signup.mode,
      signups: adapters.signups,
      secrets: adapters.secretTokens,
      // The same collaborators as the operator's `POST /api/site/clients`: a client opened by itself is
      // opened exactly as an operator would open it, with the system as the author.
      provisionClientOwner: makeProvisionClientOwner({
        createClient: clientCreator(adapters),
        issueInvitation,
        clients: adapters.clients,
        tokens: adapters.accountTokens,
        newClientDefaults: policy.newClientDefaults,
        audit: adapters.audit,
        clock: adapters.clock,
      }),
      clients: adapters.clients,
      disk: adapters.diskSpace,
      diskPaths: policy.signup.diskPaths,
      minFreeDiskBytes: policy.signup.minFreeDiskBytes,
      notify: notifySignupOperator,
      clock: adapters.clock,
      logger: adapters.logger,
    }),
    sweepSignups: makeSweepSignups({
      signups: adapters.signups,
      audit: adapters.audit,
      notify: notifySignupOperator,
      clock: adapters.clock,
      logger: adapters.logger,
    }),
  }
}
