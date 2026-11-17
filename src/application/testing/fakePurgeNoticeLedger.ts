import type { PurgeNoticeLevel } from '../../domain/clients/purgeNotice'
import type { EventId } from '../../domain/shared/ids'
import type { PurgeNoticeLedger } from '../ports/purgeNoticeLedger'

/**
 * In-memory `PurgeNoticeLedger`. The foreign key on `event_id` is mirrored by
 * {@link FakePurgeNoticeLedger.withEvents}: a fake that noted a level for an event that does not
 * exist would pass tests the real table would fail.
 */
export class FakePurgeNoticeLedger implements PurgeNoticeLedger {
  private readonly rows = new Map<EventId, { level: PurgeNoticeLevel; at: Date }>()
  private readonly events = new Set<EventId>()
  /** Every `note` call that was accepted, in order, so a test can read what was noted when. */
  readonly noted: { readonly eventId: EventId; readonly level: PurgeNoticeLevel }[] = []

  /** The events that exist, for the foreign key on `event_id`. */
  withEvents(...ids: readonly EventId[]): this {
    for (const id of ids) this.events.add(id)
    return this
  }

  /** When the level was noted, or `undefined`. For a test to look at. */
  notedAt(eventId: EventId): Date | undefined {
    return this.rows.get(eventId)?.at
  }

  async lastLevel(eventId: EventId): Promise<PurgeNoticeLevel | null> {
    return this.rows.get(eventId)?.level ?? null
  }

  async note(eventId: EventId, level: PurgeNoticeLevel, at: Date): Promise<void> {
    if (!this.events.has(eventId)) return
    this.rows.set(eventId, { level, at })
    this.noted.push({ eventId, level })
  }
}
