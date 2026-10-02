import type Database from 'better-sqlite3'
import type {
  SiteAccountPage,
  SiteClientPage,
  SiteEventPage,
  SiteOverview,
  SitePageRequest,
} from '../../application/ports/siteOverview'
import { isClientRole } from '../../domain/clients/clientRole'
import { isEventStatus } from '../../domain/events/eventStatus'
import { asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'
import type {
  SiteAccountClient,
  SiteAccountRow,
  SiteClientRow,
  SiteEventRow,
} from '../../domain/site/siteOverviewRows'
import { isSiteRole } from '../../domain/users/siteRole'
import { clientHoldingBytesSum, eventHoldingBytesSum } from './clipJobStatusSql'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, fromSqliteBoolean } from './rowMapping'

/**
 * `SiteOverview` over SQLite (roadmap §10.4; paid plan P3-12, D-06).
 *
 * **The operator's console must not be one forgotten `omit` away from a client's wedding.**
 * So this adapter is built the other way round from the repositories beside it: it does not
 * read an entity and drop what it should not show, it reads *only the columns it declares*.
 * Every statement below is listed in {@link SITE_OVERVIEW_QUERIES} with the `table.column`
 * pairs it reads, and `sqliteSiteOverview.queries.test.ts` compares the SQL text of each to
 * its list in both directions: a column the SQL touches that the list does not name fails,
 * a column the list names that the SQL no longer touches fails, and a short list of
 * content-bearing columns — `events.name`, `events.slug`, `events.join_code`,
 * `events.settings`, `photos.caption`, `guests.display_name`, `event_missions.prompt`, every
 * digest and hash, `users.display_name` — fails whichever list it is found in. The columns
 * that carry free text *and are allowed* are exactly two: `clients.name` and `users.email`
 * (the labels declared in `domain/site/siteOverviewRows.ts`).
 *
 * That is a second line behind the contract's content sweep, not a substitute for it: the
 * list says what the SQL reads, the sweep says what comes out.
 *
 * ## The bytes
 *
 * `used_bytes` is built from `eventHoldingBytesSum` and `clientHoldingBytesSum`, the very
 * fragments the upload paths enforce the quota with, so the number the operator reads is the
 * number a guest is refused against. `eventBytesSum.test.ts` holds this reader to it too.
 *
 * ## Paging
 *
 * Keyset on `(created_at, id)`, newest first, like `SqliteClientRepository.list` and for the
 * same reason: a client created while an operator is paging neither duplicates a row nor
 * pushes one off the page. An unknown cursor — or, for events, one that names another
 * client's event — is an empty page.
 */

export interface DeclaredQuery {
  readonly sql: string
  /** `table.column`, for every column the statement reads in any clause. */
  readonly reads: readonly string[]
}

const CLIENT_ORDER = `ORDER BY c.created_at DESC, c.id DESC LIMIT :limit`
const EVENT_ORDER = `ORDER BY e.created_at DESC, e.id DESC LIMIT :limit`
const ACCOUNT_ORDER = `ORDER BY u.created_at DESC, u.id DESC LIMIT :limit`

const CLIENT_SELECT = `SELECT c.id, c.name, c.created_at, c.suspended_at, c.purge_after,
       c.max_events, c.max_total_bytes, c.max_event_quota_bytes, c.max_retention_days,
       c.clips_allowed, c.live_allowed, c.max_live_days, c.max_events_per_period,
       c.period_started_at, c.events_created_in_period,
       (SELECT COUNT(*) FROM events ev WHERE ev.client_id = c.id)                AS event_count,
       (SELECT COUNT(*) FROM events ev
         WHERE ev.client_id = c.id AND ev.status = 'live')                       AS live_event_count,
       (SELECT COUNT(*) FROM client_members m WHERE m.client_id = c.id)          AS member_count,
       ${clientHoldingBytesSum('c.id')}                                          AS used_bytes
  FROM clients c`

const EVENT_SELECT = `SELECT e.id, e.status, e.created_at, e.starts_at, e.opened_at, e.closed_at,
       e.quota_bytes,
       (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id)                   AS photo_count,
       ${eventHoldingBytesSum('e.id')}                                           AS used_bytes
  FROM events e`

const ACCOUNT_SELECT = `SELECT u.id, u.email, u.site_role, u.created_at, u.last_login_at,
       u.disabled_at, u.must_change_password,
       (SELECT COUNT(*) FROM events ev WHERE ev.owner_id = u.id)                 AS owned_event_count
  FROM users u`

/** What `clientHoldingBytesSum` / `eventHoldingBytesSum` read, for the lists below. */
const EVENT_BYTES_READS = [
  'photos.event_id',
  'photos.byte_size',
  'clip_jobs.event_id',
  'clip_jobs.status',
  'clip_jobs.source_byte_size',
] as const

