import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { UserId } from '../shared/ids'
import type { EmailAddress } from './emailAddress'

/**
 * A host or moderator account.
 *
 * The stored hash is an opaque string here: producing and verifying it belongs to the
 * `PasswordHasher` port, and the domain must not know whether it is bcrypt or argon2.
 * What the domain does own is the surrounding policy — that a hash is never empty, that
 * a forced password change survives a login, and that a disabled account cannot sign in.
 */

/** Opaque: the algorithm, cost and salt are the adapter's business. */
export type PasswordHash = string

export interface UserProps {
  readonly id: UserId
  readonly email: EmailAddress
  readonly displayName: string | null
  readonly passwordHash: PasswordHash
  readonly createdAt: Date
  readonly lastLoginAt: Date | null
  /**
   * Set when an account was created by someone else — a host inviting a moderator —
   * so the invitee chooses their own password before doing anything else.
   */
  readonly mustChangePassword: boolean
  readonly disabledAt: Date | null
}

export interface NewUser {
  readonly email: EmailAddress
  readonly displayName: string | null
  readonly passwordHash: PasswordHash
  readonly mustChangePassword: boolean
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(input: NewUser, id: UserId, now: Date): Result<User, DomainError> {
    if (input.passwordHash.trim().length === 0) {
      return err(DomainError.invalid('user.passwordHashEmpty'))
    }
    return ok(
      new User({
        id,
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        createdAt: now,
        lastLoginAt: null,
        mustChangePassword: input.mustChangePassword,
        disabledAt: null,
      }),
    )
  }

  static restore(props: UserProps): User {
    return new User(props)
  }

  get id(): UserId {
    return this.props.id
  }

  get email(): EmailAddress {
    return this.props.email
  }

  get displayName(): string | null {
    return this.props.displayName
  }

  get passwordHash(): PasswordHash {
    return this.props.passwordHash
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt
  }

  get mustChangePassword(): boolean {
    return this.props.mustChangePassword
  }

  get disabledAt(): Date | null {
    return this.props.disabledAt
  }

  isDisabled(): boolean {
    return this.props.disabledAt !== null
  }

  /** A disabled account fails authentication before the hash is even compared. */
  canSignIn(): boolean {
    return !this.isDisabled()
  }

  recordLogin(at: Date): User {
    return this.with({ lastLoginAt: at })
  }

  /**
   * Setting a new hash clears the forced-change flag: choosing a password is what the
   * flag was asking for.
   */
  withPasswordHash(hash: PasswordHash): Result<User, DomainError> {
    if (hash.trim().length === 0) return err(DomainError.invalid('user.passwordHashEmpty'))
    if (hash === this.props.passwordHash) {
      // Not a security guarantee — two hashes of the same password differ by salt, so
      // this only catches a caller passing the stored hash straight back. Real
      // "password unchanged" detection needs the hasher and lives in the use case.
      return err(DomainError.invalid('user.passwordUnchanged'))
    }
    return ok(this.with({ passwordHash: hash, mustChangePassword: false }))
  }

  requirePasswordChange(): User {
    return this.with({ mustChangePassword: true })
  }

  rename(displayName: string | null): User {
    return this.with({ displayName })
  }

  disable(at: Date): User {
    // Idempotent: keep the first timestamp, so an audit trail is not rewritten.
    return this.props.disabledAt === null ? this.with({ disabledAt: at }) : this
  }

  enable(): User {
    return this.with({ disabledAt: null })
  }

  equals(other: User): boolean {
    return this.props.id === other.props.id
  }

  toProps(): UserProps {
    return this.props
  }

  private with(changes: Partial<UserProps>): User {
    return new User({ ...this.props, ...changes })
  }
}
