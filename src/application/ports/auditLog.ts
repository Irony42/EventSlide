import type { AuditActor } from '../../domain/audit/auditActor'
import type { AuditDetails } from '../../domain/audit/auditDetails'
import type { AuditEntry, AuditSubject } from '../../domain/audit/auditEntry'
import type { ClientId } from '../../domain/shared/ids'

/**
 * One line of the log as it is read back: an entry plus the sequence number the store
 * gave it.
 *
 * Deliberately **looser than the entry that was written**. `action` is a string and not the
 * `AuditAction` union, and `details` is whatever JSON object was stored, because a row
 * written under an older allow-list has to stay readable by a newer build. The allow-list
 * decides what may be *written*; it is not a reason for the operator console to fail to
 * render last year's history after an action was retired.
 */
export interface AuditRecord {
  /** Strictly increasing and never reused, even after a prune. The paging cursor. */
  readonly seq: number
  readonly at: Date
  /** `userId` is `null` once the account has been deleted — that is the erasure. */
  readonly actor: AuditActor
  readonly action: string
  readonly subject: AuditSubject
  readonly clientId: ClientId | null
  readonly details: AuditDetails
}

export interface AuditListFilter {
  /**
   * Only this client's entries. Absent means every entry on the box, which is the
   * operator's view; the client-readable view (G2-16) always passes it, and an entry about
   * one client is never returned for another.
   */
  readonly clientId?: ClientId
  /** Entries with a `seq` strictly below this one: the `next` of the previous page. */
  readonly before?: number
  /** A positive integer. An adapter rejects anything else rather than guessing. */
  readonly limit: number
}

/** One page of a keyset-paginated listing, newest first. */
export interface AuditPage {
  readonly items: readonly AuditRecord[]
  /** The `before` for the next page, or `null` when this was the last one. */
  readonly next: number | null
}

/**
 * The append-only audit log (roadmap §10.8).
 *
 * **There is no update and no delete on this port, and that is the design.** A row is
 * written once and read many times. The single way a row ever leaves is
 * {@link AuditLog.pruneOlderThan}, which only the retention sweep calls (through the
 * `pruneAuditLog` use case, which is the only code that knows how old is too old), and
 * which the database itself refuses from anybody else — see migration 009.
 */
export interface AuditLog {
  /** Appends one entry. There is no way to name its `seq`; the store assigns it. */
  record(entry: AuditEntry): Promise<void>

  /** Newest first, by `seq`. */
  list(filter: AuditListFilter): Promise<AuditPage>

  /**
   * Deletes every entry stamped strictly before `cutoff`, and says how many. An entry
   * stamped exactly at the cutoff stays.
   *
   * `cutoff` is computed by the caller from the **injected** clock. An adapter must never
   * derive it from its own idea of now: rows written at a fixture's fixed instant would
   * become deletable as the calendar advanced.
   *
   * Idempotent. Not for general use: `pruneAuditLog` is the caller, and an adapter that
   * needs a door opened to delete (SQLite's gate row) opens and closes it inside this one
   * call, atomically.
   */
  pruneOlderThan(cutoff: Date): Promise<number>
}

/**
 * What a use case that only *writes* the log is given. Narrower than {@link AuditLog} so
 * that `setClientCeilings` and every use case after it cannot prune, which is not a rule
 * anybody has to remember: the type has no such method.
 */
export type AuditRecorder = Pick<AuditLog, 'record'>
