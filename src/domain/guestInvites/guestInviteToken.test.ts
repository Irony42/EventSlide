import { describe, expect, it } from 'vitest'
import { GuestInviteToken } from './guestInviteToken'

const bytes = (value: number, length = 16): Uint8Array => new Uint8Array(length).fill(value)

describe('GuestInviteToken', () => {
  it('maps sixteen random bytes to sixteen characters of the join code alphabet', () => {
    const made = GuestInviteToken.fromBytes(Uint8Array.from({ length: 16 }, (_, i) => i * 2))

    expect(made.ok && made.value.value).toBe('02468ACEGJMPRTWY')
  })

  it('reads a byte modulo 32, so a byte above 31 wraps round the alphabet', () => {
    const wrapped = GuestInviteToken.fromBytes(
      Uint8Array.from([32, 33, 63, 64, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    )

    expect(wrapped.ok && wrapped.value.value).toBe('01Z0Z0123456789A')
  })

  it('refuses a number of bytes other than sixteen, so no token is made from too little entropy', () => {
    for (const length of [0, 15, 17]) {
      const made = GuestInviteToken.fromBytes(bytes(1, length))
      expect(!made.ok && made.error.code).toBe('guestInvite.tokenInvalid')
    }
  })

  it('folds case, separators and look-alike characters, so a dictated link still resolves', () => {
    const canonical = GuestInviteToken.create('7QX0M4TZ2KD9WB3H')
    const typed = GuestInviteToken.create('7qxo-m4tz 2kd9_wb3h')

    expect(typed.ok && canonical.ok && typed.value.equals(canonical.value)).toBe(true)
    expect(typed.ok && typed.value.toString()).toBe('7QX0M4TZ2KD9WB3H')
  })

  it('refuses a value of the wrong length', () => {
    for (const raw of ['', '7QX0M4TZ2KD9WB3', '7QX0M4TZ2KD9WB3HH']) {
      const made = GuestInviteToken.create(raw)
      expect(!made.ok && made.error.code, raw).toBe('guestInvite.tokenInvalid')
    }
  })

  it('refuses a character outside the alphabet (U is not in it)', () => {
    const made = GuestInviteToken.create('7QX0M4TZ2KD9WB3U')

    expect(!made.ok && made.error.code).toBe('guestInvite.tokenInvalid')
  })

  it('refuses what is not a string', () => {
    const made = GuestInviteToken.create(42)

    expect(!made.ok && made.error.code).toBe('guestInvite.tokenInvalid')
  })

  it('tells two different tokens apart', () => {
    const a = GuestInviteToken.fromBytes(bytes(1))
    const b = GuestInviteToken.fromBytes(bytes(2))

    expect(a.ok && b.ok && a.value.equals(b.value)).toBe(false)
  })
})
