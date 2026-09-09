import type { EmailAddress } from '../../domain/users/emailAddress'
import type { User } from '../../domain/users/user'
import type { UserId } from '../../domain/shared/ids'
import type { UserRepository } from '../ports/userRepository'

/**
 * In-memory `UserRepository`.
 *
 * Users are not event-scoped — a host runs several weddings from one account — so
 * there is no composite key here, and `findById(id)` is the whole lookup. What must
 * behave is the unique email index: `EmailAddress` already lowercases, so two accounts
 * differing only in capitalisation are the same account, and a save that would create
 * the second one rejects the way `idx_users_email` does.
 */
export class FakeUserRepository implements UserRepository {
  private readonly rows = new Map<UserId, User>()

  seed(...users: readonly User[]): this {
    for (const user of users) this.insert(user)
    return this
  }

  private insert(user: User): void {
    for (const row of this.rows.values()) {
      if (row.id === user.id) continue
      if (row.email.equals(user.email)) {
        // Mirrors better-sqlite3's message, so a rejection reads the same way against
        // either implementation.
        throw new Error(`UNIQUE constraint failed: users.email (${user.email.value})`)
      }
    }
    this.rows.set(user.id, user)
  }

  async findById(id: UserId): Promise<User | null> {
    return this.rows.get(id) ?? null
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    return [...this.rows.values()].find((user) => user.email.equals(email)) ?? null
  }

  async save(user: User): Promise<void> {
    this.insert(user)
  }

  /** Idempotent: deleting an already-deleted account is not an error. */
  async delete(id: UserId): Promise<void> {
    this.rows.delete(id)
  }

  /**
   * Drives first-run bootstrap. A disabled account still counts: the database is not
   * empty, and treating it as empty would recreate an owner from configuration beside
   * the one somebody deliberately switched off.
   */
  async isEmpty(): Promise<boolean> {
    return this.rows.size === 0
  }
}
