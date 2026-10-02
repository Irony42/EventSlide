import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { EmailAddress } from '../users/emailAddress'
import {
  MAX_SUBJECT_LENGTH,
  checkOutgoingMail,
  isSingleMailbox,
  type OutgoingMail,
} from './outgoingMail'

/** Control characters are built, not typed, so this file stays plain text in every editor. */
const CR = String.fromCodePoint(0x0d)
const LF = String.fromCodePoint(0x0a)
const TAB = String.fromCodePoint(0x09)
const NUL = String.fromCodePoint(0x00)

/**
 * An address `EmailAddress` accepts, whatever it looks like: the point of several cases
 * below is that its check is shallow and this one is not.
 */
const emailOf = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error(`invalid fixture: ${parsed.error.code}`)
  return parsed.value
}

const aMail = (overrides: Partial<OutgoingMail> = {}): OutgoingMail => ({
  to: emailOf('camille@example.org'),
  subject: 'Your invitation',
  text: 'Open the link to choose a password.',
  ...overrides,
})

const codeOf = (result: Result<OutgoingMail, DomainError>): string | null =>
  result.ok ? null : result.error.code

describe('isSingleMailbox', () => {
  it.each(['camille@example.org', "o'brien@example.org", 'first.last+tag@sub.example.org'])(
    'accepts %s, which names one mailbox',
    (address) => {
      expect(isSingleMailbox(address)).toBe(true)
    },
  )

  it.each([
    ['two addresses joined by a comma', 'a@example.org,b@example.com'],
    ['two addresses joined by a semicolon', 'a@example.org;b@example.com'],
    ['a comma in the local part, which a parser reads as a list', 'a,b@example.org'],
    ['a semicolon in the local part', 'a;b@example.org'],
    ['a comma in the domain, which a parser reads as a second recipient', 'a@example.org,b'],
    ['a semicolon in the domain', 'a@example.org;b'],
    ['a display name in angle brackets', 'Camille <camille@example.org>'],
    ['an angle bracket', 'camille@example.org>'],
    ['a quote', '"camille"@example.org'],
    ['a parenthesised comment', 'camille(comment)@example.org'],
    ['a backslash', 'cam\\ille@example.org'],
    ['an apostrophe in the domain', "camille@exam'ple.org"],
    ['a second at sign', 'a@b@example.org'],
    ['a space', 'cam ille@example.org'],
    ['a line feed', `camille@example.org${LF}`],
    ['a NUL', `camille@example.org${NUL}`],
    // One case per character class and per half of the pattern: each was found by deleting
    // a class and watching nothing go red. `nodemailer` rewrites several of these into a
    // different, quoted mailbox (`a<NUL>b@c.example` becomes `"a b"@c.example`), so without
    // this check the mail goes somewhere nobody chose instead of failing.
    ['a NUL in the local part', `a${NUL}b@example.org`],
    ['an opening angle bracket in the local part', 'a<b@example.org'],
    ['a closing angle bracket in the local part', 'a>b@example.org'],
    ['a quote in the local part', 'a"b@example.org'],
    ['a backslash in the domain', 'a@exam\\ple.org'],
    ['an opening parenthesis in the domain', 'a@exam(ple.org'],
    ['a closing parenthesis in the domain', 'a@exam)ple.org'],
    ['a quote in the domain', 'a@exam"ple.org'],
    ['an angle bracket in the domain', 'a@exam<ple.org'],
    ['a NUL in the domain', `a@exam${NUL}ple.org`],
    ['no at sign', 'camille.example.org'],
    ['no local part', '@example.org'],
    ['no domain', 'camille@'],
  ])('refuses %s', (_name, address) => {
    expect(isSingleMailbox(address)).toBe(false)
  })

  it('refuses a list that EmailAddress itself lets through, which is the reason this check exists', () => {
    // The last `@` splits it into a "local part" of `a@example.org,b` and a domain, and
    // neither of those contains whitespace — so as a login identifier it is fine.
    const list = emailOf('a@example.org,b@example.com')

    expect(isSingleMailbox(list.value)).toBe(false)
  })
})

describe('checkOutgoingMail', () => {
  it('passes a message with one recipient, a one-line subject and a body', () => {
    const mail = aMail()

    const result = checkOutgoingMail(mail)

    expect(result.ok && result.value).toBe(mail)
  })

  it('passes a message that carries an HTML alternative beside its text', () => {
    expect(checkOutgoingMail(aMail({ html: '<p>Open the link.</p>' })).ok).toBe(true)
  })

  it('refuses a recipient that is really a list, so one invitation cannot go to two people', () => {
    const result = checkOutgoingMail(aMail({ to: emailOf('a@example.org,b@example.com') }))

    expect(codeOf(result)).toBe('mail.recipientInvalid')
  })

  it.each([
    ['a carriage return', `Hello${CR}Bcc: someone@else.example`],
    ['a line feed', `Hello${LF}Bcc: someone@else.example`],
    ['a tab', `Hello${TAB}there`],
    ['a NUL', `Hello${NUL}there`],
  ])(
    'refuses a subject with %s in it, which is how a string becomes a header',
    (_name, subject) => {
      expect(codeOf(checkOutgoingMail(aMail({ subject })))).toBe('mail.subjectInvalid')
    },
  )

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('refuses a subject that is %s', (_name, subject) => {
    expect(codeOf(checkOutgoingMail(aMail({ subject })))).toBe('mail.subjectInvalid')
  })

  it('accepts a subject of exactly the maximum length and refuses one character more', () => {
    const longest = 'x'.repeat(MAX_SUBJECT_LENGTH)

    expect(checkOutgoingMail(aMail({ subject: longest })).ok).toBe(true)
    expect(codeOf(checkOutgoingMail(aMail({ subject: `${longest}x` })))).toBe('mail.subjectInvalid')
  })

  it('accepts accents and emoji in a subject, which are text and not control characters', () => {
    expect(checkOutgoingMail(aMail({ subject: 'Invitation à la fête' })).ok).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['only whitespace', ` ${LF} `],
  ])('refuses a plain-text body that is %s', (_name, text) => {
    expect(codeOf(checkOutgoingMail(aMail({ text })))).toBe('mail.bodyInvalid')
  })

  it('refuses an HTML alternative that is empty, since a part that renders as nothing is a template that did not fill', () => {
    expect(codeOf(checkOutgoingMail(aMail({ html: '  ' })))).toBe('mail.bodyInvalid')
  })

  it('reports an invalid message as invalid, not as a failure of the relay', () => {
    const result = checkOutgoingMail(aMail({ subject: '' }))

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})
