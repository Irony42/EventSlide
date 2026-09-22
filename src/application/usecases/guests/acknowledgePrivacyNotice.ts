import { privacyNoticeFor, type NoticeForGuest } from '../../../domain/privacy/privacyNotice'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'

/**
 * A guest pressing "J'ai compris" under the privacy notice (roadmap §5.1).
 *
 * Recorded on the guest's own row, which is what the device token names, so the notice is
 * shown **once per device** rather than once per tab: the upload screen's session lives in
 * `sessionStorage` and is gone when the tab closes, while the row is the same phone
 * whenever it comes back.
 *
 * The guest says which revision they read, and it is checked against the notice the
 * configuration produces now (`Guest.acknowledgeNotice`). A mismatch is
 * `409 privacyNotice.outdated`: the host changed a setting while the guest was reading,
 * and the right answer is the new text, not a record that they agreed to the old one.
 *
 * Nothing is announced on the bus. No surface displays who has read the notice, and an
 * invalidation nobody listens for is a signal every projector and console would still
 * receive.
 */

export interface AcknowledgePrivacyNoticeInput {
  readonly eventId: EventId
  readonly guestId: GuestId
  /** The revision the guest's screen showed. Untrusted: compared, never stored as given. */
  readonly revision: string
}

export interface AcknowledgePrivacyNoticeDeps {
  readonly events: EventRepository
  readonly guests: GuestRepository
  readonly clock: Clock
}

export type AcknowledgePrivacyNotice = (
  input: AcknowledgePrivacyNoticeInput,
) => Promise<Result<NoticeForGuest, DomainError>>

export const makeAcknowledgePrivacyNotice =
  ({ events, guests, clock }: AcknowledgePrivacyNoticeDeps): AcknowledgePrivacyNotice =>
  async ({ eventId, guestId, revision }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const guest = await guests.findById(eventId, guestId)
    if (guest === null) return err(DomainError.notFound('guest.notFound'))

    const notice = privacyNoticeFor(event.settings)
    const acknowledged = guest.acknowledgeNotice(notice, revision, clock.now())
    if (!acknowledged.ok) return acknowledged

    // Saved even when nothing changed, because a repeated tap is rare and a branch that
    // skips the write is one more thing that could skip the *first* one.
    await guests.save(acknowledged.value)

    return ok({ notice, acknowledgement: acknowledged.value.noticeAcknowledgementFor(notice) })
  }