const CLIENT_READS = [
  'clients.id',
  'clients.name',
  'clients.created_at',
  'clients.suspended_at',
  'clients.purge_after',
  'clients.max_events',
  'clients.max_total_bytes',
  'clients.max_event_quota_bytes',
  'clients.max_retention_days',
  'clients.clips_allowed',
  'clients.live_allowed',
  'clients.max_live_days',
  'clients.max_events_per_period',
  'clients.period_started_at',
  'clients.events_created_in_period',
  'events.id',
  'events.client_id',
  'events.status',
  'client_members.client_id',
  ...EVENT_BYTES_READS,
] as const

const EVENT_READS = [
  'events.id',
  'events.client_id',
  'events.status',
  'events.created_at',
  'events.starts_at',
  'events.opened_at',
  'events.closed_at',
  'events.quota_bytes',
  'photos.event_id',
  ...EVENT_BYTES_READS,
] as const

const ACCOUNT_READS = [
  'users.id',
  'users.email',
  'users.site_role',
  'users.created_at',
  'users.last_login_at',
  'users.disabled_at',
  'users.must_change_password',
  'events.owner_id',
] as const

/**
 * Every statement this adapter prepares, with the columns it is allowed to read.
 *
 * Exported for the test that compares each `sql` to its `reads`; nothing else should import
 * it. **Adding a column to a query means adding it here, in the same diff** — which is the
 * point: it is a line a reviewer cannot miss, with the table spelled out, in a file whose
 * header says what may never be on it.
 */
export const SITE_OVERVIEW_QUERIES = {
  clientsFirst: { sql: `${CLIENT_SELECT} ${CLIENT_ORDER}`, reads: CLIENT_READS },
  clientsAfter: {
    sql: `${CLIENT_SELECT}
 WHERE c.created_at < :cursorAt OR (c.created_at = :cursorAt AND c.id < :cursorId)
 ${CLIENT_ORDER}`,
    reads: CLIENT_READS,
  },
  clientCursor: {
    sql: `SELECT c.created_at, c.id FROM clients c WHERE c.id = :id`,
    reads: ['clients.created_at', 'clients.id'],
  },
  // The existence probe for `clientEvents`: a client with no event is not an unknown client.
  clientExists: {
    sql: `SELECT c.id FROM clients c WHERE c.id = :id`,
    reads: ['clients.id'],
  },
  eventsFirst: {
    sql: `${EVENT_SELECT}
 WHERE e.client_id = :clientId
 ${EVENT_ORDER}`,
    reads: EVENT_READS,
  },
  eventsAfter: {
    sql: `${EVENT_SELECT}
 WHERE e.client_id = :clientId
   AND (e.created_at < :cursorAt OR (e.created_at = :cursorAt AND e.id < :cursorId))
 ${EVENT_ORDER}`,
    reads: EVENT_READS,
  },
  // Scoped to the client, so a cursor naming another client's event finds nothing.
  eventCursor: {
    sql: `SELECT e.created_at, e.id FROM events e WHERE e.id = :id AND e.client_id = :clientId`,
    reads: ['events.created_at', 'events.id', 'events.client_id'],
  },
  accountsFirst: { sql: `${ACCOUNT_SELECT} ${ACCOUNT_ORDER}`, reads: ACCOUNT_READS },
  accountsAfter: {
    sql: `${ACCOUNT_SELECT}
 WHERE u.created_at < :cursorAt OR (u.created_at = :cursorAt AND u.id < :cursorId)
 ${ACCOUNT_ORDER}`,
    reads: ACCOUNT_READS,
  },
  accountCursor: {
    sql: `SELECT u.created_at, u.id FROM users u WHERE u.id = :id`,
    reads: ['users.created_at', 'users.id'],
  },
  // The account list's second query: the memberships of exactly the accounts on the page.
  accountMemberships: {
    sql: `SELECT m.user_id, m.client_id, m.role
  FROM client_members m
 WHERE m.user_id IN (SELECT value FROM json_each(:userIds))
 ORDER BY m.granted_at DESC, m.client_id ASC`,
    reads: [
      'client_members.user_id',
      'client_members.client_id',
      'client_members.role',
      'client_members.granted_at',
    ],
  },
} as const satisfies Readonly<Record<string, DeclaredQuery>>

// ------------------------------------------------------------------------ rows --

