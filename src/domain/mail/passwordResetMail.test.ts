import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail } from './outgoingMail'
import { passwordResetLink, passwordResetMail } from './passwordResetMail'

const parsed = EmailAddress.create('camille@example.test')
if (!parsed.ok) throw new Error('invalid fixture')
const TO = parsed.value

const LINK = 'https://photos.example.test/password/reset/AbC-123_xyz'

const mailIn = (locale: (typeof CLIENT_LOCALES)[number], link = LINK, lifetimeMinutes = 60) =>
  passwordResetMail({ to: TO, locale, link, lifetimeMinutes })

describe('passwordResetMail', () => {
  it.each(CLIENT_LOCALES)('is a message the mailer accepts, in %s', (locale) => {
    expect(checkOutgoingMail(mailIn(locale)).ok).toBe(true)
  })

  it.each(CLIENT_LOCALES)(
    'carries the link exactly once, on a line of its own, in %s',
    (locale) => {
      const { text } = mailIn(locale)

      expect(text.split(LINK)).toHaveLength(2)
      expect(text.split('\n')).toContain(LINK)
    },
  )

  it.each(CLIENT_LOCALES)('says how long the link works, in %s', (locale) => {
    expect(mailIn(locale, LINK, 45).text).toContain('45')
    expect(mailIn(locale, LINK, 45).text).not.toContain('60')
  })

  it.each(CLIENT_LOCALES)('is plain text with nothing that fetches or tracks, in %s', (locale) => {
    const mail = mailIn(locale)

    expect(mail.html).toBeUndefined()
    expect(mail.text.match(/https?:\/\//g)).toHaveLength(1)
  })

  it.each(CLIENT_LOCALES)('leaves no unfilled placeholder behind, in %s', (locale) => {
    const { subject, text } = mailIn(locale)

    expect(`${subject}${text}`).not.toMatch(/[{}]|undefined|NaN/)
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

  it('gives each language a subject of its own', () => {
    const subjects = CLIENT_LOCALES.map((locale) => mailIn(locale).subject)

    expect(new Set(subjects).size).toBe(CLIENT_LOCALES.length)
  })

  it('writes the French with its accents, since it is the copy the others follow', () => {
    expect(mailIn('fr').subject).toBe('Réinitialisation de votre mot de passe EventSlide')
    expect(mailIn('fr').text).toContain("n'êtes pas à l'origine")
  })

  it('tells the reader what to do if they did not ask, so the mail is safe to ignore', () => {
    expect(mailIn('en').text).toContain('your current password still works')
  })
})

describe('passwordResetLink', () => {
  it('is a path under the public origin, with the token in the path', () => {
    expect(passwordResetLink('https://photos.example.test', 'AbC-123_xyz')).toBe(LINK)
  })

  it('keeps the token out of the query string, where logs keep it', () => {
    expect(passwordResetLink('https://photos.example.test', 'tok')).not.toContain('?')
  })

  it('encodes a token that is not path-safe rather than letting it end the path', () => {
    expect(passwordResetLink('https://photos.example.test', 'a/b?c#d')).toBe(
      'https://photos.example.test/password/reset/a%2Fb%3Fc%23d',
    )
  })
})
