import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { Password } from './password'

/**
 * Multi-byte code points are built here rather than typed, so this file stays plain
 * ASCII text that survives a copy, a diff and a Windows editor unchanged. One code
 * point per UTF-8 width, because the byte limit is the rule under test.
 */
const ACUTE_E = String.fromCodePoint(0xe9) // 2 bytes
const EURO_SIGN = String.fromCodePoint(0x20ac) // 3 bytes
const PARTY_POPPER = String.fromCodePoint(0x1f389) // 4 bytes

/** 16 ASCII bytes plus one two-, one three- and one four-byte character: 25 bytes. */
const MIXED_WIDTH_PASSPHRASE = `bravo-${ACUTE_E}-${EURO_SIGN}-${PARTY_POPPER}-mariage`

/** 17 four-byte emoji plus 4 ASCII: exactly the 72 bytes bcrypt will read. */
const AT_THE_BYTE_LIMIT = `${PARTY_POPPER.repeat(17)}beau`

/** One byte more, which bcrypt would silently truncate. */
const OVER_THE_BYTE_LIMIT = `${PARTY_POPPER.repeat(18)}b`

const unwrap = (result: Result<Password, DomainError>): Password => {
  if (!result.ok) throw new Error(`invalid fixture: ${result.error.code}`)
  return result.value
}

const passwordOf = (raw: string): Password => unwrap(Password.create(raw))

/**
 * At the HTTP boundary the field is whatever the request body held, so `create` has to
 * defend a `string` it was only promised. Calling it through a method signature that
 * takes `unknown` reaches that guard with no cast and no `any`.
 */
interface UntrustedInput {
  create(raw: unknown): Result<Password, DomainError>
}

const untrusted: UntrustedInput = Password

describe('Password length policy', () => {
  it('accepts a passphrase of exactly the minimum length', () => {
    const result = Password.create('correcthors3')

    expect(result.ok && result.value.value).toBe('correcthors3')
  })

  it('refuses a passphrase one character short of the minimum', () => {
    const result = Password.create('correcthors')

    expect(!result.ok && result.error.code).toBe('password.tooShort')
  })

  it('publishes the minimum alongside the failure, so the UI can say how short it was', () => {
    const result = Password.create('correcthors')

    expect(!result.ok && result.error.details).toEqual({ min: Password.minLength })
  })

  it('measures length in characters, so a short emoji passphrase is still refused', () => {
    const result = Password.create(PARTY_POPPER.repeat(5))

    expect(!result.ok && result.error.code).toBe('password.tooShort')
  })

  it('refuses a non-string, which is what a JSON body can hand the domain', () => {
    const result = untrusted.create(42)

    expect(!result.ok && result.error.code).toBe('password.invalid')
  })

  it('reports a rejected password as invalid input, so the HTTP layer answers 400', () => {
    const result = Password.create('correcthors')

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('Password byte limit', () => {
  it('accepts a passphrase mixing one-, two-, three- and four-byte characters', () => {
    const result = Password.create(MIXED_WIDTH_PASSPHRASE)

    expect(result.ok && result.value.value).toBe(MIXED_WIDTH_PASSPHRASE)
  })

  it('accepts a passphrase of exactly the number of bytes bcrypt will read', () => {
    const result = Password.create(AT_THE_BYTE_LIMIT)

    expect(result.ok && result.value.value).toBe(AT_THE_BYTE_LIMIT)
  })

  it('refuses a passphrase one UTF-8 byte over the limit instead of truncating it', () => {
    const result = Password.create(OVER_THE_BYTE_LIMIT)

    expect(!result.ok && result.error.code).toBe('password.tooLong')
  })

  it('publishes the byte limit alongside the failure', () => {
    const result = Password.create(OVER_THE_BYTE_LIMIT)

    expect(!result.ok && result.error.details).toEqual({ maxBytes: Password.maxBytes })
  })
})

describe('Password blocklist', () => {
  it.each(['123456789012', 'administrator', 'eventslide123', 'letmein12345'])(
    'refuses %s, which is guessed before anything else on a login form it found',
    (guessed) => {
      const result = Password.create(guessed)

      expect(!result.ok && result.error.code).toBe('password.tooCommon')
    },
  )

  it('refuses a blocklisted password typed with capitals, since case is not a secret', () => {
    const result = Password.create('EventSlide123')

    expect(!result.ok && result.error.code).toBe('password.tooCommon')
  })

  it('accepts a passphrase that merely contains a blocklisted word', () => {
    const result = Password.create('administrator du mariage')

    expect(result.ok && result.value.value).toBe('administrator du mariage')
  })
})

describe('Password against the account it protects', () => {
  it('refuses a password equal to the account email, which protects nothing', () => {
    const result = Password.create('camille@example.com', { email: 'camille@example.com' })

    expect(!result.ok && result.error.code).toBe('password.sameAsEmail')
  })

  it('refuses a password equal to the account email in another case', () => {
    const result = Password.create('camille@example.com', { email: 'Camille@Example.COM' })

    expect(!result.ok && result.error.code).toBe('password.sameAsEmail')
  })

  it('accepts a password that is not the account email', () => {
    const result = Password.create('correcthors3', { email: 'camille@example.com' })

    expect(result.ok && result.value.value).toBe('correcthors3')
  })

  it('refuses a password equal to the host or event name, which every guest can read', () => {
    const result = Password.create('mariage de camille', { displayName: 'Mariage De Camille' })

    expect(!result.ok && result.error.code).toBe('password.sameAsName')
  })

  it('accepts a password that is not the display name', () => {
    const result = Password.create('correcthors3', { displayName: 'Mariage De Camille' })

    expect(result.ok && result.value.value).toBe('correcthors3')
  })

  it('skips the name comparison for a display name too short to ever be a password', () => {
    const result = Password.create('correcthors3', { displayName: 'Chloe' })

    expect(result.ok && result.value.value).toBe('correcthors3')
  })

  it('accepts a password when no account context is supplied at all', () => {
    const result = Password.create('chloe-et-remi-2026')

    expect(result.ok && result.value.value).toBe('chloe-et-remi-2026')
  })
})

describe('Password entropy', () => {
  it('refuses a single character repeated to the minimum length', () => {
    const result = Password.create('aaaaaaaaaaaa')

    expect(!result.ok && result.error.code).toBe('password.tooRepetitive')
  })

  it('accepts a repetitive passphrase as soon as it uses a second character', () => {
    const result = Password.create('aaaaaaaaaaab')

    expect(result.ok && result.value.value).toBe('aaaaaaaaaaab')
  })
})

describe('Password whitespace', () => {
  it('does not trim, so spaces that bring a passphrase to the minimum length still count', () => {
    const result = Password.create(' passphrase ')

    expect(result.ok).toBe(true)
  })

  it('keeps surrounding spaces in the value, so a password that worked once works again', () => {
    const result = Password.create('  ChevalCorrect  ')

    expect(result.ok && result.value.value).toBe('  ChevalCorrect  ')
  })
})

describe('Password redaction', () => {
  it('redacts the value when interpolated into a log line', () => {
    expect(`${passwordOf('correcthors3')}`).toBe('[password]')
  })

  it('redacts the value when serialised into a JSON error payload', () => {
    expect(JSON.stringify(passwordOf('correcthors3'))).toBe('"[password]"')
  })

  it('publishes the minimum length the sign-up form counts towards', () => {
    expect(Password.minLength).toBe(12)
  })

  it('publishes the byte limit bcrypt imposes', () => {
    expect(Password.maxBytes).toBe(72)
  })
})
