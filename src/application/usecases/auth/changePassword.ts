import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { Password, passwordContextFor } from '../../../domain/users/password'
import type { Clock } from '../../ports/clock'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { UserRepository } from '../../ports/userRepository'

export interface ChangePasswordInput {
  /** From the session, never from the request body — otherwise this resets anyone. */
  readonly userId: UserId
  readonly currentPassword: string
  readonly newPassword: string
}

export interface ChangePasswordDeps {
  readonly users: UserRepository
  readonly hasher: PasswordHasher
  /** The instant of the credentials epoch this change raises. */
  readonly clock: Clock
}

export type ChangePassword = (input: ChangePasswordInput) => Promise<Result<void, DomainError>>

/**
 * A host or moderator replaces their own password.
 *
 * Also the exit from an invitation: `mustChangePassword` is cleared by the entity when
 * a new hash is set, so an invited moderator leaves behind the password their host said
 * out loud.
 *
 * **Every session issued before this moment stops being valid** (G2-08 / P3-09). The change
 * raises the account's credentials epoch in the same save as the new hash, so there is no
 * state in which the password has changed and a cookie minted under the old one still works.
 * The *current* session is the caller's to renew: the route regenerates it with a fresh
 * `issuedAt`, which is why this use case needs to say nothing about it.
 */
export const makeChangePassword =
  ({ users, hasher, clock }: ChangePasswordDeps): ChangePassword =>
  async ({ userId, currentPassword, newPassword }) => {
    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null) return err(DomainError.notFound('user.notFound'))

    const holdsCurrent = await hasher.verify(currentPassword, user.passwordHash)
    // The same code a failed sign-in returns: it is the same claim being refused, and
    // the client has one piece of copy for it (docs/API.md, POST /api/auth/password).
    if (!holdsCurrent) return err(DomainError.unauthenticated('auth.invalidCredentials'))

    // The account is the context: a password equal to its own email or to the host's
    // name protects nothing, and only the caller knows both.
    const parsed = Password.create(newPassword, passwordContextFor(user.email, user.displayName))
    if (!parsed.ok) return parsed

    // The policy cannot catch this — `Password` has no idea what the account already
    // uses. Without it, "you must change your password" is satisfied by retyping the
    // one the host handed over.
    if (await hasher.verify(parsed.value.value, user.passwordHash)) {
      return err(DomainError.invalid('password.unchanged'))
    }

    const rotated = user.changePassword(await hasher.hash(parsed.value), clock.now())
    // Refused only when the hasher returned the hash already on file, which a salted
    // algorithm never does. Saving it anyway would report success for a change that
    // did not happen.
    if (!rotated.ok) return rotated

    await users.save(rotated.value)
    return ok(undefined)
  }
