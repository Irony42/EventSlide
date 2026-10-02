import type { ClientCeilingsProps } from '../clients/clientCeilings'
import { CLIENT_ROLES, type ClientRole } from '../clients/clientRole'
import { EVENT_STATUSES, type EventStatus } from '../events/eventStatus'
import type { ClientId, EventId, UserId } from '../shared/ids'
import { SITE_ROLES, type SiteRole } from '../users/siteRole'
import { field, type FieldShape } from './overviewShape'

/**
 * What the operator is allowed to see of the box (docs/ROADMAP.md §10.4; paid plan P3-12).
 *
 * Three kinds of row — a client, one of its events, an account — and for each, both the
 * TypeScript type and the {@link FieldShape} that is its runtime twin. **They are written
 * next to each other on purpose.** A TypeScript type is erased before a test can look at
 * it, so "the overview type carries no content field" can only be a test if the type has a
 * runtime shadow, and the shadow is bound to the type by `satisfies ShapeOf<…>`: add a
 * member to a row type and `tsc` refuses the shape until it names the new field; name a
 * field in the shape that the type lacks and it refuses that too. What the shadow then says
 * about each field is checked by `siteOverviewRows.test.ts` (the free-text fields are an
 * explicit list) and applied to real adapters' output by `siteOverviewContract.ts`.
 *
 * ## What is deliberately not here
 *
 * - **An event's name, slug and join code** (D-06): the name is the client's own data, and
 *   the slug leads to the public wall. The operator identifies an event by its id, its
 *   status, its dates and its sizes, and no more.
 * - **Anything a guest or a photograph carries**: no photograph id, no digest, no caption,
 *   no guest, no display name, no mission prompt. An event's *size* is a count and a byte
 *   sum; what is in it is not the operator's to read (§10.6 is the time-boxed, announced,
 *   audited door for that, and it is a different item).
 * - **A hash or a token of any kind**, an account's display name, a client's contact
 *   address. An account is identified by its address and nothing else a person typed.
 *
 * The two `label` fields are the only free text. They are named in the test, not here, so
 * that adding a third is a change to a list somebody has to approve.
 */

/** A client's footprint on the box. Counts and bytes only. */
export interface SiteClientUsage {
  /** Events of every status, drafts and archives included: what `max_events` counts. */
  readonly eventCount: number
  /** Events in the `live` status right now. */
  readonly liveEventCount: number
  /** Accounts on the client's own roster (`client_members`). */
  readonly memberCount: number
  /**
   * What the client's events have spent together, summed the way the upload paths enforce
   * `max_total_bytes` (`clientHoldingBytesSum`): photographs and clips of every status plus
   * the staged source of every clip still waiting to be transcoded.
   */
  readonly usedBytes: number
}

export interface SiteClientRow {
  readonly id: ClientId
  /** The client's own name for itself: `clients.name`, the one thing the console must print. */
  readonly name: string
  readonly createdAt: Date
  /** Set while the client is suspended (§10.7). */
  readonly suspendedAt: Date | null
  /** Set by offboarding: the instant the client's remaining media may be purged. */
  readonly purgeAfter: Date | null
  readonly ceilings: ClientCeilingsProps
  /** The per-period counter, which never decreases when an event is deleted. */
  readonly eventsCreatedInPeriod: number
  readonly usage: SiteClientUsage
}

export interface SiteEventRow {
  readonly id: EventId
  readonly status: EventStatus
  readonly createdAt: Date
  readonly startsAt: Date | null
  /** The first time it went live. */
  readonly openedAt: Date | null
  readonly closedAt: Date | null
  readonly quotaBytes: number
  /** The admission figure: what the upload path measures against `quotaBytes`. */
  readonly usedBytes: number
  /** Rows in the album, photographs and clips of every status. */
  readonly photoCount: number
}

export interface SiteAccountClient {
  readonly clientId: ClientId
  readonly role: ClientRole
}

export interface SiteAccountRow {
  readonly id: UserId
  /** The address the account signs in with: how an operator recognises a person. */
  readonly email: string
  readonly siteRole: SiteRole
  readonly createdAt: Date
  readonly lastLoginAt: Date | null
  readonly disabledAt: Date | null
  readonly mustChangePassword: boolean
  /** Events the account owns, whichever client they answer to: what blocks its deletion. */
  readonly ownedEventCount: number
  /** The client accounts it belongs to, most recently granted first. */
  readonly clients: readonly SiteAccountClient[]
}

/** A field per member of `T`, none optional: the compiler checks both directions. */
type ShapeOf<T> = { readonly [K in keyof T]-?: FieldShape }

const USAGE_FIELDS = {
  eventCount: field.count,
  liveEventCount: field.count,
  memberCount: field.count,
  usedBytes: field.count,
} satisfies ShapeOf<SiteClientUsage>

const CEILINGS_FIELDS = {
  maxEvents: field.nullable(field.count),
  maxTotalBytes: field.nullable(field.count),
  maxEventQuotaBytes: field.nullable(field.count),
  maxRetentionDays: field.nullable(field.count),
  clipsAllowed: field.flag,
  liveAllowed: field.flag,
  maxLiveDays: field.nullable(field.count),
  maxEventsPerPeriod: field.nullable(field.count),
  periodStartedAt: field.nullable(field.instant),
} satisfies ShapeOf<ClientCeilingsProps>

const CLIENT_FIELDS = {
  id: field.id,
  name: field.label("the client's own name, which the console must print to be usable"),
  createdAt: field.instant,
  suspendedAt: field.nullable(field.instant),
  purgeAfter: field.nullable(field.instant),
  ceilings: field.object(CEILINGS_FIELDS),
  eventsCreatedInPeriod: field.count,
  usage: field.object(USAGE_FIELDS),
} satisfies ShapeOf<SiteClientRow>

const EVENT_FIELDS = {
  id: field.id,
  status: field.oneOf(EVENT_STATUSES),
  createdAt: field.instant,
  startsAt: field.nullable(field.instant),
  openedAt: field.nullable(field.instant),
  closedAt: field.nullable(field.instant),
  quotaBytes: field.count,
  usedBytes: field.count,
  photoCount: field.count,
} satisfies ShapeOf<SiteEventRow>

const ACCOUNT_FIELDS = {
  id: field.id,
  email: field.label('the address an operator recognises an account by, to disable or assist it'),
  siteRole: field.oneOf(SITE_ROLES),
  createdAt: field.instant,
  lastLoginAt: field.nullable(field.instant),
  disabledAt: field.nullable(field.instant),
  mustChangePassword: field.flag,
  ownedEventCount: field.count,
  clients: field.list(
    field.object({
      clientId: field.id,
      role: field.oneOf(CLIENT_ROLES),
    } satisfies ShapeOf<SiteAccountClient>),
  ),
} satisfies ShapeOf<SiteAccountRow>

export const SITE_CLIENT_ROW_SHAPE: FieldShape = field.object(CLIENT_FIELDS)
export const SITE_EVENT_ROW_SHAPE: FieldShape = field.object(EVENT_FIELDS)
export const SITE_ACCOUNT_ROW_SHAPE: FieldShape = field.object(ACCOUNT_FIELDS)

/** Every row an overview can hand out, by name, for a sweep that wants all of them. */
export const SITE_OVERVIEW_SHAPES = {
  client: SITE_CLIENT_ROW_SHAPE,
  event: SITE_EVENT_ROW_SHAPE,
  account: SITE_ACCOUNT_ROW_SHAPE,
} as const

export type SiteOverviewRowKind = keyof typeof SITE_OVERVIEW_SHAPES
