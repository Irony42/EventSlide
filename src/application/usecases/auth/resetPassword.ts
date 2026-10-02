import { DomainError } from '../../../domain/shared/errors'
import { ok, err, type Result } from '../../../domain/shared/result'
import { Password, passwordContextFor } from '../../../domain/users/password'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { Clock } from '../../ports/clock'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { SecretTokens } from '../../ports/secretTokens'
import type { UserRepository } from '../../ports/userRepository'

export interface ResetPasswordInput {
  /** From the link the person opened. A secret: never logged, never stored. */
  readonly token: string
  readonly newPassword: string
}

export interface ResetPasswordDeps {
  readonly users: UserRepository
  readonly tokens: AccountTokenRepository
  readonly secrets: SecretTokens
  readonly hasher: PasswordHasher
  readonly clock: Clock
}

export type ResetPassword = (input: ResetPasswordInput) => Promise<Result<void, DomainError>>

/**
 * The code every way of being refused a link answers with. One code and one status, because
 * what separates "never existed" from "already used", "expired", "revoked" and "for another
 * purpose" is something only the owner of a real link may know.
 */
export const INVALID_TOKEN_CODE = 'auth.invalidToken'

const invalidToken = (): DomainError => DomainError.invalid(INVALID_TOKEN_CODE)

/**
 * Chooses a new password with a reset link (roadmap §10.3; free plan G2-08, paid plan
 * P3-09), and ends every session the account has.
 *
 * ## The order is the rule
 *
 * 1. **Find the link by its digest.** Only a token that is unspent, unrevoked, unexpired and
 *    issued for a *reset* is found; everything else is `auth.invalidToken`, the same
 *    answer. A second, constant-time comparison of the digest then stands behind the lookup
 *    (`SecretTokens.verify`), so a repository that matched loosely cannot turn a near miss
 *    into a hit.
 * 2. **Check the account**: it still exists, is enabled, and still uses the address the link
 *    was mailed to. A link proves control of *that mailbox*; if the account has moved on from
 *    it, the link proves nothing about whoever holds the account now.
 * 3. **Check the password against the policy — before the link is spent.** A password that is
 *    too short must cost the person nothing: the form says so and the same link still works.
 * 4. **Spend the link.** One conditional statement decides, among any number of simultaneous
 *    requests carrying this link, which one proceeds; the others get `auth.invalidToken`.
 *    Everything after this line happens at most once per link.
 * 5. **Change the password**, which clears a forced change and raises the credentials epoch
 *    (`User.changePassword`): every session issued before this moment stops being valid, the
 *    one the thief may be holding included. Then every other reset link for the address is
 *    revoked — the one just spent is the only one that was ever meant to work.
 *
 * Nobody is signed in by it. The person has just proved a mailbox, not a password, and
 * signing in is one step away with the password they chose.
 */
export const makeResetPassword =
  ({ users, tokens, secrets, hasher, clock }: ResetPasswordDeps): ResetPassword =>
  async ({ token, newPassword }) => {
    const now = clock.now()

    const record = await tokens.findUsable(secrets.digestOf(token), 'passwordReset', now)
    if (record === null || record.userId === null) return err(invalidToken())
    if (!secrets.verify(token, record.tokenDigest)) return err(invalidToken())

    const user = await users.findById(record.userId)
    if (user === null || !user.canSignIn() || !user.email.equals(record.email)) {
      return err(invalidToken())
    }

    const parsed = Password.create(newPassword, passwordContextFor(user.email, user.displayName))
    if (!parsed.ok) return parsed

    if (!(await tokens.consume(record.id, now))) return err(invalidToken())

    const changed = user.changePassword(await hasher.hash(parsed.value), now)
    if (!changed.ok) return changed

    await users.save(changed.value)
    await tokens.revokeOutstanding(user.email, 'passwordReset', now)
    return ok(undefined)
  }
