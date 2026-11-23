import { describe, expect, it } from 'vitest'
import { asEventId, asGuestHouseholdId } from '../shared/ids'
import {
  formForHousehold,
  GuestHousehold,
  HOUSEHOLD_NAME_MAX_CHARS,
  parseHouseholdInput,
} from './household'
import { HouseholdToken } from './householdToken'
import { DEFAULT_RSVP_FORM } from './rsvpForm'

const AT = new Date('2026-11-23T10:00:00.000Z')
const LATER = new Date('2026-11-24T10:00:00.000Z')

const token = (value: string): HouseholdToken => {
  const made = HouseholdToken.create(value)
  if (!made.ok) throw new Error('bad token')
  return made.value
}

const aHousehold = (): GuestHousehold =>
  GuestHousehold.create({
    id: asGuestHouseholdId('h-1'),
    eventId: asEventId('e-1'),
    token: token('7QX0M4TZ2KD9WB3H'),
    household: { name: 'Famille Martin', places: 4 },
    now: AT,
  })

const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('parseHouseholdInput', () => {
  it('keeps a name on one line, cleaned, and the places', () => {
    const parsed = parseHouseholdInput({ name: '  Famille \n Martin ', places: 4 })

    expect(parsed.ok && parsed.value).toEqual({ name: 'Famille Martin', places: 4 })
  })

  it('refuses an empty name, a name that is not text and a name over 80 characters', () => {
    expect(code(parseHouseholdInput({ name: '   ', places: 2 }))).toBe('household.nameEmpty')
    expect(code(parseHouseholdInput({ name: 3, places: 2 }))).toBe('household.nameInvalid')
    expect(code(parseHouseholdInput({ places: 2 }))).toBe('household.nameInvalid')
    expect(
      code(parseHouseholdInput({ name: 'x'.repeat(HOUSEHOLD_NAME_MAX_CHARS + 1), places: 2 })),
    ).toBe('household.nameTooLong')
    expect(parseHouseholdInput({ name: 'x'.repeat(HOUSEHOLD_NAME_MAX_CHARS), places: 2 }).ok).toBe(
      true,
    )
  })

  it('counts a name in characters, not in UTF-16 units', () => {
    expect(parseHouseholdInput({ name: '😀'.repeat(HOUSEHOLD_NAME_MAX_CHARS), places: 2 }).ok).toBe(
      true,
    )
  })

  it('takes 1 to 10 places and nothing else', () => {
    expect(parseHouseholdInput({ name: 'A', places: 1 }).ok).toBe(true)
    expect(parseHouseholdInput({ name: 'A', places: 10 }).ok).toBe(true)
    for (const places of [0, 11, -1, 2.5, '3', null, undefined, Number.NaN]) {
      const refused = parseHouseholdInput({ name: 'A', places })
      expect(code(refused), String(places)).toBe('household.placesInvalid')
      expect(!refused.ok && refused.error.details).toEqual({ min: 1, max: 10 })
    }
  })
})

describe('GuestHousehold', () => {
  it('is born with no reminder and the creation instant everywhere', () => {
    expect(aHousehold().toProps()).toMatchObject({
      name: 'Famille Martin',
      places: 4,
      remindedAt: null,
      createdAt: AT,
      updatedAt: AT,
    })
  })

  it('changes its name and places, and keeps its token, note and creation', () => {
    const reminded = aHousehold().withReminder(LATER)
    const changed = reminded.withInput({ name: 'Les Martin', places: 3 }, LATER)

    expect(changed.name).toBe('Les Martin')
    expect(changed.places).toBe(3)
    expect(changed.token.value).toBe('7QX0M4TZ2KD9WB3H')
    expect(changed.remindedAt).toEqual(LATER)
    expect(changed.createdAt).toEqual(AT)
    expect(changed.updatedAt).toEqual(LATER)
  })

  it('takes a new token and says when it was reminded', () => {
    const rotated = aHousehold().withToken(token('00000000000000AA'), LATER)
    const reminded = aHousehold().withReminder(LATER)

    expect(rotated.token.value).toBe('00000000000000AA')
    expect(rotated.updatedAt).toEqual(LATER)
    expect(rotated.remindedAt).toBeNull()
    expect(reminded.remindedAt).toEqual(LATER)
    expect(reminded.updatedAt).toEqual(LATER)
  })

  it('exposes every field of what it was restored from', () => {
    const household = aHousehold()
    const restored = GuestHousehold.restore(household.toProps())

    expect([restored.id, restored.eventId]).toEqual(['h-1', 'e-1'])
    expect(restored.token.equals(household.token)).toBe(true)
  })
})

describe('formForHousehold', () => {
  it('makes the household’s places the ceiling and always asks how many', () => {
    const form = {
      ...DEFAULT_RSVP_FORM,
      partySize: { enabled: false, max: 2 },
      kidsSeparate: false,
    }

    const forHousehold = formForHousehold(form, aHousehold())

    expect(forHousehold.partySize).toEqual({ enabled: true, max: 4 })
    expect(forHousehold.kidsSeparate).toBe(false)
    expect(forHousehold.diet).toBe(form.diet)
  })
})

describe('a household and its moments', () => {
  const BRUNCH = { id: 'aaaaaaaa', label: 'Brunch' }
  const DINNER = { id: 'bbbbbbbb', label: 'Dîner' }
  const form = { ...DEFAULT_RSVP_FORM, moments: [BRUNCH, DINNER] }

  it('is invited to every moment by default, and its own form lists only the invited ones', () => {
    expect(aHousehold().moments).toBeNull()
    expect(formForHousehold(form, aHousehold()).moments).toEqual([BRUNCH, DINNER])
    const invited = aHousehold().withInput({ name: 'Famille Martin', places: 4 }, LATER, [
      DINNER.id,
    ])
    expect(formForHousehold(form, invited).moments).toEqual([DINNER])
  })

  it('keeps its moments through a change that names none, and clears them with null', () => {
    const invited = aHousehold().withInput({ name: 'A', places: 2 }, LATER, [DINNER.id])

    expect(invited.withInput({ name: 'B', places: 3 }, LATER).moments).toEqual([DINNER.id])
    expect(invited.withInput({ name: 'B', places: 3 }, LATER, null).moments).toBeNull()
  })
})
