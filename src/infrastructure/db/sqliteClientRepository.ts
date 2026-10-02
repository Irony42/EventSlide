import type Database from 'better-sqlite3'
import type {
  ClientEventContext,
  ClientMembership,
  ClientPage,
  ClientRepository,
} from '../../application/ports/clientRepository'
import { Client } from '../../domain/clients/client'
import { ClientCeilings, type ClientCeilingsProps } from '../../domain/clients/clientCeilings'
import { isClientLocale, type ClientLocale } from '../../domain/clients/clientLocale'
import { isClientRole, type ClientRole } from '../../domain/clients/clientRole'
import { ClientName } from '../../domain/clients/clientName'
import {
  asClientId,
  asUserId,
  type ClientId,
  type EventId,
  type UserId,
} from '../../domain/shared/ids'
import { EmailAddress } from '../../domain/users/emailAddress'
import type { Db } from './connection'
import {
  fromIsoText,
  fromNullableIsoText,
  toIsoText,
  toSqliteBoolean,
  fromSqliteBoolean,
} from './rowMapping'

/**
 * `ClientRepository` over SQLite (roadmap §10.2; paid plan P3-04).
 *
 * `list` is keyset-paginated on `(created_at, id)` rather than `OFFSET`, which is the
 * standard reason: an operator paging through clients while a new one is created must
 * not see an existing row twice or skip one, which an `OFFSET` page silently does the
 * moment a row is inserted ahead of the cursor.
 */

const CLIENT_COLUMNS = `id, name, contact_email, created_at, suspended_at, purge_after,
                        max_events, max_total_bytes, max_event_quota_bytes, max_retention_days,
                        retention_cap_since, clips_allowed, live_allowed, max_live_days,
                        max_events_per_period, period_started_at, events_created_in_period, locale`

interface ClientRow {
  readonly id: string
  readonly name: string
  readonly contact_email: string | null
  readonly created_at: string
  readonly suspended_at: string | null
  readonly purge_after: string | null
  readonly max_events: number | null
  readonly max_total_bytes: number | null
  readonly max_event_quota_bytes: number | null
  readonly max_retention_days: number | null
  readonly retention_cap_since: string | null
  readonly clips_allowed: number
  readonly live_allowed: number
  readonly max_live_days: number | null
  readonly max_events_per_period: number | null
  readonly period_started_at: string | null
  readonly events_created_in_period: number
  readonly locale: string
}

/** Named rather than positional: eighteen columns in the right order by luck is no plan. */
interface ClientParams {
  readonly id: string
  readonly name: string
  readonly contactEmail: string | null
  readonly createdAt: string
  readonly suspendedAt: string | null
  readonly purgeAfter: string | null
  readonly maxEvents: number | null
  readonly maxTotalBytes: number | null
  readonly maxEventQuotaBytes: number | null
  readonly maxRetentionDays: number | null
  readonly retentionCapSince: string | null
  readonly clipsAllowed: number
  readonly liveAllowed: number
  readonly maxLiveDays: number | null
  readonly maxEventsPerPeriod: number | null
  readonly periodStartedAt: string | null
  readonly eventsCreatedInPeriod: number
  readonly locale: string
}

interface CursorRow {
  readonly created_at: string
  readonly id: string
}

interface MembershipRow {
  readonly client_id: string
  readonly user_id: string
  readonly role: string
  readonly granted_at: string
}

interface RoleRow {
  readonly role: string
}

interface ContextRow {
  readonly client_id: string
  readonly max_events: number | null
  readonly max_total_bytes: number | null
  readonly max_event_quota_bytes: number | null
  readonly max_retention_days: number | null
  readonly clips_allowed: number
  readonly live_allowed: number
  readonly max_live_days: number | null
  readonly max_events_per_period: number | null
  readonly period_started_at: string | null
  readonly suspended_at: string | null
}

/**
 * `detail` is a domain error code or a closed tag, **never the offending value**: this
 * message reaches the error log, and `name` and `contact_email` are personal data that
 * docs/SECURITY.md's log table does not allow there.
 */
const corrupt = (column: string, detail: string): Error =>
  new Error(`Corrupt clients.${column} in the database: ${detail}`)

