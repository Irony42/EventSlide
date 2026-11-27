import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail } from './outgoingMail'
import { rsvpErasureMail, rsvpErasurePageUrl } from './rsvpNoticeMails'

const to = (() => {
  const made = EmailAddress.create('hote@example.test')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const ERASURE = new Date('2027-01-12T00:00:00.000Z')
const PAGE = 'https://photos.example.com/admin/events/camille-et-sacha/rsvps'
const NBSP = String.fromCharCode(160)

const mail = (
  locale: (typeof CLIENT_LOCALES)[number],
  over: { eventName?: string; replies?: number } = {},
) =>
  rsvpErasureMail({
    to,
    locale,
    eventName: over.eventName ?? 'Camille et Sacha',
    erasureDate: ERASURE,
    replies: over.replies ?? 31,
    pageUrl: PAGE,
  })

describe('rsvpErasureMail', () => {
  it('says in French which replies go, how many, when, with the non-breaking spaces of the language', () => {
    const message = mail('fr')

    expect(message.subject).toBe(
      `Les réponses de «${NBSP}Camille et Sacha${NBSP}» seront effacées le 12 janvier 2027`,
    )
    expect(message.text).toContain('(31 réponses)')
    expect(message.text).toContain(`Pour la télécharger${NBSP}:`)
    expect(message.text).toContain('Ce message ne contient le nom d’aucun invité.')
  })

  it('puts the replies page on a line of its own, and nothing else that is a link', () => {
    const message = mail('en')

    expect(message.text.split('\n')).toContain(PAGE)
    expect(message.text.match(/https?:\/\//g)).toHaveLength(1)
  })

  it('is plain text with no HTML part', () => {
    expect(mail('en').html).toBeUndefined()
  })

  it.each(CLIENT_LOCALES)(
    'is written in %s, with the name and the year in the subject',
    (locale) => {
      const message = mail(locale)

      expect(message.subject).toContain('Camille et Sacha')
      expect(message.subject).toContain('2027')
      expect(message.text).toContain('31')
      expect(checkOutgoingMail(message).ok).toBe(true)
    },
  )

  it('gives each language its own words', () => {
    expect(new Set(CLIENT_LOCALES.map((locale) => mail(locale).subject)).size).toBe(5)
  })

  it.each(CLIENT_LOCALES)('uses the singular for one reply in %s', (locale) => {
    expect(mail(locale, { replies: 1 }).text).not.toBe(mail(locale, { replies: 2 }).text)
  })

  it('folds a name with a line break to one line, so it cannot inject a header', () => {
    const message = mail('fr', { eventName: 'Soirée\r\nBcc: x@example.test' })

    expect(message.subject).not.toMatch(/[\r\n]/)
  })
})

describe('rsvpErasurePageUrl', () => {
  it('is the replies page of the event under the public origin, the slug encoded', () => {
    expect(rsvpErasurePageUrl('https://photos.example.com', 'camille-et-sacha')).toBe(PAGE)
    expect(rsvpErasurePageUrl('https://photos.example.com', 'a b')).toBe(
      'https://photos.example.com/admin/events/a%20b/rsvps',
    )
  })
})
