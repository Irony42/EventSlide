import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { TOTP_SECRET_BYTES, otpauthUri, totpSecretText } from '../../../domain/users/totp'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MfaVault } from '../../ports/mfaVault'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { UserRepository } from '../../ports/userRepository'

export interface EnrollTotpInput {
  /** From the session, never from the request body: this enrols *that* account. */
  readonly userId: UserId
  /** Typed again, because a session cookie alone must not be enough to add a second factor. */
  readonly password: string
}

export interface EnrollTotpDeps {
  readonly users: UserRepository
  readonly factors: SecondFactorRepository
  readonly hasher: PasswordHasher
  /** `null` on a box with no `MFA_ENCRYPTION_KEY`: there is nowhere to keep a secret. */
  readonly vault: MfaVault | null
  readonly ids: IdGenerator
  readonly clock: Clock
  /** The name an authenticator app shows above the digits: the box's operator, or the product. */
  readonly issuer: string
}

/** What the person scans, and what they can type if they cannot. Shown once, never stored. */
export interface TotpEnrolment {
  /** The `otpauth://` URI a QR code carries. It holds the secret: treat it as one. */
  readonly otpauthUri: string
  /** The same secret as base32 text, for typing into an app that cannot scan. */
  readonly secret: string
}

export type EnrollTotp = (input: EnrollTotpInput) => Promise<Result<TotpEnrolment, DomainError>>

/**
 * Starts the enrolment of an authenticator (roadmap §10.1, G2-13 / P3-15): mints a secret,
 * stores it **sealed** and **unconfirmed**, and hands it to the person once.
 *
 * Nothing changes about how the account signs in until `confirmTotpEnrollment` proves the
 * person's app produces the right code: a secret that was displayed and never proven is not
 * a second factor, and an account does not start asking for one that its owner may not have
 * been able to scan.
 *
 * ## What it refuses, and in which order
 *
 * 1. **A box with no key** (`vault === null`): `404 feature.unavailable`, the answer the
 *    password-reset routes give a box with no relay.
 * 2. **An account that does not operate the box.** The second factor is the operator's
 *    (roadmap §10.1): ordinary hosts do not get a sign-in that a lost phone could lock.
 * 3. **A wrong password.** The session proves who is at the keyboard *now*; adding a factor
 *    is exactly the act a stolen cookie would be used for first, because the account that
 *    has one cannot be signed into without the thief's phone.
 * 4. **An account that already has a confirmed factor** (`409`). Replacing one is removing it
 *    first, which takes a step-up; it is never a side effect of starting an enrolment.
 *
 * An enrolment that was started and never confirmed is simply replaced by this one.
 */
export const makeEnrollTotp =
  ({ users, factors, hasher, vault, ids, clock, issuer }: EnrollTotpDeps): EnrollTotp =>
  async ({ userId, password }) => {
    if (vault === null) return err(DomainError.notFound('feature.unavailable'))

    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null) return err(DomainError.notFound('user.notFound'))
    if (!user.isOperator()) return err(DomainError.forbidden('auth.forbidden'))

    if (!(await hasher.verify(password, user.passwordHash))) {
      return err(DomainError.unauthenticated('auth.invalidCredentials'))
    }

    const secret = ids.bytes(TOTP_SECRET_BYTES)
    const { sealed, keyVersion } = vault.seal(secret)
    const begun = await factors.beginEnrolment(userId, sealed, keyVersion, clock.now())
    if (!begun) return err(DomainError.conflict('auth.secondFactorAlreadyEnrolled'))

    return ok({
      otpauthUri: otpauthUri({ account: user.email.value, issuer, secret }),
      secret: totpSecretText(secret),
    })
  }
