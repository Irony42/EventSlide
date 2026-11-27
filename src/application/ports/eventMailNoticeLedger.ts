import type { NoticeKind } from '../../domain/notices/noticeKind'
import type { EventId } from '../../domain/shared/ids'

/**
 * Which notices the box has already served for an event (spec 32, ADR 0019): one row per
 * `(event, kind, key)`, the key being what makes one notice of its kind unique (`7@<date>` for the warning
 * before the replies are erased, `full@120` for the house being full, `book@<requested_at>` for a book).
 *
 * **`note` is the decision, not a record of it.** It is conditional and answers `true` to the one write that
 * placed the row, so when the retention timer and `npm run purge` run at the same moment (the sweeper's
 * lock holds only inside one process) exactly one of them sends. It is called **before** the mail is
 * handed to the relay (rule 9): a crash in between loses a mail and never sends two. A notice that is
 * stale, or whose recipients all switched the family off, is noted without being sent, so it is not
 * looked at again.
 *
 * Nothing personal is in it, and it goes with its event (`ON DELETE CASCADE`). Nothing here is an
 * authority: it changes what a host is told, never what a request may do.
 */
export interface EventMailNoticeLedger {
  /**
   * Notes the notice as served. `true` when **this call** wrote the row; `false` when it was already
   * there, or when the event does not exist (nothing is recorded for one). Refuses (rejects) a `kind`
   * the domain does not know: the table has no `CHECK` on it, so the vocabulary is judged here.
   */
  note(eventId: EventId, kind: NoticeKind, key: string, at: Date): Promise<boolean>

  /** Whether the notice was already noted. */
  has(eventId: EventId, kind: NoticeKind, key: string): Promise<boolean>
}