interface ClientSqlRow {
  readonly id: string
  readonly name: string
  readonly created_at: string
  readonly suspended_at: string | null
  readonly purge_after: string | null
  readonly max_events: number | null
  readonly max_total_bytes: number | null
  readonly max_event_quota_bytes: number | null
  readonly max_retention_days: number | null
  readonly clips_allowed: number
  readonly live_allowed: number
  readonly max_live_days: number | null
  readonly max_events_per_period: number | null
  readonly period_started_at: string | null
  readonly events_created_in_period: number
  readonly event_count: number
  readonly live_event_count: number
  readonly member_count: number
  readonly used_bytes: number
}

interface EventSqlRow {
  readonly id: string
  readonly status: string
  readonly created_at: string
  readonly starts_at: string | null
  readonly opened_at: string | null
  readonly closed_at: string | null
  readonly quota_bytes: number
  readonly photo_count: number
  readonly used_bytes: number
}

interface AccountSqlRow {
  readonly id: string
  readonly email: string
  readonly site_role: string
  readonly created_at: string
  readonly last_login_at: string | null
  readonly disabled_at: string | null
  readonly must_change_password: number
  readonly owned_event_count: number
}

interface MembershipSqlRow {
  readonly user_id: string
  readonly client_id: string
  readonly role: string
}

interface CursorSqlRow {
  readonly created_at: string
  readonly id: string
}

const corrupt = (column: string, detail: string): Error =>
  new Error(`Corrupt ${column} in the database: ${detail}`)

const toClientRow = (row: ClientSqlRow): SiteClientRow => ({
  id: asClientId(row.id),
  name: row.name,
  createdAt: fromIsoText(row.created_at),
  suspendedAt: fromNullableIsoText(row.suspended_at),
  purgeAfter: fromNullableIsoText(row.purge_after),
  ceilings: {
    maxEvents: row.max_events,
    maxTotalBytes: row.max_total_bytes,
    maxEventQuotaBytes: row.max_event_quota_bytes,
    maxRetentionDays: row.max_retention_days,
    clipsAllowed: fromSqliteBoolean(row.clips_allowed),
    liveAllowed: fromSqliteBoolean(row.live_allowed),
    maxLiveDays: row.max_live_days,
    maxEventsPerPeriod: row.max_events_per_period,
    periodStartedAt: fromNullableIsoText(row.period_started_at),
  },
  eventsCreatedInPeriod: row.events_created_in_period,
  usage: {
    eventCount: row.event_count,
    liveEventCount: row.live_event_count,
    memberCount: row.member_count,
    usedBytes: row.used_bytes,
  },
})

const toEventRow = (row: EventSqlRow): SiteEventRow => {
  if (!isEventStatus(row.status)) throw corrupt('events.status', row.status)
  return {
    id: asEventId(row.id),
    status: row.status,
    createdAt: fromIsoText(row.created_at),
    startsAt: fromNullableIsoText(row.starts_at),
    openedAt: fromNullableIsoText(row.opened_at),
    closedAt: fromNullableIsoText(row.closed_at),
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    photoCount: row.photo_count,
  }
}

const toAccountRow = (
  row: AccountSqlRow,
  clients: readonly SiteAccountClient[],
): SiteAccountRow => {
  if (!isSiteRole(row.site_role)) throw corrupt('users.site_role', row.site_role)
  return {
    id: asUserId(row.id),
    email: row.email,
    siteRole: row.site_role,
    createdAt: fromIsoText(row.created_at),
    lastLoginAt: fromNullableIsoText(row.last_login_at),
    disabledAt: fromNullableIsoText(row.disabled_at),
    mustChangePassword: fromSqliteBoolean(row.must_change_password),
    ownedEventCount: row.owned_event_count,
    clients,
  }
}

const toAccountClient = (row: MembershipSqlRow): SiteAccountClient => {
  if (!isClientRole(row.role)) throw corrupt('client_members.role', row.role)
  return { clientId: asClientId(row.client_id), role: row.role }
}

/**
 * `LIMIT -1` is "no limit" in SQLite, `LIMIT 0` is an empty page, and a number past 2^63
 * is a `datatype mismatch` where the fake would return every row; none is what a caller
 * meant, so none is guessed at.
 */
const assertLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`SiteOverview requires a positive integer limit, got ${limit}`)
  }
}

export class SqliteSiteOverview implements SiteOverview {
  private readonly clientsFirst: Database.Statement<{ limit: number }, ClientSqlRow>
  private readonly clientsAfter: Database.Statement<
    { cursorAt: string; cursorId: string; limit: number },
    ClientSqlRow
  >
  private readonly clientCursor: Database.Statement<{ id: string }, CursorSqlRow>
  private readonly eventsFirst: Database.Statement<{ clientId: string; limit: number }, EventSqlRow>
  private readonly eventsAfter: Database.Statement<
    { clientId: string; cursorAt: string; cursorId: string; limit: number },
    EventSqlRow
  >
  private readonly eventCursor: Database.Statement<{ id: string; clientId: string }, CursorSqlRow>
  private readonly accountsFirst: Database.Statement<{ limit: number }, AccountSqlRow>
  private readonly accountsAfter: Database.Statement<
    { cursorAt: string; cursorId: string; limit: number },
    AccountSqlRow
  >
  private readonly accountCursor: Database.Statement<{ id: string }, CursorSqlRow>
  private readonly accountMemberships: Database.Statement<{ userIds: string }, MembershipSqlRow>
  private readonly clientExists: Database.Statement<{ id: string }, { id: string }>

