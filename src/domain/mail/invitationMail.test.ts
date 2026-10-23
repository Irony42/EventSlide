import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import {
  invitationLink,
  invitationMail,
  type InvitationMailInput,
  type InvitationMailTarget,
} from './invitationMail'
import { checkOutgoingMail } from './outgoingMail'

const parsed = EmailAddress.create('camille@example.test')
if (!parsed.ok) throw new Error('invalid fixture')
const TO = parsed.value

const LINK = 'https://photos.example.test/invite/AbC-123_xyz'

const EVENT: InvitationMailTarget = { kind: 'event', name: 'Mariage de Camille' }
const OWNER: InvitationMailTarget = { kind: 'client', name: 'Camille et Sacha', role: 'owner' }
const MEMBER: InvitationMailTarget = { kind: 'client', name: 'Camille et Sacha', role: 'member' }

const TARGETS = [
  ['an event', EVENT],
  ['a client owner', OWNER],
  ['a client member', MEMBER],
] as const

const mailIn = (
  locale: (typeof CLIENT_LOCALES)[number],
  target: InvitationMailTarget = EVENT,
  over: Partial<InvitationMailInput> = {},
) => invitationMail({ to: TO, locale, link: LINK, target, lifetimeDays: 7, ...over })

describe('invitationMail', () => {
  describe.each(TARGETS)('to %s', (_label, target) => {
    it.each(CLIENT_LOCALES)('is a message the mailer accepts, in %s', (locale) => {
      expect(checkOutgoingMail(mailIn(locale, target)).ok).toBe(true)
    })

    it.each(CLIENT_LOCALES)(
      'carries the link exactly once, on a line of its own, in %s',
      (locale) => {
        const { text } = mailIn(locale, target)

        expect(text.split(LINK)).toHaveLength(2)
        expect(text.split('\n')).toContain(LINK)
      },
    )

    it.each(CLIENT_LOCALES)('names the target as it was written, in %s', (locale) => {
      expect(mailIn(locale, target).text).toContain(target.name)
    })

    it.each(CLIENT_LOCALES)(
      'is plain text with nothing that fetches or tracks, in %s',
      (locale) => {
        const mail = mailIn(locale, target)

        expect(mail.html).toBeUndefined()
        expect(mail.text.match(/https?:\/\//g)).toHaveLength(1)
      },
    )

    it.each(CLIENT_LOCALES)('leaves no unfilled placeholder behind, in %s', (locale) => {
      const { subject, text } = mailIn(locale, target)

      expect(`${subject}${text}`).not.toMatch(/[{}]|undefined|NaN/)
    })

    it.each(CLIENT_LOCALES)('says how long the link works, in %s', (locale) => {
      const { text } = mailIn(locale, target, { lifetimeDays: 3 })

      expect(text).toContain('3')
      expect(text).not.toContain('7')
    })
  })

  it('addresses the recipient it was given', () => {
    expect(mailIn('fr').to).toBe(TO)
  })

  it('is written in the language it was asked for', () => {
    expect(mailIn('fr').text).toContain('Bonjour')
    expect(mailIn('en').text).toContain('Hello')
    expect(mailIn('de').text).toContain('Guten Tag')
    expect(mailIn('es').text).toContain('Hola')
    expect(mailIn('it').text).toContain('Buongiorno')
  })

  it('gives each language a subject of its own, and an event a different one from a client', () => {
    const eventSubjects = CLIENT_LOCALES.map((locale) => mailIn(locale, EVENT).subject)
    const clientSubjects = CLIENT_LOCALES.map((locale) => mailIn(locale, OWNER).subject)

    expect(new Set(eventSubjects).size).toBe(CLIENT_LOCALES.length)
    expect(new Set(clientSubjects).size).toBe(CLIENT_LOCALES.length)
    for (const locale of CLIENT_LOCALES) {
      expect(mailIn(locale, EVENT).subject).not.toBe(mailIn(locale, OWNER).subject)
    }
  })

  it('keeps the subject free of the target, which is a name somebody typed', () => {
    for (const locale of CLIENT_LOCALES) {
      for (const [, target] of TARGETS) {
        expect(mailIn(locale, target).subject).not.toContain(target.name)
      }
    }
  })

  it('says a client owner is asked to manage a space and a member to join it', () => {
    expect(mailIn('en', OWNER).text).toContain('manage the EventSlide space')
    expect(mailIn('en', MEMBER).text).toContain('join the EventSlide space')
    expect(mailIn('en', EVENT).text).toContain('moderate the event')
  })

  it('writes the French with its accents, since it is the copy the others follow', () => {
    expect(mailIn('fr').subject).toBe('Invitation à modérer un événement sur EventSlide')
    expect(mailIn('fr').text).toContain("Vous êtes invité(e) à modérer l'événement")
  })

  it('tells a stranger that ignoring it costs nothing, because nothing happens until the link is opened', () => {
    expect(mailIn('en').text).toContain('nothing happens until this link is opened')
    expect(mailIn('fr').text).toContain("rien ne se passe tant que ce lien n'est pas ouvert")
  })

  it('does not say who invited them, or whether they already have an account', () => {
    const { text } = mailIn('en', EVENT)

    expect(text).not.toMatch(/account|compte|invited by|sign in/i)
  })

  it('prints a name on one line, so a name cannot lay out the message', () => {
    const { text } = mailIn('en', { kind: 'event', name: 'Line one\r\n\r\nBcc: x\t  Line two' })

    expect(text).toContain('"Line one Bcc: x Line two"')
  })
})

describe('invitationLink', () => {
  it('is a path under the public origin, with the token in the path', () => {
    expect(invitationLink('https://photos.example.test', 'AbC-123_xyz')).toBe(LINK)
  })

  it('keeps the token out of the query string, where logs keep it', () => {
    expect(invitationLink('https://photos.example.test', 'tok')).not.toContain('?')
  })

  it('encodes a token that is not path-safe rather than letting it end the path', () => {
    expect(invitationLink('https://photos.example.test', 'a/b?c#d')).toBe(
      'https://photos.example.test/invite/a%2Fb%3Fc%23d',
    )
  })
})