/**
 * The column carries `CHECK (role IN ('owner', 'member'))`, so an unknown role can only
 * come from a hand-edited database. Refusing to hydrate it is the safe direction, the
 * same reasoning `sqliteMembershipRepository.ts`'s `roleOf` applies to an event role.
 */
const clientRoleOf = (raw: string): ClientRole => {
  if (!isClientRole(raw)) {
    throw new Error(`Corrupt client_members.role in the database: ${raw}`)
  }
  return raw
}

const localeOf = (raw: string): ClientLocale => {
  if (!isClientLocale(raw)) throw corrupt('locale', raw)
  return raw
}

const toCeilingsProps = (row: {
  readonly max_events: number | null
  readonly max_total_bytes: number | null
  readonly max_event_quota_bytes: number | null
  readonly max_retention_days: number | null
  readonly clips_allowed: number
  readonly live_allowed: number
  readonly max_live_days: number | null
  readonly max_events_per_period: number | null
  readonly period_started_at: string | null
}): ClientCeilingsProps => ({
  maxEvents: row.max_events,
  maxTotalBytes: row.max_total_bytes,
  maxEventQuotaBytes: row.max_event_quota_bytes,
  maxRetentionDays: row.max_retention_days,
  clipsAllowed: fromSqliteBoolean(row.clips_allowed),
  liveAllowed: fromSqliteBoolean(row.live_allowed),
  maxLiveDays: row.max_live_days,
  maxEventsPerPeriod: row.max_events_per_period,
  periodStartedAt: fromNullableIsoText(row.period_started_at),
})

/**
 * Hydration trusts the row — the values were validated on the way in and the schema's
 * own `CHECK` constraints back that up — so a value the domain now refuses means the
 * file was hand-edited or written by another program.
 */
const toClient = (row: ClientRow): Client => {
  const name = ClientName.create(row.name)
  if (!name.ok) throw corrupt('name', name.error.code)

  let contactEmail: EmailAddress | null = null
  if (row.contact_email !== null) {
    const parsed = EmailAddress.create(row.contact_email)
    if (!parsed.ok) throw corrupt('contact_email', parsed.error.code)
    contactEmail = parsed.value
  }

  return Client.restore({
    id: asClientId(row.id),
    name: name.value,
    contactEmail,
    createdAt: fromIsoText(row.created_at),
    suspendedAt: fromNullableIsoText(row.suspended_at),
    purgeAfter: fromNullableIsoText(row.purge_after),
    retentionCapSince: fromNullableIsoText(row.retention_cap_since),
    ceilings: ClientCeilings.restore(toCeilingsProps(row)),
    eventsCreatedInPeriod: row.events_created_in_period,
    locale: localeOf(row.locale),
  })
}

const toParams = (client: Client): ClientParams => {
  const props = client.toProps()
  const ceilings = props.ceilings.toProps()
  return {
    id: props.id,
    name: props.name.value,
    contactEmail: props.contactEmail === null ? null : props.contactEmail.value,
    createdAt: toIsoText(props.createdAt),
    suspendedAt: props.suspendedAt === null ? null : toIsoText(props.suspendedAt),
    purgeAfter: props.purgeAfter === null ? null : toIsoText(props.purgeAfter),
    maxEvents: ceilings.maxEvents,
    maxTotalBytes: ceilings.maxTotalBytes,
    maxEventQuotaBytes: ceilings.maxEventQuotaBytes,
    maxRetentionDays: ceilings.maxRetentionDays,
    retentionCapSince: props.retentionCapSince === null ? null : toIsoText(props.retentionCapSince),
    clipsAllowed: toSqliteBoolean(ceilings.clipsAllowed),
    liveAllowed: toSqliteBoolean(ceilings.liveAllowed),
    maxLiveDays: ceilings.maxLiveDays,
    maxEventsPerPeriod: ceilings.maxEventsPerPeriod,
    periodStartedAt: ceilings.periodStartedAt === null ? null : toIsoText(ceilings.periodStartedAt),
    eventsCreatedInPeriod: props.eventsCreatedInPeriod,
    locale: props.locale,
  }
}

const toMembership = (row: MembershipRow): ClientMembership => ({
  clientId: asClientId(row.client_id),
  userId: asUserId(row.user_id),
  role: clientRoleOf(row.role),
  grantedAt: fromIsoText(row.granted_at),
})