  constructor(db: Db) {
    const q = SITE_OVERVIEW_QUERIES
    this.clientsFirst = db.prepare(q.clientsFirst.sql)
    this.clientsAfter = db.prepare(q.clientsAfter.sql)
    this.clientCursor = db.prepare(q.clientCursor.sql)
    this.eventsFirst = db.prepare(q.eventsFirst.sql)
    this.eventsAfter = db.prepare(q.eventsAfter.sql)
    this.eventCursor = db.prepare(q.eventCursor.sql)
    this.accountsFirst = db.prepare(q.accountsFirst.sql)
    this.accountsAfter = db.prepare(q.accountsAfter.sql)
    this.accountCursor = db.prepare(q.accountCursor.sql)
    this.accountMemberships = db.prepare(q.accountMemberships.sql)
    this.clientExists = db.prepare(q.clientExists.sql)
  }

  async listClients(page: SitePageRequest<ClientId>): Promise<SiteClientPage> {
    assertLimit(page.limit)
    const fetch = page.limit + 1

    let rows: readonly ClientSqlRow[]
    if (page.after === undefined) {
      rows = this.clientsFirst.all({ limit: fetch })
    } else {
      const cursor = this.clientCursor.get({ id: page.after })
      rows =
        cursor === undefined
          ? []
          : this.clientsAfter.all({
              cursorAt: cursor.created_at,
              cursorId: cursor.id,
              limit: fetch,
            })
    }

    return paged(rows, page.limit, toClientRow)
  }

  async clientEvents(
    clientId: ClientId,
    page: SitePageRequest<EventId>,
  ): Promise<SiteEventPage | null> {
    assertLimit(page.limit)
    if (this.clientExists.get({ id: clientId }) === undefined) return null
    const fetch = page.limit + 1

    let rows: readonly EventSqlRow[]
    if (page.after === undefined) {
      rows = this.eventsFirst.all({ clientId, limit: fetch })
    } else {
      const cursor = this.eventCursor.get({ id: page.after, clientId })
      rows =
        cursor === undefined
          ? []
          : this.eventsAfter.all({
              clientId,
              cursorAt: cursor.created_at,
              cursorId: cursor.id,
              limit: fetch,
            })
    }

    return paged(rows, page.limit, toEventRow)
  }

  async listAccounts(page: SitePageRequest<UserId>): Promise<SiteAccountPage> {
    assertLimit(page.limit)
    const fetch = page.limit + 1

    let rows: readonly AccountSqlRow[]
    if (page.after === undefined) {
      rows = this.accountsFirst.all({ limit: fetch })
    } else {
      const cursor = this.accountCursor.get({ id: page.after })
      rows =
        cursor === undefined
          ? []
          : this.accountsAfter.all({
              cursorAt: cursor.created_at,
              cursorId: cursor.id,
              limit: fetch,
            })
    }

    // The page's own accounts only: the second query is handed exactly their ids.
    const onPage = rows.slice(0, page.limit)
    const memberships = this.membershipsOf(onPage.map((row) => row.id))
    return paged(rows, page.limit, (row) => toAccountRow(row, memberships.get(row.id) ?? []))
  }

  private membershipsOf(userIds: readonly string[]): ReadonlyMap<string, SiteAccountClient[]> {
    const byUser = new Map<string, SiteAccountClient[]>()
    if (userIds.length === 0) return byUser

    for (const row of this.accountMemberships.all({ userIds: JSON.stringify(userIds) })) {
      const list = byUser.get(row.user_id) ?? []
      list.push(toAccountClient(row))
      byUser.set(row.user_id, list)
    }
    return byUser
  }
}

/** One extra row was fetched to learn whether there is a next page; it is not returned. */
const paged = <Sql, Row extends { readonly id: Id }, Id extends string>(
  rows: readonly Sql[],
  limit: number,
  toRow: (row: Sql) => Row,
): { readonly items: readonly Row[]; readonly next: Id | null } => {
  const hasMore = rows.length > limit
  const items = (hasMore ? rows.slice(0, limit) : rows).map(toRow)
  const last = items[items.length - 1]
  return { items, next: hasMore && last !== undefined ? last.id : null }
}
