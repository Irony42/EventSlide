import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { EmailAddress } from './emailAddress'

/**
 * Awkward code points are built here rather than typed, so this file stays plain ASCII
 * text that survives a copy, a diff and a Windows editor unchanged.
 */
const TAB = String.fromCodePoint(0x09)
const NON_BREAKING_SPACE = String.fromCodePoint(0xa0)

/** Brings a well-formed address to exactly the RFC path limit. */
const LONGEST_LOCAL_PART = 'a'.repeat(EmailAddress.maxLength - '@example.com'.length)

const unwrap = (result: Result<EmailAddress, DomainError>): EmailAddress => {
  if (!result.ok) throw new Error(`invalid fixture: ${result.error.code}`)
  return result.value
}

const emailOf = (raw: string): EmailAddress => unwrap(EmailAddress.create(raw))

/**
 * At the HTTP boundary the field is whatever the request body held, so `create` has to
 * defend a `string` it was only promised. Calling it through a method signature that
 * takes `unknown` reaches that guard with no cast and no `any`.
 */
interface UntrustedInput {
  create(raw: unknown): Result<EmailAddress, DomainError>
}

const untrusted: UntrustedInput = EmailAddress

describe('EmailAddress.create', () => {
  it('accepts the address a host would actually type', () => {
    const result = EmailAddress.create('camille.dupont@example.com')

    expect(result.ok && result.value.value).toBe('camille.dupont@example.com')
  })

  it('lowercases the address, so two accounts cannot differ only by capitalisation', () => {
    const result = EmailAddress.create('Camille.Dupont@Example.COM')

    expect(result.ok && result.value.value).toBe('camille.dupont@example.com')
  })

  it('trims the whitespace a paste or a phone keyboard adds around the address', () => {
    const result = EmailAddress.create(`${TAB}  camille@example.com  ${TAB}`)

    expect(result.ok && result.value.value).toBe('camille@example.com')
  })

  it('accepts an address of exactly the maximum length', () => {
    const result = EmailAddress.create(`${LONGEST_LOCAL_PART}@example.com`)

    expect(result.ok && result.value.value.length).toBe(EmailAddress.maxLength)
  })

  it('refuses an address one character over the maximum length', () => {
    const result = EmailAddress.create(`a${LONGEST_LOCAL_PART}@example.com`)

    expect(!result.ok && result.error.code).toBe('email.tooLong')
  })

  it('publishes the maximum length alongside the failure, so the UI can say the limit', () => {
    const result = EmailAddress.create(`a${LONGEST_LOCAL_PART}@example.com`)

    expect(!result.ok && result.error.details).toEqual({ max: EmailAddress.maxLength })
  })

  it('refuses an empty address', () => {
    const result = EmailAddress.create('')

    expect(!result.ok && result.error.code).toBe('email.empty')
  })

  it('refuses an address that is only whitespace', () => {
    const result = EmailAddress.create(`  ${TAB} `)

    expect(!result.ok && result.error.code).toBe('email.empty')
  })

  it('refuses a non-string, which is what a JSON body can hand the domain', () => {
    const result = untrusted.create(42)

    expect(!result.ok && result.error.code).toBe('email.invalid')
  })

  it('reports a rejected address as invalid input, so the HTTP layer answers 400', () => {
    const result = EmailAddress.create('camille')

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('EmailAddress internal whitespace', () => {
  it.each([' ', TAB, NON_BREAKING_SPACE])(
    'refuses an address split by whitespace at code point %j, which no mail path allows',
    (separator) => {
      const result = EmailAddress.create(`camille${separator}dupont@example.com`)

      expect(!result.ok && result.error.code).toBe('email.containsWhitespace')
    },
  )
})

describe('EmailAddress shape', () => {
  it('refuses an address with no @ at all', () => {
    const result = EmailAddress.create('camille.example.com')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('refuses an address with no local part before the @', () => {
    const result = EmailAddress.create('@example.com')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('refuses an address with no domain after the @', () => {
    const result = EmailAddress.create('camille@')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('refuses a domain with no dot, since a bare host cannot receive public mail', () => {
    const result = EmailAddress.create('camille@localhost')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('refuses a domain starting with a dot', () => {
    const result = EmailAddress.create('camille@.example.com')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('refuses a domain ending with a dot', () => {
    const result = EmailAddress.create('camille@example.')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('splits on the last @, so an extra one earlier stays part of the local part', () => {
    const result = EmailAddress.create('camille@work@example.com')

    expect(result.ok && result.value.value).toBe('camille@work@example.com')
  })
})

describe('EmailAddress.domain', () => {
  it('reads everything after the @ as the domain', () => {
    expect(emailOf('camille@example.com').domain).toBe('example.com')
  })

  it('keeps a subdomain in the domain rather than treating it as a suffix', () => {
    expect(emailOf('camille@mail.example.co.uk').domain).toBe('mail.example.co.uk')
  })

  it('reads the domain from the last @ when the local part contains one too', () => {
    expect(emailOf('camille@work@example.com').domain).toBe('example.com')
  })
})

describe('EmailAddress identity', () => {
  it('considers two addresses with the same text equal', () => {
    expect(emailOf('camille@example.com').equals(emailOf('camille@example.com'))).toBe(true)
  })

  it('considers addresses differing only by case equal, because both normalise', () => {
    expect(emailOf('Camille@Example.com').equals(emailOf('camille@example.com'))).toBe(true)
  })

  it('considers two different addresses different', () => {
    expect(emailOf('camille@example.com').equals(emailOf('marc@example.com'))).toBe(false)
  })

  it('stringifies to the normalised address, so a log line shows what was stored', () => {
    expect(`${emailOf('  Camille@Example.COM  ')}`).toBe('camille@example.com')
  })

  it('publishes the RFC 5321 path limit the sign-up form counts against', () => {
    expect(EmailAddress.maxLength).toBe(254)
  })
})
