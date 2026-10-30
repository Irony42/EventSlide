import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, type Result } from '../../../domain/shared/result'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { UserRepository } from '../../ports/userRepository'
import type { DeleteAccount } from '../site/deleteAccount'

export interface DeleteOwnAccountInput {
  /** From the session, never from the request: this erases the caller and nobody else. */
  readonly userId: UserId
  /** The account's current password, asked again because the act is not undone. */
  readonly password: string
}

export interface DeleteOwnAccountDeps {
  readonly users: Pick<UserRepository, 'findById'>
  readonly hasher: PasswordHasher
  /** The same use case the operator's erasure route calls: one set of refusals, one erasure. */
  readonly deleteAccount: DeleteAccount
}

export type DeleteOwnAccount = (input: DeleteOwnAccountInput) => Promise<Result<void, DomainError>>

/**
 * A host or moderator erases their own account (GDPR art. 17; the terms promise it and the
 * operator's route had no self-service counterpart).
 *
 * **It is the operator's erasure, asked by the person, behind their password.** Nothing is
 * decided here beyond who is asking: a wrong password is `401 auth.invalidCredentials` (the
 * answer a failed sign-in gives) and nothing is touched; a right one hands over to
 * `deleteAccount`, which keeps every refusal it has (`account.operatorProtected`,
 * `account.holdsEvents`, `account.holdsMedia`, `account.holdsReviews`, `account.lastClientOwner`)
 * and writes the `account.deleted` line as **the account itself** (`member`), whose actor pointer
 * the deletion then sets to null like every line the account ever wrote. A person who still owns
 * an event is therefore told to delete or hand it over first: an album is somebody's, and erasing a
 * person does not decide what becomes of it.
 */
export const makeDeleteOwnAccount =
  ({ users, hasher, deleteAccount }: DeleteOwnAccountDeps): DeleteOwnAccount =>
  async ({ userId, password }) => {
    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null) return err(DomainError.notFound('user.notFound'))

    if (!(await hasher.verify(password, user.passwordHash))) {
      return err(DomainError.unauthenticated('auth.invalidCredentials'))
    }

    return deleteAccount({ userId, actor: { kind: 'member', userId } })
  }
