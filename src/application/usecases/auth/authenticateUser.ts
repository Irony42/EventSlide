import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { Password } from '../../../domain/users/password'
import type { User } from '../../../domain/users/user'
import type { Clock } from '../../ports/clock'
import type { PasswordHasher } from '../../ports/passwordHasher'
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
}

export interface AuthenticateUserDeps {
  readonly users: UserRepository
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
 * Transparently move a stored hash up to the current cost.
 *
 * A successful sign-in is the only moment the server holds the plaintext, so it is the
 * only moment the upgrade is possible. 1.0 hashed at bcrypt cost 10; 2.0 uses 12, and
 * without this every account created before the change would keep the weaker hash for
 * its whole life.
 */
const rehashed = async (user: User, plaintext: string, hasher: PasswordHasher): Promise<User> => {
  if (!hasher.needsRehash(user.passwordHash)) return user

  // Not a policy check. The credentials are already proven, and refusing the sign-in
  // now because the password predates the current rules would lock out exactly the
  // accounts this upgrade exists for. `Password` is only the way to hand plaintext to
  // the hasher, so a password the policy would reject simply keeps its old hash.
  const parsed = Password.create(plaintext)
  if (!parsed.ok) return user

  const rotated = user.withPasswordHash(await hasher.hash(parsed.value))
  // Refused only when the hasher handed back the hash already on file, which a salted
  // algorithm never does. Losing an opportunistic upgrade must not fail a login.
  if (!rotated.ok) return user

  // `withPasswordHash` clears the forced-change flag, because choosing a password is
  // what that flag asks for. A rehash nobody asked for must not satisfy it — that would
  // let an invited moderator keep the password their host typed for them.
  return user.mustChangePassword ? rotated.value.requirePasswordChange() : rotated.value
}

export const makeAuthenticateUser =
  ({ users, hasher, clock }: AuthenticateUserDeps): AuthenticateUser =>
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

    const signedIn = await rehashed(user.recordLogin(clock.now()), password, hasher)
    await users.save(signedIn)

    return ok({
      userId: signedIn.id,
      email: signedIn.email.value,
      displayName: signedIn.displayName,
      mustChangePassword: signedIn.mustChangePassword,
    })
  }
