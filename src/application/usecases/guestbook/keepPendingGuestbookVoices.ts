import { AuditEntry } from '../../../domain/audit/auditEntry'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import type { PhotoActor, Reviewer } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * "Garder les N messages en attente": publish every voice message that is waiting for a decision
 * and is ready, in one act (spec 25, section 3 bis and question 20).
 *
 * It exists for voices alone. Two hundred recordings of thirty seconds are over an hour and a half
 * of listening, and the wedding's defaults (voice on, moderation `manual`) turn every one of them
 * into a decision: a host who takes only half would otherwise **lose the rest at the purge**, which
 * keeps only what is published. Listening stays allowed and is never required (rule 9), so the
 * console asks "you have not listened to all of these: keep them in the album?" before it calls.
 * There is no such action for written messages (`moderateBulk` is not called on the Messages tab).
 *
 * - **A moderator's**, like a single decision: `moderate`, then the client and the event's state.
 * - **Ready voices only.** A recording still processing has nothing to listen to and is not
 *   decidable (`GuestbookEntry.transitionTo` refuses it); a failed one is not in the book. A
 *   written message and a voice already decided (published, refused, anything but `pending`) are not
 *   touched, and a refused voice stays refused.
 * - **Idempotent and quiet when there is nothing to do**: `kept: 0` writes no audit line, retires no
 *   archive and says nothing on the bus, as a second tap should not.
 * - The archive is retired **before** the first decision, since a published voice enters it, and the
 *   audit line is written first (write-ahead), with the number and never a name or a word.
 */

export interface KeepPendingGuestbookVoicesInput {
  readonly eventId: EventId
  readonly actor: PhotoActor
}

export interface KeepPendingGuestbookVoicesDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly memberships: MembershipRepository
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
  readonly invalidateExport: InvalidateExport
}

export interface KeptGuestbookVoices {
  /** How many ready voices went from `pending` to `published`. */
  readonly kept: number
}

export type KeepPendingGuestbookVoices = (
  input: KeepPendingGuestbookVoicesInput,
) => Promise<Result<KeptGuestbookVoices, DomainError>>

export const makeKeepPendingGuestbookVoices =
  ({
    events,
    guestbook,
    memberships,
    audit,
    bus,
    clock,
    invalidateExport,
  }: KeepPendingGuestbookVoicesDeps): KeepPendingGuestbookVoices =>
  async ({ eventId, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const allowed = await requireEventRole(memberships, eventId, actor.userId, 'moderate')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.notModeratable', { status: event.status }))
    }

    const waiting = await guestbook.listByStatuses(eventId, ['pending'], MAX_ENTRIES_PER_EVENT)

    const now = clock.now()
    const reviewer: Reviewer = { kind: 'host', userId: actor.userId }

    // Every decision is built, and so judged, before anything is written. **The entity is the one
    // judge of "ready"**: it refuses a decision on a recording still being processed
    // (`guestbook.voiceNotReady`), and such a one is left as it is, not counted and not an error. A
    // written message is not a voice and is not this act's.
    const decided = []
    for (const entry of waiting) {
      if (entry.voice === null) continue
      const moved = entry.publish(reviewer, now)
      if (!moved.ok) continue
      decided.push(moved.value)
    }
    if (decided.length === 0) return ok({ kept: 0 })

    const line = AuditEntry.create({
      at: now,
      actor: { kind: 'member', userId: actor.userId },
      action: 'event.voicesKept',
      subject: { type: 'event', id: event.id },
      clientId: event.clientId,
      details: { kept: decided.length },
    })
    if (!line.ok) return line
    await audit.record(line.value)

    // Before the first one is published: the archive must never be sealed without what it holds.
    await invalidateExport(eventId, 'guestbookChanged')
    for (const entry of decided) await guestbook.save(entry)

    bus.publish({ type: 'guestbook.voice', eventId })
    return ok({ kept: decided.length })
  }
