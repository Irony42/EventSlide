import { describe, expect, it } from 'vitest'
import { HouseholdToken } from './householdToken'

const bytes = (value: number, length = 16): Uint8Array => new Uint8Array(length).fill(value)

describe('HouseholdToken', () => {
  it('maps sixteen random bytes to sixteen characters of the join code alphabet', () => {
    const made = HouseholdToken.fromBytes(Uint8Array.from({ length: 16 }, (_, i) => i * 2))

    expect(made.ok && made.value.value).toBe('02468ACEGJMPRTWY')
  })

  it('reads a byte modulo 32, so a byte above 31 wraps round the alphabet', () => {
    const wrapped = HouseholdToken.fromBytes(
      Uint8Array.from([32, 33, 63, 64, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    )

    expect(wrapped.ok && wrapped.value.value).toBe('01Z0Z0123456789A')
  })

  it('refuses a number of bytes other than sixteen, so no token is made from too little entropy', () => {
    for (const length of [0, 15, 17]) {
      const made = HouseholdToken.fromBytes(bytes(1, length))
      expect(!made.ok && made.error.code).toBe('household.tokenInvalid')
    }
  })

  it('folds case, separators and look-alike characters, so a dictated link still resolves', () => {
    const canonical = HouseholdToken.create('7QX0M4TZ2KD9WB3H')
    const typed = HouseholdToken.create('7qxo-m4tz 2kd9_wb3h')

    expect(typed.ok && typed.value.toString()).toBe('7QX0M4TZ2KD9WB3H')
    expect(typed.ok && canonical.ok && typed.value.equals(canonical.value)).toBe(true)
  })

  it('tells two different tokens apart', () => {
    const a = HouseholdToken.create('7QX0M4TZ2KD9WB3H')
    const b = HouseholdToken.create('7QX0M4TZ2KD9WB3J')

    expect(a.ok && b.ok && a.value.equals(b.value)).toBe(false)
  })

  it('refuses a value of the wrong length, a character outside the alphabet and what is not text', () => {
    for (const raw of ['', '7QX0M4TZ2KD9WB3', '7QX0M4TZ2KD9WB3HH', '7QX0M4TZ2KD9WB3U', 42, null]) {
      const made = HouseholdToken.create(raw)
      expect(!made.ok && made.error.code, String(raw)).toBe('household.tokenInvalid')
    }
  })
})
