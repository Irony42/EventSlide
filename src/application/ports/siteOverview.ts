import type { ClientId, EventId, UserId } from '../../domain/shared/ids'
import type {
  SiteAccountRow,
  SiteClientRow,
  SiteEventRow,
} from '../../domain/site/siteOverviewRows'

/**
 * One page of a keyset-paginated listing, newest first. `next` is the cursor for the page
 * after this one, or `null` when this was the last.
 */
export interface SitePage<Row, Cursor> {
  readonly items: readonly Row[]
  readonly next: Cursor | null
}

export type SiteClientPage = SitePage<SiteClientRow, ClientId>
export type SiteEventPage = SitePage<SiteEventRow, EventId>
export type SiteAccountPage = SitePage<SiteAccountRow, UserId>

/** A keyset page request. `limit` is a positive integer; `after` is a previous `next`. */
export interface SitePageRequest<Cursor> {
  readonly after?: Cursor
  readonly limit: number
}

/**
 * The operator's view of the box: **a read model with no content in it** (roadmap §10.4;
 * paid plan P3-12, D-06).
 *
 * This is what the operator console (G2-15) and the operator API behind it (`/api/site`,
 * G2-14) present, and it is deliberately not built from the repositories the rest of the
 * product reads. `EventRepository` hands out an `Event` — its name, its slug, its join
 * code; `PhotoRepository` hands out photographs and their captions. A console assembled
 * from those would be one forgotten `omit` away from showing a client's wedding to the
 * person who runs the machine. So this port answers in rows that were *declared* to hold
 * ids, statuses, instants and sizes (`domain/site/siteOverviewRows.ts`), and an adapter is
 * tested by planting content in every place it could come from and sweeping what it
 * returns for it (`contracts/siteOverviewContract.ts`).
 *
 * What an operator may **never** see through this port: a photograph or anything that
 * identifies one, a caption, a guest or a guest's name, an event's name, its slug or its
 * join code, a mission's prompt, a password hash or a token. The port could not return them
 * if it tried; that is the design.
 *
 * ## Properties every implementation has
 *
 * - **Newest first**, by creation instant and then by id, descending. The cursor is the id
 *   of the last row of the previous page; an id that names no row (or, for
 *   {@link SiteOverview.clientEvents}, a row of another client) yields an **empty page**
 *   rather than silently restarting from the top. (So a cursor whose row has been deleted
 *   since the page was drawn ends the listing: the same convention as `ClientRepository.list`,
 *   and a composite `(createdAt, id)` cursor is what would survive it — the wire cursor is
 *   G2-14's to design.)
 * - **A positive safe integer `limit`, or a `RangeError`.** `LIMIT -1` is "no limit" in SQLite
 *   and `LIMIT 0` is an empty page; neither is what a caller meant, and the adapters would
 *   otherwise disagree. The route (G2-14) is what turns a bad query string into a 400.
 * - **`usedBytes` is the admission figure**, the one number the upload path enforces the
 *   quota against: photographs of every status plus the staged source of every clip still
 *   waiting to be transcoded. `eventBytesSum.test.ts` holds every reader to it.
 * - **Read only.** Nothing here writes, so there is no way for an operator's console to
 *   change a client through it; the operator's acts are use cases with an audit trail.
 */
export interface SiteOverview {
  /** Every client of the box, with its ceilings and what it is using. */
  listClients(page: SitePageRequest<ClientId>): Promise<SiteClientPage>

  /**
   * One client's events: id, status, dates and sizes, and nothing a client or a guest
   * wrote. `null` when there is no such client — distinct from a client with no event,
   * which is an empty page — so a route can answer 404 without a second read.
   */
  clientEvents(clientId: ClientId, page: SitePageRequest<EventId>): Promise<SiteEventPage | null>

  /**
   * Every account on the box: how it is recognised (its address), whether it may sign in,
   * and which clients it belongs to. **Never its hash, never its display name.**
   */
  listAccounts(page: SitePageRequest<UserId>): Promise<SiteAccountPage>
}
