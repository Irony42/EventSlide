import type { GuestHousehold } from '../../../domain/guestRsvps/household'
import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import type { DomainError } from '../../../domain/shared/errors'
import { ok, type Result } from '../../../domain/shared/result'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import {
  findHouseholdByLink,
  openPublicRsvp,
  type HouseholdAccessDeps,
  type PublicRsvpDeps,
} from './publicRsvpAccess'

/**
 * What a household sees when it opens its personal link (spec 30, lot 3, `#f=` in the page's
 * address): its name, the places kept for it, and its reply if it gave one, so that the page
 * shows the same form as the common link, filled in.
 *
 * The page's own door first (`404 guestInvite.notAvailable`), then the link, bound to this event
 * (`404 rsvp.notFound`: unknown, another event's, malformed). **Read for as long as the page is
 * served**, the window closed or the party over included: the household may still read or erase
 * what it said. Nothing is written, nothing is announced.
 */

export interface ViewHouseholdInput {
  readonly token: unknown
  readonly householdToken: unknown
}

export interface ViewedHousehold {
  readonly household: GuestHousehold
  readonly rsvp: GuestRsvp | null
}

export interface ViewHouseholdDeps extends PublicRsvpDeps, HouseholdAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'findByHousehold'>
}

export type ViewHousehold = (
  input: ViewHouseholdInput,
) => Promise<Result<ViewedHousehold, DomainError>>

export const makeViewHousehold =
  (deps: ViewHouseholdDeps): ViewHousehold =>
  async ({ token, householdToken }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event } = opened.value
    const household = await findHouseholdByLink(deps, event, householdToken)
    if (!household.ok) return household
    const rsvp = await deps.rsvps.findByHousehold(event.id, household.value.id)
    return ok({ household: household.value, rsvp })
  }