export class SqliteClientRepository implements ClientRepository {
  private readonly selectById: Database.Statement<[string], ClientRow>
  private readonly selectCursor: Database.Statement<[string], CursorRow>
  private readonly selectFirstPage: Database.Statement<[number], ClientRow>
  private readonly selectNextPage: Database.Statement<[string, string, string, number], ClientRow>
  private readonly upsert: Database.Statement<ClientParams>
  private readonly selectMembershipsForUser: Database.Statement<[string], MembershipRow>
  private readonly selectMemberRole: Database.Statement<[string, string], RoleRow>
  private readonly upsertMembership: Database.Statement<[string, string, string, string]>
  private readonly deleteMembership: Database.Statement<[string, string]>
  private readonly selectContextForEvent: Database.Statement<[string], ContextRow>
  private readonly deleteIfEmptyStatement: Database.Statement<[string]>

  constructor(db: Db) {
    this.selectById = db.prepare<[string], ClientRow>(
      `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`,
    )

    this.selectCursor = db.prepare<[string], CursorRow>(
      `SELECT created_at, id FROM clients WHERE id = ?`,
    )

    this.selectFirstPage = db.prepare<[number], ClientRow>(
      `SELECT ${CLIENT_COLUMNS} FROM clients
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )

    // Keyset pagination, newest first: strictly before the cursor's (created_at, id) in
    // that same order, so a client inserted after the page was drawn neither duplicates
    // a row nor pushes one off the page — the failure mode of an OFFSET page.
    this.selectNextPage = db.prepare<[string, string, string, number], ClientRow>(
      `SELECT ${CLIENT_COLUMNS} FROM clients
        WHERE created_at < ? OR (created_at = ? AND id < ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )

    // **A save never moves `events_created_in_period` unless the period itself moved.** The
    // counter is written by `SqliteEventRepository.createWithOwner` and by nothing else; a
    // `Client` read before two creations and saved after them carries a stale count, and
    // writing it back would hand both slots over. The one exception is a renewal — a changed
    // `period_started_at`, which `Client.withCeilings` pairs with a reset to zero — where the
    // incoming counter is the point of the save. (`clients.` names the stored row in an
    // upsert's update list; a bare column would too, and this reads as what it means.)
    this.upsert = db.prepare<ClientParams>(
      `INSERT INTO clients (id, name, contact_email, created_at, suspended_at, purge_after,
                            max_events, max_total_bytes, max_event_quota_bytes,
                            max_retention_days, retention_cap_since, clips_allowed,
                            live_allowed, max_live_days, max_events_per_period,
                            period_started_at, events_created_in_period, locale)
            VALUES (@id, @name, @contactEmail, @createdAt, @suspendedAt, @purgeAfter,
                    @maxEvents, @maxTotalBytes, @maxEventQuotaBytes, @maxRetentionDays,
                    @retentionCapSince, @clipsAllowed, @liveAllowed, @maxLiveDays,
                    @maxEventsPerPeriod, @periodStartedAt, @eventsCreatedInPeriod, @locale)
       ON CONFLICT (id) DO UPDATE SET name                     = excluded.name,
                                      created_at                = excluded.created_at,
                                      contact_email             = excluded.contact_email,
                                      suspended_at              = excluded.suspended_at,
                                      purge_after               = excluded.purge_after,
                                      max_events                = excluded.max_events,
                                      max_total_bytes           = excluded.max_total_bytes,
                                      max_event_quota_bytes     = excluded.max_event_quota_bytes,
                                      max_retention_days        = excluded.max_retention_days,
                                      retention_cap_since       = excluded.retention_cap_since,
                                      clips_allowed             = excluded.clips_allowed,
                                      live_allowed              = excluded.live_allowed,
                                      max_live_days             = excluded.max_live_days,
                                      max_events_per_period     = excluded.max_events_per_period,
                                      period_started_at         = excluded.period_started_at,
                                      events_created_in_period  = CASE
                                        WHEN excluded.period_started_at IS NOT clients.period_started_at
                                        THEN excluded.events_created_in_period
                                        ELSE clients.events_created_in_period
                                      END,
                                      locale                    = excluded.locale`,
    )

    this.selectMembershipsForUser = db.prepare<[string], MembershipRow>(
      `SELECT client_id, user_id, role, granted_at
         FROM client_members
        WHERE user_id = ?
        ORDER BY granted_at DESC, client_id`,
    )

    this.selectMemberRole = db.prepare<[string, string], RoleRow>(
      `SELECT role FROM client_members WHERE client_id = ? AND user_id = ?`,
    )

    // `granted_at` is replaced along with the role, like `event_memberships`: a re-grant
    // is a fresh decision.
    this.upsertMembership = db.prepare<[string, string, string, string]>(
      `INSERT INTO client_members (client_id, user_id, role, granted_at)
            VALUES (?, ?, ?, ?)
       ON CONFLICT (client_id, user_id) DO UPDATE SET role       = excluded.role,
                                                      granted_at = excluded.granted_at`,
    )

    this.deleteMembership = db.prepare<[string, string]>(
      `DELETE FROM client_members WHERE client_id = ? AND user_id = ?`,
    )

    this.selectContextForEvent = db.prepare<[string], ContextRow>(
      `SELECT c.id AS client_id, c.max_events, c.max_total_bytes, c.max_event_quota_bytes,
              c.max_retention_days, c.clips_allowed, c.live_allowed, c.max_live_days,
              c.max_events_per_period, c.period_started_at, c.suspended_at
         FROM events e
         JOIN clients c ON c.id = e.client_id
        WHERE e.id = ?`,
    )

    // Atomic with the emptiness check: a plain DELETE a caller is trusted to have
    // guarded first would race a membership or an event being created between the
    // check and the delete. `events.client_id` is ON DELETE RESTRICT besides, so a
    // non-empty client could not be deleted even if this clause were missing — this is
    // what turns that hard failure into a clean "false" the use case can report as
    // `client.notEmpty`.
    this.deleteIfEmptyStatement = db.prepare<[string]>(
      `DELETE FROM clients
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM client_members WHERE client_id = clients.id)
          AND NOT EXISTS (SELECT 1 FROM events WHERE client_id = clients.id)`,
    )
  }

  async save(client: Client): Promise<void> {
    this.upsert.run(toParams(client))
  }

  async findById(id: ClientId): Promise<Client | null> {
    const row = this.selectById.get(id)
    return row === undefined ? null : toClient(row)
  }

  async list(page: { readonly after?: ClientId; readonly limit: number }): Promise<ClientPage> {
    const rows =
      page.after === undefined
        ? this.selectFirstPage.all(page.limit + 1)
        : this.pageAfter(page.after, page.limit)

    const hasMore = rows.length > page.limit
    const items = (hasMore ? rows.slice(0, page.limit) : rows).map(toClient)
    const last = items[items.length - 1]
    return { items, next: hasMore && last !== undefined ? last.id : null }
  }

  /** An unknown cursor yields an empty page rather than silently restarting from the top. */
  private pageAfter(after: ClientId, limit: number): readonly ClientRow[] {
    const cursor = this.selectCursor.get(after)
    if (cursor === undefined) return []
    return this.selectNextPage.all(cursor.created_at, cursor.created_at, cursor.id, limit + 1)
  }

  async membershipsForUser(userId: UserId): Promise<readonly ClientMembership[]> {
    return this.selectMembershipsForUser.all(userId).map(toMembership)
  }

  async memberRole(clientId: ClientId, userId: UserId): Promise<ClientRole | null> {
    const row = this.selectMemberRole.get(clientId, userId)
    return row === undefined ? null : clientRoleOf(row.role)
  }

  async grantMember(membership: ClientMembership): Promise<void> {
    this.upsertMembership.run(
      membership.clientId,
      membership.userId,
      membership.role,
      toIsoText(membership.grantedAt),
    )
  }

  async revokeMember(clientId: ClientId, userId: UserId): Promise<void> {
    this.deleteMembership.run(clientId, userId)
  }

  async contextForEvent(eventId: EventId): Promise<ClientEventContext | null> {
    const row = this.selectContextForEvent.get(eventId)
    if (row === undefined) return null
    return {
      clientId: asClientId(row.client_id),
      ceilings: ClientCeilings.restore(toCeilingsProps(row)),
      suspended: row.suspended_at !== null,
    }
  }

  async deleteIfEmpty(id: ClientId): Promise<boolean> {
    return this.deleteIfEmptyStatement.run(id).changes > 0
  }
}
