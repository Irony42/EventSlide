import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { UserRepository } from '../../ports/userRepository'
import type { SecondFactorProof, VerifySecondFactor } from './verifySecondFactor'

export interface StepUpInput {
  /** From the session, never from the request body. */
  readonly userId: UserId
  readonly password: string
  /** Absent for an account with no second factor, which proves itself with the password alone. */
  readonly proof?: SecondFactorProof
}

export interface StepUpDeps {
  readonly users: UserRepository
  readonly factors: Pick<SecondFactorRepository, 'find'>
  readonly hasher: PasswordHasher
  readonly verifySecondFactor: VerifySecondFactor
}

export interface SteppedUp {
  /** Whether a second factor was part of the confirmation. */
  readonly secondFactorUsed: boolean
}

export type StepUp = (input: StepUpInput) => Promise<Result<SteppedUp, DomainError>>

/**
 * Confirms that the person at the keyboard *right now* is the account's owner (roadmap §10.1,
 * G2-13 / P3-15): the password, and — for an account that has an authenticator — a code from
 * it. The route stamps the session with the instant; `requireStepUp` then lets the sensitive
 * actions (offboarding a client, suspending one, changing a ceiling, removing a second
 * factor) through for five minutes.
 *
 * It exists because a session is a bearer credential: a laptop left open, a cookie in a
 * backup, a shared screen. What that session may do all day is one thing; what it may do that
 * cannot be taken back is another, and those ask again.
 *
 * **An account without a factor proves itself with the password alone**, so a box that does
 * not require one (`REQUIRE_OPERATOR_2FA` off, the self-hosted default) is not locked out of
 * its own sensitive actions. A box that does require one never reaches here without: its
 * operators cannot get past the gate in front of `/api/site` until they have enrolled.
 *
 * The proof is judged by `verifySecondFactor`, which spends the TOTP step: **a code used to
 * sign in cannot be reused to step up**, and the person waits for the app's next code. A
 * recovery code works here too — spent like any other — because the person who lost their
 * phone has no other way to remove the factor and enrol a new one.
 *
 * The password is verified first and its failure is `auth.invalidCredentials`, exactly the
 * answer to a wrong password on a sign-in.
 */
export const makeStepUp =
  ({ users, factors, hasher, verifySecondFactor }: StepUpDeps): StepUp =>
  async ({ userId, password, proof }) => {
    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null || !user.canSignIn()) {
      return err(DomainError.unauthenticated('auth.required'))
    }

    if (!(await hasher.verify(password, user.passwordHash))) {
      return err(DomainError.unauthenticated('auth.invalidCredentials'))
    }

    const factor = await factors.find(userId)
    if (factor === null || factor.confirmedAt === null) return ok({ secondFactorUsed: false })

    if (proof === undefined) return err(DomainError.unauthenticated('auth.invalidSecondFactor'))
    const verified = await verifySecondFactor({ userId, proof })
    if (!verified.ok) return verified

    return ok({ secondFactorUsed: true })
  }
