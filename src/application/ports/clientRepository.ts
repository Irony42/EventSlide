import type { Client } from '../../domain/clients/client'
import type { ClientCeilings } from '../../domain/clients/clientCeilings'
import type { ClientRole } from '../../domain/clients/clientRole'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'

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
 * A client's byte ceiling over **all its events**, as an admission carries it into the
 * transaction that writes (`PhotoAdmissionLimits.clientBytes`, `ClipAdmissionLimits.clientBytes`).
 *
 * The ceiling travels with the batch for the reason the per-event quota does: it belongs to
 * another aggregate and a repository does not interpret one. What the repository adds is
 * the sum **of the client's events**, taken inside the same `.immediate()` transaction as
 * the insert, where nothing can interleave — which is what makes `max_total_bytes` hold
 * when two guests at two events of one client upload at the same moment. `null` in its
 * place means "no ceiling to enforce", and the sum is not even read.
 */
export interface ClientByteLimit {
  readonly clientId: ClientId
  /** `clients.max_total_bytes`. The client's events together may not pass it. */
  readonly maxBytes: number
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

  /**
   * Newest first, keyset-paginated so an operator console can page through every client.
   *
   * `limit` must be a positive integer; the adapters do **not** agree on anything else (a
   * zero reads nothing, SQLite reads everything for a negative), and `listClients` is what
   * guarantees they are never asked.
   */
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

  /**
   * How many events belong to this client, **in any status** (archived and purged-pending
   * included: a client with one archived wedding still has a wedding in it). `0` for a client
   * with none and for one that does not exist.
   *
   * It is the one fact the operator guard asks of the events table (R1, G2-12 / P3-14): an
   * operator's invitation into a client **with events** waits for an owner, and one into a
   * client with none does not. A count and not a list, because nothing here may read what an
   * event holds, and not a boolean because the audit and a test can say how many.
   */
  countEvents(clientId: ClientId): Promise<number>

  /**
   * How many accounts belong to this client, in any role and **whether or not they can sign in
   * today** (a row is a membership, and a switched-off account keeps its row). `0` for a client
   * with none and for one that does not exist.
   *
   * The other fact the operator guard asks (R1): a client with no event but with a member is
   * somebody's account already, and an invitation an operator writes into it (to be an owner
   * beside the customer, or to raise a member to owner) is the same thing R1 exists to stop. A
   * count and not a roster: nothing here reads who the members are.
   */
  countMembers(clientId: ClientId): Promise<number>
}
