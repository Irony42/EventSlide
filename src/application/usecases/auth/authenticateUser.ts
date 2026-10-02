import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { Password } from '../../../domain/users/password'
import type { PasswordHash, User } from '../../../domain/users/user'
import type { Clock } from '../../ports/clock'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { UserRepository } from '../../ports/userRepository'

export interface AuthenticateUserInput {
  readonly email: string
  readonly password: string
}

/**
 * What the caller may put in a session: an identity, and nothing worth stealing.
 *
 * Never the `User` and never the hash — 1.0's `deserializeUser` did a `SELECT *` and
 * hung the whole row, bcrypt hash included, off every authenticated request
 * (docs/adr/0004-remove-passport.md).
 */
export interface AuthenticatedUser {
  readonly userId: UserId
  readonly email: string
  readonly displayName: string | null
  /** The invitee has not chosen a password yet; the caller must send them to do so. */
  readonly mustChangePassword: boolean
  /**
   * The account has a confirmed authenticator (G2-13 / P3-15): the password was the first half,
   * and the caller must **not** start a session until `verifySecondFactor` has passed. The
   * password having been right is all this says; nothing here is a session yet.
   */
  readonly secondFactorRequired: boolean
}

export interface AuthenticateUserDeps {
  readonly users: UserRepository
  readonly factors: Pick<SecondFactorRepository, 'find'>
  readonly hasher: PasswordHasher
  readonly clock: Clock
}

export type AuthenticateUser = (
  input: AuthenticateUserInput,
) => Promise<Result<AuthenticatedUser, DomainError>>

/**
 * The only failure this use case has.
 *
 * An unknown address, a wrong password and a switched-off account are deliberately
 * indistinguishable: a login form that answers "no such account" is an
 * account-enumeration oracle, and the addresses it confirms are the ones worth
 * attacking. docs/API.md states this as the contract of `POST /api/auth/login`.
 */
const invalidCredentials = (): DomainError => DomainError.unauthenticated('auth.invalidCredentials')

/**
 * The same password hashed at the current cost, when the stored hash is behind it.
 *
 * A successful sign-in is the only moment the server holds the plaintext, so it is the
 * only moment the upgrade is possible. 1.0 hashed at bcrypt cost 10; 2.0 uses 12, and
 * without this every account created before the change would keep the weaker hash for
 * its whole life.
 *
 * Not a policy check. The credentials are already proven, and refusing the sign-in now
 * because the password predates the current rules would lock out exactly the accounts this
 * upgrade exists for. `Password` is only the way to hand plaintext to the hasher, so a
 * password the policy would reject simply keeps its old hash. Likewise a hasher that hands
 * back the hash already on file (a salted algorithm never does): there is nothing to store,
 * and losing an opportunistic upgrade must not fail a login.
 *
 * It replaces the hash and nothing else — in particular **not** the forced-change flag,
 * which choosing a password clears and a silent re-hash must not: an invited moderator
 * would otherwise keep the password their host typed for them. That is why the write is
 * `recordSignIn` and not `save`, which could not have said so.
 */
const upgradedHashFor = async (
  user: User,
  plaintext: string,
  hasher: PasswordHasher,
): Promise<PasswordHash | undefined> => {
  if (!hasher.needsRehash(user.passwordHash)) return undefined

  const parsed = Password.create(plaintext)
  if (!parsed.ok) return undefined

  const upgraded = await hasher.hash(parsed.value)
  return upgraded === user.passwordHash ? undefined : upgraded
}

export const makeAuthenticateUser =
  ({ users, factors, hasher, clock }: AuthenticateUserDeps): AuthenticateUser =>
  async ({ email, password }) => {
    const parsedEmail = EmailAddress.create(email)
    const user = parsedEmail.ok ? await users.findByEmail(parsedEmail.value) : null

    if (user === null) {
      // The whole reason `dummyHash` exists. A real verify costs ~200 ms by design; a
      // miss that returned in microseconds would answer "is this address a host here?"
      // by stopwatch, whatever the response body says.
      await hasher.verify(password, hasher.dummyHash)
      return err(invalidCredentials())
    }

    const verified = await hasher.verify(password, user.passwordHash)
    if (!verified) return err(invalidCredentials())

    // Deliberately after the comparison, not before: refusing a disabled account early
    // would make it the one case that answers in microseconds, which is the same
    // enumeration oracle with an extra step. A fired moderator's account exists, and
    // that must stay unobservable.
    if (!user.canSignIn()) return err(invalidCredentials())

    const upgraded = await upgradedHashFor(user, password, hasher)

    // The sign-in is committed only if the account still holds the hash this password was
    // just compared with. The comparison above takes ~200 ms, and a reset, a password change
    // or a switch-off may have finished during it: then the password that was right a moment
    // ago is not the password any more, and the answer is the one a wrong password gets.
    const recorded = await users.recordSignIn(user.id, user.passwordHash, clock.now(), upgraded)
    if (!recorded) return err(invalidCredentials())

    // Read after the password is proven and the sign-in committed, so how an address answers
    // before that point does not depend on whether it has a factor: a wrong password is the
    // same refusal for every account, and only the person who knows the password learns this.
    const factor = await factors.find(user.id)

    return ok({
      userId: user.id,
      email: user.email.value,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
      secondFactorRequired: factor !== null && factor.confirmedAt !== null,
    })
  }
