import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EmailAddress } from '../../../domain/users/emailAddress'
import { Password, type PasswordContext } from '../../../domain/users/password'
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
}

export type ChangePassword = (input: ChangePasswordInput) => Promise<Result<void, DomainError>>

/** `exactOptionalPropertyTypes` forbids handing the context an explicit `undefined`. */
const passwordContext = (email: EmailAddress, displayName: string | null): PasswordContext =>
  displayName === null ? { email: email.value } : { email: email.value, displayName }

/**
 * A host or moderator replaces their own password.
 *
 * Also the exit from an invitation: `mustChangePassword` is cleared by the entity when
 * a new hash is set, so an invited moderator leaves behind the password their host said
 * out loud. There is no `Clock` here on purpose — nothing about this decision is timed,
 * and a dependency a use case does not use is a dependency its test has to invent.
 */
export const makeChangePassword =
  ({ users, hasher }: ChangePasswordDeps): ChangePassword =>
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
    const parsed = Password.create(newPassword, passwordContext(user.email, user.displayName))
    if (!parsed.ok) return parsed

    // The policy cannot catch this — `Password` has no idea what the account already
    // uses. Without it, "you must change your password" is satisfied by retyping the
    // one the host handed over.
    if (await hasher.verify(parsed.value.value, user.passwordHash)) {
      return err(DomainError.invalid('password.unchanged'))
    }

    const rotated = user.withPasswordHash(await hasher.hash(parsed.value))
    // Refused only when the hasher returned the hash already on file, which a salted
    // algorithm never does. Saving it anyway would report success for a change that
    // did not happen.
    if (!rotated.ok) return rotated

    await users.save(rotated.value)
    return ok(undefined)
  }
