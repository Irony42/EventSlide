import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { maskEmailAddress } from '../../../domain/signups/maskedEmail'
import { signupEnabled, type SignupMode } from '../../../domain/signups/signupMode'
import type { Clock } from '../../ports/clock'
import type { SecretTokens } from '../../ports/secretTokens'
import type { SignupRepository } from '../../ports/signupRepository'

export const SIGNUP_CONFIRMATION_NOT_FOUND = 'signup.confirmationNotFound'

export interface SignupConfirmationPreview {
  readonly state: 'usable' | 'spent' | 'expired'
  /** `l•••@gmail.com`: enough to recognise a mailbox, never the address. */
  readonly maskedEmail: string
}

export interface PreviewSignupConfirmationDeps {
  readonly mode: SignupMode
  readonly signups: Pick<SignupRepository, 'peekConfirmation'>
  readonly secrets: Pick<SecretTokens, 'digestOf'>
  readonly clock: Clock
}

export type PreviewSignupConfirmation = (input: {
  readonly token: string
}) => Promise<Result<SignupConfirmationPreview, DomainError>>

/**
 * What a confirmation link is, **spending nothing** (spec 31 section 3, step 3): a mail scanner opens links
 * before the person does, so opening one acts on nothing. `404 feature.unavailable` while `SIGNUP=off`,
 * `404 signup.confirmationNotFound` for a token no confirmation ever had.
 */
export const makePreviewSignupConfirmation =
  ({ mode, signups, secrets, clock }: PreviewSignupConfirmationDeps): PreviewSignupConfirmation =>
  async ({ token }) => {
    if (!signupEnabled(mode)) return err(DomainError.notFound('feature.unavailable'))
    const peek = await signups.peekConfirmation(secrets.digestOf(token), clock.now())
    if (peek === null) return err(DomainError.notFound(SIGNUP_CONFIRMATION_NOT_FOUND))
    return ok({ state: peek.state, maskedEmail: maskEmailAddress(peek.email) })
  }
