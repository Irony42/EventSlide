import { describe, expect, it } from 'vitest'
import { MAX_RSVPS_PER_EVENT, rsvpRefusalFor } from './rsvpLimits'

const base = {
  isNew: true,
  heldInEvent: 0,
  answer: 'yes',
  people: 2,
  yesPeopleElsewhere: 0,
  capacity: null,
} as const

describe('rsvpRefusalFor', () => {
  it('holds a thousand replies per event: the 1000th is accepted, the next refused', () => {
    expect(MAX_RSVPS_PER_EVENT).toBe(1000)
    expect(rsvpRefusalFor({ ...base, heldInEvent: 999 })).toBeNull()
    expect(rsvpRefusalFor({ ...base, heldInEvent: 1000 })).toBe('tooMany')
  })

  it('does not count a change to a reply against the ceiling', () => {
    expect(rsvpRefusalFor({ ...base, isNew: false, heldInEvent: 1000 })).toBeNull()
  })

  it('refuses a "yes" that would pass the capacity, whole, never partly', () => {
    const limited = { ...base, capacity: 10 }

    expect(rsvpRefusalFor({ ...limited, yesPeopleElsewhere: 8 })).toBeNull()
    expect(rsvpRefusalFor({ ...limited, yesPeopleElsewhere: 9 })).toBe('full')
  })

  it('applies the capacity to a "yes" only', () => {
    const crowded = { ...base, capacity: 1, yesPeopleElsewhere: 50 }

    expect(rsvpRefusalFor({ ...crowded, answer: 'no' })).toBeNull()
    expect(rsvpRefusalFor({ ...crowded, answer: 'maybe' })).toBeNull()
    expect(rsvpRefusalFor({ ...crowded, answer: 'waitlist' })).toBeNull()
  })

  it('has no capacity unless one is set', () => {
    expect(rsvpRefusalFor({ ...base, yesPeopleElsewhere: 5000 })).toBeNull()
  })

  it('names the ceiling first when both apply', () => {
    expect(rsvpRefusalFor({ ...base, heldInEvent: 1000, capacity: 1, yesPeopleElsewhere: 1 })).toBe(
      'tooMany',
    )
  })
})
