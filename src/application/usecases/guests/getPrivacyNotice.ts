import type { NoticeForGuest } from '../../../domain/privacy/privacyNotice'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import { privacyNoticeOf } from './privacyNoticeOf'

/**
 * The privacy notice in force at an event, and whether this guest has read it
 * (roadmap §5.1).
 *
 * A read of its own, beside the copy the join response carries, because the join is a
 * snapshot and the notice is not: a host who changes retention at 22:00 has changed what
 * happens to the next photo of a guest who joined at 19:00, and that guest's phone only
 * finds out by asking. The upload screen asks when it opens and whenever it comes back
 * into view.
 *
 * The notice is computed from the event's settings **on every read**, never stored, so
 * there is no copy of it that can drift from the configuration it describes.
 */

export interface GetPrivacyNoticeInput {
  readonly eventId: EventId
  readonly guestId: GuestId
}

export interface GetPrivacyNoticeDeps {
  readonly events: EventRepository
  /** For the retention a client's ceiling makes of the notice. See `privacyNoticeOf`. */
  readonly clients: ClientRepository
  readonly guests: GuestRepository
  /**
   * `OPERATOR_NAME`, or `null` on a box whose operator said nothing (roadmap G2-17). Part of
   * the notice, and so of its revision: the same value must reach every use case that
   * derives the notice, or a guest's acknowledgement would be compared with a text the
   * guest never saw.
   */
  readonly operatorName: string | null
}

export type GetPrivacyNotice = (
  input: GetPrivacyNoticeInput,
) => Promise<Result<NoticeForGuest, DomainError>>

export const makeGetPrivacyNotice =
  ({ events, clients, guests, operatorName }: GetPrivacyNoticeDeps): GetPrivacyNotice =>
  async ({ eventId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // Scoped by the event like every guest read: a guest id learned at one party must not
    // answer for a device at another.
    const guest = await guests.findById(eventId, guestId)
    if (guest === null) return err(DomainError.notFound('guest.notFound'))

    const notice = await privacyNoticeOf(clients, event, operatorName)
    return ok({ notice, acknowledgement: guest.noticeAcknowledgementFor(notice) })
  }
