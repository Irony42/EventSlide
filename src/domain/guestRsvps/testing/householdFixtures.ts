import { asEventId, asGuestHouseholdId } from '../../shared/ids'
import { GuestHousehold } from '../household'
import { HouseholdToken } from '../householdToken'

export const HOUSEHOLD_AT = new Date('2026-11-23T10:00:00.000Z')

export interface HouseholdFixture {
  readonly id?: string
  readonly eventId?: string
  readonly token?: string
  readonly name?: string
  readonly places?: number
  readonly remindedAt?: Date | null
  readonly createdAt?: Date
  readonly updatedAt?: Date
}

/** A stored household: the Martins, four places, unless the fixture says otherwise. */
export const aHousehold = (input: HouseholdFixture = {}): GuestHousehold => {
  const token = HouseholdToken.create(input.token ?? '7QX0M4TZ2KD9WB3H')
  if (!token.ok) throw new Error('the fixture token is not a token')
  const createdAt = input.createdAt ?? HOUSEHOLD_AT
  return GuestHousehold.restore({
    id: asGuestHouseholdId(input.id ?? 'household-1'),
    eventId: asEventId(input.eventId ?? 'event-1'),
    token: token.value,
    name: input.name ?? 'Famille Martin',
    places: input.places ?? 4,
    remindedAt: input.remindedAt ?? null,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  })
}
