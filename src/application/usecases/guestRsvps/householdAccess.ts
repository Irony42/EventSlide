import type { GuestHousehold } from '../../../domain/guestRsvps/household'
import { HouseholdToken } from '../../../domain/guestRsvps/householdToken'
import type { GuestRsvp, RsvpAnswer } from '../../../domain/guestRsvps/rsvp'
import { DomainError } from '../../../domain/shared/errors'
import type { GuestRsvpId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'

/**
 * What the host-side use cases of the guest list share (spec 30, lot 3): the door is the replies'
 * own (`openRsvps`, the owner's), the link's token comes from the injected entropy, and a household
 * is shown with the reply that answers for it.
 */

/** The reply that answers for a household, as the host's list shows it. */
export interface HouseholdReply {
  readonly id: GuestRsvpId
  readonly answer: RsvpAnswer
  readonly people: number
}

/** A household of the guest list and its reply, or `null` for none yet ("sans réponse"). */
export interface HostHousehold {
  readonly household: GuestHousehold
  readonly reply: HouseholdReply | null
}

export const householdReplyOf = (rsvp: GuestRsvp | null): HouseholdReply | null =>
  rsvp === null ? null : { id: rsvp.id, answer: rsvp.answer, people: rsvp.people }

/** One household with its reply, read for it alone. */
export const hostHouseholdOf = async (
  rsvps: Pick<GuestRsvpRepository, 'findByHousehold'>,
  household: GuestHousehold,
): Promise<HostHousehold> => ({
  household,
  reply: householdReplyOf(await rsvps.findByHousehold(household.eventId, household.id)),
})

/** A fresh link token from the injected entropy: 16 bytes, 80 bits. */
export const mintHouseholdToken = (ids: IdGenerator): Result<HouseholdToken, DomainError> =>
  HouseholdToken.fromBytes(ids.bytes(HouseholdToken.length))

export const householdNotFound = (): DomainError => DomainError.notFound('household.notFound')
export const householdsTooMany = (): DomainError => DomainError.conflict('household.tooMany')
