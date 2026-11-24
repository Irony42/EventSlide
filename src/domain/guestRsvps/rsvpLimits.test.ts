import { describe, expect, it } from 'vitest'
import { CAPACITY_MAX, CAPACITY_MIN, MAX_RSVPS_PER_EVENT, rsvpAdmissionFor } from './rsvpLimits'

const base = {
  isNew: true,
  heldInEvent: 0,
  answer: 'yes',
  heldAnswer: null,
  heldPeople: 0,
  people: 2,
  yesPeopleElsewhere: 0,
  capacity: null,
} as const

describe('rsvpAdmissionFor', () => {
  it('holds a thousand replies per event: the 1000th is accepted, the next refused', () => {
    expect(MAX_RSVPS_PER_EVENT).toBe(1000)
    expect(rsvpAdmissionFor({ ...base, heldInEvent: 999 })).toBe('admit')
    expect(rsvpAdmissionFor({ ...base, heldInEvent: 1000 })).toBe('tooMany')
  })

  it('does not count a change to a reply against the ceiling', () => {
    expect(rsvpAdmissionFor({ ...base, isNew: false, heldInEvent: 1000 })).toBe('admit')
  })

  it('bounds the capacity from 1 to 2000 people', () => {
    expect([CAPACITY_MIN, CAPACITY_MAX]).toEqual([1, 2000])
  })

  it('puts a "yes" that would pass the capacity on the waiting list, whole, never partly', () => {
    const limited = { ...base, capacity: 10 }

    expect(rsvpAdmissionFor({ ...limited, yesPeopleElsewhere: 8 })).toBe('admit')
    expect(rsvpAdmissionFor({ ...limited, yesPeopleElsewhere: 9 })).toBe('waitlist')
  })

  it('applies the capacity to a "yes" only', () => {
    const crowded = { ...base, capacity: 1, yesPeopleElsewhere: 50 }

    expect(rsvpAdmissionFor({ ...crowded, answer: 'no' })).toBe('admit')
    expect(rsvpAdmissionFor({ ...crowded, answer: 'maybe' })).toBe('admit')
    expect(rsvpAdmissionFor({ ...crowded, answer: 'waitlist' })).toBe('admit')
  })

  it('has no capacity unless one is set', () => {
    expect(rsvpAdmissionFor({ ...base, yesPeopleElsewhere: 5000 })).toBe('admit')
  })

  it('keeps a reply on the waiting list when its guest says yes again, even if it would fit', () => {
    const limited = { ...base, capacity: 10, isNew: false, heldAnswer: 'waitlist' }

    expect(rsvpAdmissionFor({ ...limited, yesPeopleElsewhere: 0 })).toBe('waitlist')
    expect(rsvpAdmissionFor({ ...limited, answer: 'maybe' })).toBe('admit')
  })

  it('always admits a held yes whose people stay equal or shrink, even under a lowered capacity', () => {
    const lowered = {
      ...base,
      capacity: 2,
      isNew: false,
      heldAnswer: 'yes',
      heldPeople: 4,
      yesPeopleElsewhere: 3,
    }

    expect(rsvpAdmissionFor({ ...lowered, people: 4 })).toBe('admit')
    expect(rsvpAdmissionFor({ ...lowered, people: 1 })).toBe('admit')
  })

  it('refuses a held yes that grows beyond the places left, whole, and admits one that still fits', () => {
    const held = {
      ...base,
      capacity: 10,
      isNew: false,
      heldAnswer: 'yes',
      heldPeople: 2,
      yesPeopleElsewhere: 7,
    }

    expect(rsvpAdmissionFor({ ...held, people: 3 })).toBe('admit')
    expect(rsvpAdmissionFor({ ...held, people: 4 })).toBe('full')
  })

  it('puts a new yes, or a maybe or a no turned into a yes, on the waiting list when it does not fit', () => {
    const crowded = { ...base, capacity: 10, yesPeopleElsewhere: 9 }

    expect(rsvpAdmissionFor({ ...crowded, isNew: false, heldAnswer: 'maybe', heldPeople: 0 })).toBe(
      'waitlist',
    )
    expect(rsvpAdmissionFor({ ...crowded, isNew: false, heldAnswer: 'no', heldPeople: 0 })).toBe(
      'waitlist',
    )
    expect(rsvpAdmissionFor({ ...crowded })).toBe('waitlist')
  })

  it('names the ceiling first when both apply', () => {
    expect(
      rsvpAdmissionFor({ ...base, heldInEvent: 1000, capacity: 1, yesPeopleElsewhere: 1 }),
    ).toBe('tooMany')
  })
})
