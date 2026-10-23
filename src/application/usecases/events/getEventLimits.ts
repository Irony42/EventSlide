import type { Event } from '../../../domain/events/event'
import type { ClientRepository } from '../../ports/clientRepository'
import { clientContextOf } from '../clients/clientContextOf'

/**
 * What a host is shown of the limits their event is under (G2-16 / P3-17, closing two findings
 * of G2-05's review): the quota uploads are **actually** judged against, and when the event's
 * live window closes.
 *
 * `Event.quotaBytes` is what the event was created with. An operator can lower the client's
 * `max_event_quota_bytes` afterwards, and from the next write on uploads are refused past the
 * lower number, so a meter drawn against the stored one told the host they had room the box
 * would not give. Both numbers come from the domain's own rules (`effectiveQuotaBytes`,
 * `liveWindowEnd`), over the ceilings the way every write path reads them: an event with no
 * client asks nothing of the clients table and gets exactly the numbers it always had.
 */

export interface EventLimits {
  /** `Event.effectiveQuotaBytes`: the stored quota, lowered to the client's ceiling. */
  readonly quotaBytes: number
  /** `Event.liveWindowEnd`: `null` for an event with no live window to announce. */
  readonly liveWindowEnd: Date | null
}

export interface GetEventLimitsInput {
  readonly event: Event
}

export interface GetEventLimitsDeps {
  readonly clients: ClientRepository
}

export type GetEventLimits = (input: GetEventLimitsInput) => Promise<EventLimits>

export const makeGetEventLimits =
  ({ clients }: GetEventLimitsDeps): GetEventLimits =>
  async ({ event }) => {
    const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
    return {
      quotaBytes: event.effectiveQuotaBytes(ceilings),
      liveWindowEnd: event.liveWindowEnd(ceilings),
    }
  }
