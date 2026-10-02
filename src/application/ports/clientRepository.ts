import type { Client } from '../../domain/clients/client'
import type { ClientCeilings } from '../../domain/clients/clientCeilings'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'

/**
 * Who manages a client's account, as opposed to who is a member of one of its events.
 *
 * A `ClientRole` is a different vocabulary from `EventRole` for the same reason
 * `SiteRole` is: ranking the three together is exactly the matrix roadmap §10.1 refuses
 * to build. An `owner` here can invite another member and rename the client; a `member`
 * can sign in to the client's events as whatever `EventRole` those events separately
 * grant them. Neither grants anything inside an event on its own — `client_members` is
 * the client's own roster, `event_memberships` is still the only table authorization
 * reads from for a single event.
 */
export const CLIENT_ROLES = ['owner', 'member'] as const
export type ClientRole = (typeof CLIENT_ROLES)[number]

export interface ClientMembership {
  readonly clientId: ClientId
  readonly userId: UserId
  readonly role: ClientRole
  readonly grantedAt: Date
}

/** One page of a keyset-paginated listing, newest client first. */
export interface ClientPage {
  readonly items: readonly Client[]
  /** The cursor for the next page, or `null` when this was the last one. */
  readonly next: ClientId | null
}

/**
 * The ceilings in force for one event, read by its `client_id` — the shape every write
 * path on the upload and lifecycle routes asks for (roadmap §10.5 / P3-06), once those
 * routes exist. `suspended` is carried alongside rather than folded into `ceilings`
 * because a suspension refuses a write outright; it is not one more number to compare.
 */
export interface ClientEventContext {
  readonly clientId: ClientId
  readonly ceilings: ClientCeilings
  readonly suspended: boolean
}

/**
 * Clients as records, not a convention (roadmap §10.2): the account that owns zero or
 * more events, with a lifecycle and a set of ceilings of its own.
 *
 * Every event-scoped ceiling check this product will ever make — the byte quota, the
 * event count, whether an event may go live — reads `contextForEvent`, once G2-04/P3-05
 * attaches `events.client_id`. This port does not enforce any of that itself: it is
 * storage, and the arithmetic is `ClientCeilings`'s.
 */
export interface ClientRepository {
  /** Insert or update. */
  save(client: Client): Promise<void>

  findById(id: ClientId): Promise<Client | null>

  /** Newest first, keyset-paginated so an operator console can page through every client. */
  list(page: { readonly after?: ClientId; readonly limit: number }): Promise<ClientPage>

  /** Every client account the user belongs to, most recently granted first. */
  membershipsForUser(userId: UserId): Promise<readonly ClientMembership[]>

  /** `null` when the user is not a member of this client's account. */
  memberRole(clientId: ClientId, userId: UserId): Promise<ClientRole | null>

  /** Insert or update the role, like `MembershipRepository.grant`. */
  grantMember(membership: ClientMembership): Promise<void>

  /** Idempotent: revoking a membership that is already gone is not an error. */
  revokeMember(clientId: ClientId, userId: UserId): Promise<void>

  /**
   * The ceilings in force for the client that owns this event, or `null` when the event
   * has no client (every event on today's free-tier install, and the operator's own).
   */
  contextForEvent(eventId: EventId): Promise<ClientEventContext | null>

  /**
   * Deletes the client **only** if it has no member and no event, atomically with that
   * check — never a plain `DELETE` a caller is trusted to have guarded. `false` means the
   * client was not empty; it is also what a client that no longer exists reports, which is
   * why `deleteEmptyClient` reads `findById` first for the 404 and reads this result only
   * for "is it empty".
   */
  deleteIfEmpty(id: ClientId): Promise<boolean>
}
