import { asEventId, asGuestRsvpId } from '../../shared/ids'
import {
  EMPTY_RSVP_DETAILS,
  GuestRsvp,
  type RsvpAnswer,
  type RsvpDetails,
  type RsvpSource,
} from '../rsvp'

export const RSVP_AT = new Date('2026-11-22T10:00:00.000Z')

export interface RsvpFixture {
  readonly id?: string
  readonly eventId?: string
  readonly householdId?: string | null
  readonly editTokenHash?: string | null
  readonly name?: string
  readonly answer?: RsvpAnswer
  readonly adults?: number
  readonly kids?: number
  readonly details?: Partial<RsvpDetails>
  readonly diet?: string | null
  readonly message?: string | null
  readonly source?: RsvpSource
  readonly createdAt?: Date
  readonly updatedAt?: Date
}

/** A stored reply: a `yes` of one adult unless the fixture says otherwise (a `no` brings nobody). */
export const aRsvp = (input: RsvpFixture = {}): GuestRsvp => {
  const answer = input.answer ?? 'yes'
  const createdAt = input.createdAt ?? RSVP_AT
  return GuestRsvp.restore({
    id: asGuestRsvpId(input.id ?? 'rsvp-1'),
    eventId: asEventId(input.eventId ?? 'event-1'),
    householdId: input.householdId ?? null,
    editTokenHash: input.editTokenHash ?? null,
    name: input.name ?? 'Léa Martin',
    answer,
    adults: input.adults ?? (answer === 'no' ? 0 : 1),
    kids: input.kids ?? 0,
    details: { ...EMPTY_RSVP_DETAILS, ...input.details },
    diet: input.diet ?? null,
    message: input.message ?? null,
    source: input.source ?? 'open',
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  })
}
