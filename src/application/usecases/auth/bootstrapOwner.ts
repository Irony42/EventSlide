import type { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { Password, type PasswordContext } from '../../../domain/users/password'
import { User } from '../../../domain/users/user'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { UserRepository } from '../../ports/userRepository'

/** The provisioning values, already read from the environment by the composition root. */
export interface BootstrapOwnerInput {
  readonly email: string
  readonly password: string
  readonly displayName: string | null
}

export type BootstrapOwnerOutcome =
  | { readonly created: true; readonly userId: UserId }
  /** Somebody already has an account, so this boot provisioned nothing. */
  | { readonly created: false; readonly reason: 'accountsExist' }

export interface BootstrapOwnerDeps {
  readonly users: UserRepository
  readonly hasher: PasswordHasher
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type BootstrapOwner = (
  input: BootstrapOwnerInput,
) => Promise<Result<BootstrapOwnerOutcome, DomainError>>

/** `exactOptionalPropertyTypes` forbids handing the context an explicit `undefined`. */
const passwordContext = (email: EmailAddress, displayName: string | null): PasswordContext =>
  displayName === null ? { email: email.value } : { email: email.value, displayName }

/**
 * Create the first owner, on the first run, and never again.
 *
 * 1.0 inserted an `admin` / `password` row from `initDatabase()` on **every** boot, in
 * production, forever: the credential was a published constant, and deleting or
 * changing the account only bought until the next restart. So this does its work once,
 * gated on an empty `users` table, from values the operator supplied — and it never
 * touches an existing account.
 */
export const makeBootstrapOwner =
  ({ users, hasher, ids, clock }: BootstrapOwnerDeps): BootstrapOwner =>
  async ({ email, password, displayName }) => {
    // The whole 1.0 defect in one line. A populated table means somebody has already
    // provisioned this box, including the case where they deliberately disabled the
    // account this would otherwise recreate beside.
    if (!(await users.isEmpty())) return ok({ created: false, reason: 'accountsExist' })

    const parsedEmail = EmailAddress.create(email)
    if (!parsedEmail.ok) return parsedEmail

    // The password policy applies to the operator too: `password` and `motdepasse123`
    // are exactly the values a first-run credential ends up being.
    const parsedPassword = Password.create(
      password,
      passwordContext(parsedEmail.value, displayName),
    )
    if (!parsedPassword.ok) return parsedPassword

    const created = User.create(
      {
        email: parsedEmail.value,
        displayName,
        passwordHash: await hasher.hash(parsedPassword.value),
        // This value lives in a deployment manifest and in shell history, so it is
        // shared configuration rather than a secret only the owner knows.
        mustChangePassword: true,
      },
      ids.userId(),
      clock.now(),
    )
    if (!created.ok) return created

    await users.save(created.value)
    return ok({ created: true, userId: created.value.id })
  }
