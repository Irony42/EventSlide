import type { Db } from './connection'
import {
  fromIsoText,
  fromNullableIsoText,
  fromSqliteBoolean,
  toIsoText,
  toSqliteBoolean,
} from './rowMapping'
import type { UserRepository } from '../../application/ports/userRepository'
import { asUserId, type UserId } from '../../domain/shared/ids'
import { EmailAddress } from '../../domain/users/emailAddress'
import { User } from '../../domain/users/user'

/**
 * `UserRepository` over SQLite.
 *
 * Accounts are the one thing in this schema that is not event-scoped: a host runs
 * several weddings from one login, and a role is granted per event by
 * `event_memberships`. So there is no `eventId` argument here, and there is no global
 * admin flag on the row for one to be inferred from.
 */

interface UserRow {
  readonly id: string
  readonly email: string
  readonly display_name: string | null
  readonly password_hash: string
  readonly created_at: string
  readonly last_login_at: string | null
  readonly must_change_password: number
  readonly disabled_at: string | null
}

const SELECT_USER = `
  SELECT id,
         email,
         display_name,
         password_hash,
         created_at,
         last_login_at,
         must_change_password,
         disabled_at
    FROM users
`

/**
 * `INSERT … ON CONFLICT (id) DO UPDATE`, never `INSERT OR REPLACE`.
 *
 * Two reasons, both severe. REPLACE resolves a conflict by *deleting* the offending
 * row, so saving a second account with an email another host already holds would hand
 * over that host's identity instead of being refused — and `idx_users_email` exists
 * precisely to refuse it. And the delete fires `event_memberships … ON DELETE
 * CASCADE`, so a host saving their own display name would silently drop every role
 * they hold and lock themselves out of their own event.
 *
 * Conflicting on the primary key alone leaves the unique email index free to raise,
 * which is what the contract suite asserts.
 */
const UPSERT_USER = `
  INSERT INTO users (id, email, display_name, password_hash, created_at,
                     last_login_at, must_change_password, disabled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET email                = excluded.email,
                                 display_name         = excluded.display_name,
                                 password_hash        = excluded.password_hash,
                                 created_at           = excluded.created_at,
                                 last_login_at        = excluded.last_login_at,
                                 must_change_password = excluded.must_change_password,
                                 disabled_at          = excluded.disabled_at
`

/**
 * An address the domain refuses is a corrupt row, not a login failure: `EmailAddress`
 * parsed and lowercased it on the way in. Surfacing it beats returning an account
 * whose identifier no longer means what the unique index assumes.
 */
const toEmail = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) {
    throw new Error(`users.email holds a value the domain rejects (${parsed.error.code})`)
  }
  return parsed.value
}

const toUser = (row: UserRow): User =>
  User.restore({
    id: asUserId(row.id),
    email: toEmail(row.email),
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: fromIsoText(row.created_at),
    lastLoginAt: fromNullableIsoText(row.last_login_at),
    mustChangePassword: fromSqliteBoolean(row.must_change_password),
    disabledAt: fromNullableIsoText(row.disabled_at),
  })

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: UserId): Promise<User | null> {
    const row = this.db.prepare<[string], UserRow>(`${SELECT_USER} WHERE id = ?`).get(id)

    return row === undefined ? null : toUser(row)
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    // `EmailAddress` stores the address already lowercased, so the plain equality that
    // `idx_users_email` serves is enough: no `COLLATE NOCASE`, and the login lookup
    // stays an index seek rather than a scan of every account on the box.
    const row = this.db
      .prepare<[string], UserRow>(`${SELECT_USER} WHERE email = ?`)
      .get(email.value)

    return row === undefined ? null : toUser(row)
  }

  async save(user: User): Promise<void> {
    const props = user.toProps()

    this.db
      .prepare<
        [string, string, string | null, string, string, string | null, number, string | null]
      >(UPSERT_USER)
      .run(
        props.id,
        props.email.value,
        props.displayName,
        props.passwordHash,
        toIsoText(props.createdAt),
        props.lastLoginAt === null ? null : toIsoText(props.lastLoginAt),
        toSqliteBoolean(props.mustChangePassword),
        props.disabledAt === null ? null : toIsoText(props.disabledAt),
      )
  }

  async delete(id: UserId): Promise<void> {
    // `events.owner_id` is ON DELETE RESTRICT, so deleting a host who still owns an
    // event fails loudly here rather than taking a wedding album with it. Ownership is
    // transferred first, deliberately.
    this.db.prepare<[string]>(`DELETE FROM users WHERE id = ?`).run(id)
  }

  async isEmpty(): Promise<boolean> {
    // `LIMIT 1`, not `COUNT(*)`: the question is whether first-run bootstrap should
    // create an owner, and the answer never needs the number. A disabled account still
    // counts — 1.0 recreated `admin` / `password` on every boot, and answering "empty"
    // beside a deliberately disabled owner is how that comes back.
    const row = this.db.prepare<[], { readonly present: number }>(
      `SELECT 1 AS present FROM users LIMIT 1`,
    )

    return row.get() === undefined
  }
}
