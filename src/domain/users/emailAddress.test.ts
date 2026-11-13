import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { isSingleMailbox } from '../mail/outgoingMail'
import { EmailAddress, normalisedAddress } from './emailAddress'

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

  it('refuses a second @, which the mail rule refuses too', () => {
    const result = EmailAddress.create('camille@work@example.com')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })
})

/**
 * One definition of "an address": what the mailer would always refuse (`isSingleMailbox`) cannot
 * be registered either, or an invitation to it would silently turn into a link (QUAL-09).
 */
describe('EmailAddress is the mailbox the mailer accepts', () => {
  it.each([
    ['two addresses joined by a comma', 'a@b.example,c@d.example'],
    ['a semicolon', 'a@b.example;c@d.example'],
    ['a quote', '"a"@b.example'],
    ['angle brackets', 'a <a@b.example>'.replace(' ', '')],
    ['a parenthesis', 'a(comment)@b.example'],
    ['a backslash', 'a\b@b.example'],
  ])('refuses %s', (_label, raw) => {
    const result = EmailAddress.create(raw)

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('still accepts an apostrophe in the local part, which is a real address', () => {
    expect(emailOf("O'Brien@Example.org").value).toBe("o'brien@example.org")
  })

  it('agrees with isSingleMailbox on every address it creates', () => {
    for (const raw of ['camille@example.com', "o'brien@example.org", 'a+b@sub.example.co.uk']) {
      expect(isSingleMailbox(emailOf(raw).value)).toBe(true)
    }
  })
})

describe('EmailAddress.domain', () => {
  it('reads everything after the @ as the domain', () => {
    expect(emailOf('camille@example.com').domain).toBe('example.com')
  })

  it('keeps a subdomain in the domain rather than treating it as a suffix', () => {
    expect(emailOf('camille@mail.example.co.uk').domain).toBe('mail.example.co.uk')
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

describe('normalisedAddress', () => {
  it('is the address the lookup finds, whatever the spelling', () => {
    for (const spelling of [
      'camille@example.com',
      'Camille@Example.COM',
      '  camille@example.com ',
      `${TAB}CAMILLE@example.com${NON_BREAKING_SPACE}`,
    ]) {
      expect(normalisedAddress(spelling)).toBe('camille@example.com')
    }
  })

  it('is the trimmed, lower-cased text for what is not an address at all', () => {
    expect(normalisedAddress('  PAS-UNE-Adresse ')).toBe('pas-une-adresse')
    expect(normalisedAddress('a b@example.com')).toBe('a b@example.com')
    expect(normalisedAddress('')).toBe('')
  })
})
