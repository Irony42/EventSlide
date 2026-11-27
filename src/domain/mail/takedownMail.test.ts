import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail, MAX_SUBJECT_LENGTH } from './outgoingMail'
import { TAKEDOWN_KINDS, takedownMail, type TakedownKind } from './takedownMail'

const address = (raw: string): EmailAddress => {
  const made = EmailAddress.create(raw)
  if (!made.ok) throw new Error('fixture')
  return made.value
}
const TO = address('hote@example.test')
const CONTACT = address('contact@operateur.example')
const AT = new Date('2026-11-27T23:30:00.000Z')
const NBSP = String.fromCharCode(160)

const mail = (kind: TakedownKind, patch: Partial<Parameters<typeof takedownMail>[0]> = {}) =>
  takedownMail({
    to: TO,
    locale: 'fr',
    kind,
    name: 'Camille et Sacha',
    at: AT,
    reason: null,
    replyTo: null,
    ...patch,
  })

describe('takedownMail (A4)', () => {
  it('says a photograph of the event was removed, by the event name only, with the day', () => {
    const made = mail('photo')

    expect(made.subject).toBe(`Une photo a été retirée de «${NBSP}Camille et Sacha${NBSP}»`)
    expect(made.text).toContain(
      `Une photo de l’évènement «${NBSP}Camille et Sacha${NBSP}» a été retirée par l’opérateur de ce serveur.`,
    )
    expect(made.text).toContain('Le 27 novembre 2026.')
  })

  it('carries the reason for the host when there is one, and nothing when there is none', () => {
    expect(
      mail('event', { reason: 'Signalement reçu.\nMerci de votre compréhension.' }).text,
    ).toContain(`Motif${NBSP}: Signalement reçu.\nMerci de votre compréhension.`)
    expect(mail('event').text).not.toContain('Motif')
  })

  it('says how to contest it: answer the mail when the operator has a contact address, else write to the operator', () => {
    const replied = mail('guestbook', { replyTo: CONTACT })
    expect(replied.replyTo).toEqual(CONTACT)
    expect(replied.text).toContain('répondez à ce message')

    const written = mail('guestbook')
    expect(written.replyTo).toBeUndefined()
    expect(written.text).toContain('écrivez à l’opérateur de ce serveur')
  })

  it('has no link, and no contest sentence for the lifting of a suspension', () => {
    for (const kind of TAKEDOWN_KINDS) {
      expect(mail(kind).text, kind).not.toMatch(/https?:\/\//)
    }
    expect(mail('clientResumed').text).not.toContain('contester')
    expect(mail('clientSuspended').text).toContain('contester')
  })

  it('names the day the albums go when a space is closed, and only then', () => {
    const closed = mail('clientOffboarded', { purgeAt: new Date('2027-01-10T08:00:00.000Z') })
    expect(closed.text).toContain('Vos albums seront supprimés le 10 janvier 2027.')
    expect(mail('clientOffboarded').text).not.toContain('supprimés')
    expect(
      mail('clientSuspended', { purgeAt: new Date('2027-01-10T08:00:00.000Z') }).text,
    ).not.toContain('supprimés')
  })

  it('is a valid one-line, short-subject mail in every language and for every kind, even with the longest name an event can have, folded to one line', () => {
    const long = `${'Longue '.repeat(16)}\r\nBcc: x@y.test`
    for (const locale of CLIENT_LOCALES) {
      for (const kind of TAKEDOWN_KINDS) {
        const made = mail(kind, { locale, name: long, reason: 'Motif.', replyTo: CONTACT })
        expect(checkOutgoingMail(made).ok, `${locale} ${kind}`).toBe(true)
        expect(made.subject).not.toMatch(/[\r\n]/)
        expect(made.subject.length).toBeLessThan(MAX_SUBJECT_LENGTH)
        expect(made.text).not.toContain('Bcc: x@y.test\n')
        expect(made.text.trimEnd().split('\n').at(-1)).toBe('EventSlide')
      }
    }
  })

  it('is not the same mail in two languages', () => {
    const subjects = CLIENT_LOCALES.map((locale) => mail('photo', { locale }).subject)
    expect(new Set(subjects).size).toBe(CLIENT_LOCALES.length)
  })
})
