import type { Db } from './connection'
import {
  fromIsoText,
  fromNullableIsoText,
  fromSqliteBoolean,
  toIsoText,
  toSqliteBoolean,
} from './rowMapping'
import {
  INACTIVE_AUTH_STATE,
  type AuthState,
  type UserRepository,
} from '../../application/ports/userRepository'
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
  readonly credentials_changed_at: string | null
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
         site_role,
         credentials_changed_at
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
/**
 * The epoch only moves forward, in the statement rather than in the caller.
 *
 * `save` rewrites the whole row from an entity that was read earlier, and a request that
 * reads an account, spends 200 ms in bcrypt and then saves it back (a sign-in) can finish
 * after a reset that completed in between. Overwriting would put the old epoch back and
 * the sessions the reset revoked would work again. ISO-8601 UTC text sorts as time, so the
 * later of the two is the greater string. `COALESCE(..., '')` because scalar `MAX` is NULL
 * as soon as one argument is, and an empty string sorts below every instant.
 */
const LATEST_EPOCH = `NULLIF(MAX(COALESCE(users.credentials_changed_at, ''),
                                 COALESCE(excluded.credentials_changed_at, '')), '')`

const UPSERT_USER = `
  INSERT INTO users (id, email, display_name, password_hash, created_at,
                     last_login_at, must_change_password, disabled_at, site_role,
                     credentials_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET email                  = excluded.email,
                                 display_name           = excluded.display_name,
                                 password_hash          = excluded.password_hash,
                                 created_at             = excluded.created_at,
                                 last_login_at          = excluded.last_login_at,
                                 must_change_password   = excluded.must_change_password,
                                 disabled_at            = excluded.disabled_at,
                                 site_role              = excluded.site_role,
                                 credentials_changed_at = ${LATEST_EPOCH}
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
 * written around the application — a hand-edited dump, or a later migration that rebuilt
 * `users` through SQLite's twelve-step dance and dropped the `ALTER`-added `CHECK`.
 *
 * **Both** readers of the column go through here, and that is the decision rather than a
 * convenience. `siteRoleFor` is the read `requireOperator` makes, and it could plausibly
 * have absorbed a corrupt value as `none` instead — fail-closed, no 500 on an
 * authorization gate. It does not, because `findById` throws on the same row: one stored
 * value would then mean two different things depending on which statement read it, and
 * the quieter of the two answers is the one that hides the fact that something is writing
 * around the schema. Answering `operator` is worse again and is what the mutation that
 * went unnoticed here actually did.
 *
 * Both call sites have their own named test in `sqliteUserRepository.test.ts`; the port
 * contract cannot hold this rule, because `FakeUserRepository` stores `User` objects and
 * an unrecognised value is unrepresentable there.
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
    credentialsChangedAt: fromNullableIsoText(row.credentials_changed_at),
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

  /**
   * The one query a request needs for both authorization facts: whether the account may
   * act, and whether it must choose a password before anything else. The same `WHERE`
   * clause as `siteRoleFor`, for the same reason — and one statement rather than two,
   * which is the whole point of the port method: a request used to read `isActive` here
   * and trust a value copied into the session cookie for the other, and the second of
   * those survived the row changing underneath it.
   *
   * Reads one small column beside the flag rather than hydrating the row, so a gate on a
   * request that has no use for a password hash never puts one on the heap.
   */
  async authStateFor(id: UserId): Promise<AuthState> {
    const row = this.db
      .prepare<
        [string],
        { readonly must_change_password: number; readonly credentials_changed_at: string | null }
      >(
        `SELECT must_change_password, credentials_changed_at
           FROM users WHERE id = ? AND disabled_at IS NULL`,
      )
      .get(id)

    return row === undefined
      ? INACTIVE_AUTH_STATE
      : {
          active: true,
          mustChangePassword: fromSqliteBoolean(row.must_change_password),
          credentialsChangedAt: fromNullableIsoText(row.credentials_changed_at),
        }
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
          string | null,
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
        props.credentialsChangedAt === null ? null : toIsoText(props.credentialsChangedAt),
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
