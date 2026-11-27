import { isNoticeKind, type NoticeKind } from '../../domain/notices/noticeKind'
import type { EventId } from '../../domain/shared/ids'
import type { EventMailNoticeLedger } from '../ports/eventMailNoticeLedger'

/**
 * In-memory `EventMailNoticeLedger`. The foreign key on `event_id` is mirrored by
 * {@link FakeEventMailNoticeLedger.withEvents}: a fake that noted a notice for an event that does not exist
 * would pass tests the real table would fail. A kind the domain does not know is refused, as the adapter does.
 */
export class FakeEventMailNoticeLedger implements EventMailNoticeLedger {
  private readonly rows = new Map<string, Date>()
  private readonly events = new Set<EventId>()
  /** Every accepted `note`, in order, so a test reads what was noted when. */
  readonly noted: { readonly eventId: EventId; readonly kind: NoticeKind; readonly key: string }[] =
    []

  /** The events that exist, for the foreign key on `event_id`. */
  withEvents(...ids: readonly EventId[]): this {
    for (const id of ids) this.events.add(id)
    return this
  }

  /** When the notice was noted, or `undefined`. For a test to look at. */
  notedAt(eventId: EventId, kind: NoticeKind, key: string): Date | undefined {
    return this.rows.get(rowKey(eventId, kind, key))
  }

  async note(eventId: EventId, kind: NoticeKind, key: string, at: Date): Promise<boolean> {
    assertKnown(kind)
    if (!this.events.has(eventId)) return false
    const id = rowKey(eventId, kind, key)
    if (this.rows.has(id)) return false
    this.rows.set(id, at)
    this.noted.push({ eventId, kind, key })
    return true
  }

  async has(eventId: EventId, kind: NoticeKind, key: string): Promise<boolean> {
    return this.rows.has(rowKey(eventId, kind, key))
  }
}

const rowKey = (eventId: EventId, kind: NoticeKind, key: string): string =>
  JSON.stringify([eventId, kind, key])

const assertKnown = (kind: string): void => {
  if (!isNoticeKind(kind)) throw new Error(`unknown notice kind: ${kind}`)
}
