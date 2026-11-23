import { DomainError } from '../shared/errors'
import type { EventId, GuestHouseholdId } from '../shared/ids'
import { characterCount, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import type { HouseholdToken } from './householdToken'
import type { RsvpForm } from './rsvpForm'

/**
 * A household of the guest list (spec 30, lot 3): a family or a couple the host listed, the places
 * kept for them, and a personal link whose token is the household's key to its **one** reply.
 *
 * No contact (no e-mail address, no phone number) is ever held: the host sends the link from their
 * own apps and notes "relancé le" by hand.
 */

export const HOUSEHOLD_NAME_MAX_CHARS = 80
export const HOUSEHOLD_PLACES_MIN = 1
export const HOUSEHOLD_PLACES_MAX = 10
/** Households an event may hold: the list is typed or pasted by the host, but something must bound it. */
export const MAX_HOUSEHOLDS_PER_EVENT = 500

/** What a host types for a household, before it is judged. */
export interface RawHouseholdInput {
  readonly name?: unknown
  readonly places?: unknown
}

export interface HouseholdInput {
  readonly name: string
  readonly places: number
}

const parseName = (raw: unknown): Result<string, DomainError> => {
  if (typeof raw !== 'string') return err(DomainError.invalid('household.nameInvalid'))
  const cleaned = toSingleLine(raw)
  if (cleaned.length === 0) return err(DomainError.invalid('household.nameEmpty'))
  if (characterCount(cleaned) > HOUSEHOLD_NAME_MAX_CHARS) {
    return err(DomainError.invalid('household.nameTooLong', { max: HOUSEHOLD_NAME_MAX_CHARS }))
  }
  return ok(cleaned)
}

const parsePlaces = (raw: unknown): Result<number, DomainError> => {
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < HOUSEHOLD_PLACES_MIN ||
    raw > HOUSEHOLD_PLACES_MAX
  ) {
    return err(
      DomainError.invalid('household.placesInvalid', {
        min: HOUSEHOLD_PLACES_MIN,
        max: HOUSEHOLD_PLACES_MAX,
      }),
    )
  }
  return ok(raw)
}

/** A household's name (1 to 80 characters, one line) and its places (1 to 10). */
export const parseHouseholdInput = (
  raw: RawHouseholdInput,
): Result<HouseholdInput, DomainError> => {
  const name = parseName(raw.name)
  if (!name.ok) return name
  const places = parsePlaces(raw.places)
  if (!places.ok) return places
  return ok({ name: name.value, places: places.value })
}

export interface GuestHouseholdProps {
  readonly id: GuestHouseholdId
  readonly eventId: EventId
  readonly token: HouseholdToken
  readonly name: string
  readonly places: number
  /** The host's own note "relancé le"; EventSlide sends nothing. */
  readonly remindedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export class GuestHousehold {
  private constructor(private readonly props: GuestHouseholdProps) {}

  static create(input: {
    readonly id: GuestHouseholdId
    readonly eventId: EventId
    readonly token: HouseholdToken
    readonly household: HouseholdInput
    readonly now: Date
  }): GuestHousehold {
    return new GuestHousehold({
      id: input.id,
      eventId: input.eventId,
      token: input.token,
      name: input.household.name,
      places: input.household.places,
      remindedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
  }

  /** Rebuilds one a store holds, without re-judging it. */
  static restore(props: GuestHouseholdProps): GuestHousehold {
    return new GuestHousehold(props)
  }

  get id(): GuestHouseholdId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get token(): HouseholdToken {
    return this.props.token
  }
  get name(): string {
    return this.props.name
  }
  get places(): number {
    return this.props.places
  }
  get remindedAt(): Date | null {
    return this.props.remindedAt
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  toProps(): GuestHouseholdProps {
    return this.props
  }

  /** The household with another name and places. The token, the note and the creation stay. */
  withInput(input: HouseholdInput, now: Date): GuestHousehold {
    return new GuestHousehold({
      ...this.props,
      name: input.name,
      places: input.places,
      updatedAt: now,
    })
  }

  /** The household with a new link: the old one stops at once. */
  withToken(token: HouseholdToken, now: Date): GuestHousehold {
    return new GuestHousehold({ ...this.props, token, updatedAt: now })
  }

  /** The host noted that they reminded this household. */
  withReminder(now: Date): GuestHousehold {
    return new GuestHousehold({ ...this.props, remindedAt: now, updatedAt: now })
  }
}

/**
 * The form a household answers with: the host's own, except that **the household's places are the
 * ceiling** of the party (the host counted them, so the form's general maximum does not apply) and
 * "how many" is always asked, since a household of four is not one person. Children stay separate
 * or not as the form says.
 */
export const formForHousehold = (form: RsvpForm, household: GuestHousehold): RsvpForm => ({
  ...form,
  partySize: { enabled: true, max: household.places },
})
