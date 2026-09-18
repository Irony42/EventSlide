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
import { DEFAULT_SITE_ROLE, isSiteRole, type SiteRole } from '../../domain/users/siteRole'
import { User } from '../../domain/users/user'

/**
 * `UserRepository` over SQLite.
 *
 * Accounts are the one thing in this schema that is not event-scoped: a host runs
 * several weddings from one login, and a role *inside an event* is granted by
 * `event_memberships`. So there is no `eventId` argument here.
 *
 * `users.site_role` is the one column that says anything about authority, and it says it
 * about **the box**: who operates this instance, never who may touch an event on it
 * (docs/ROADMAP.md §10.1). Nothing infers an event role from it, here or anywhere.
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
  readonly site_role: string
}

const SELECT_USER = `
  SELECT id,
         email,
         display_name,
         password_hash,
         created_at,
         last_login_at,
         must_change_password,
         disabled_at,
         site_role
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
                     last_login_at, must_change_password, disabled_at, site_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET email                = excluded.email,
                                 display_name         = excluded.display_name,
                                 password_hash        = excluded.password_hash,
                                 created_at           = excluded.created_at,
                                 last_login_at        = excluded.last_login_at,
                                 must_change_password = excluded.must_change_password,
                                 disabled_at          = excluded.disabled_at,
                                 site_role            = excluded.site_role
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

/**
 * A site role the domain does not know is a corrupt row, exactly as a bad address is.
 *
 * The `CHECK` constraint refuses one on the way in, so reaching this means the column was
 * written around the application. Failing loudly beats hydrating an account whose
 * authority nobody can state — and, in the other direction, beats quietly reading an
 * unknown value as `operator`.
 */
const toSiteRole = (raw: string): SiteRole => {
  if (!isSiteRole(raw)) {
    throw new Error(`users.site_role holds a value the domain rejects (${raw})`)
  }
  return raw
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
    siteRole: toSiteRole(row.site_role),
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

  /**
   * The authorization read, answered by its own statement rather than by hydrating the
   * account.
   *
   * `WHERE disabled_at IS NULL` is part of the question, not an optimisation: an account
   * somebody switched off operates nothing, and a session that outlives its account names
   * nobody. Both answer `none`, and so does a row that is simply not an operator — every
   * refusal is the same refusal.
   *
   * It reads one small column, so an operator gate never puts a bcrypt hash on the heap
   * of a request that has no use for one.
   */
  async siteRoleFor(id: UserId): Promise<SiteRole> {
    const row = this.db
      .prepare<[string], { readonly site_role: string }>(
        `SELECT site_role FROM users WHERE id = ? AND disabled_at IS NULL`,
      )
      .get(id)

    return row === undefined ? DEFAULT_SITE_ROLE : toSiteRole(row.site_role)
  }

  async save(user: User): Promise<void> {
    const props = user.toProps()

    this.db
      .prepare<
        [
          string,
          string,
          string | null,
          string,
          string,
          string | null,
          number,
          string | null,
          SiteRole,
        ]
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
        props.siteRole,
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
    const anyAccount = this.db.prepare<[], { readonly present: number }>(
      `SELECT 1 AS present FROM users LIMIT 1`,
    )

    return anyAccount.get() === undefined
  }
}
