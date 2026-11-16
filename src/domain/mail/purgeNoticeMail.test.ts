import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail } from './outgoingMail'
import { purgeNoticeMail, purgeNoticePageUrl } from './purgeNoticeMail'

const to = (() => {
  const made = EmailAddress.create('hote@example.test')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const DELETE_AT = new Date('2026-12-12T23:30:00.000Z')
const PAGE = 'https://photos.example.com/admin/events/camille-et-sacha'

const mail = (locale: (typeof CLIENT_LOCALES)[number], eventName = 'Camille et Sacha') =>
  purgeNoticeMail({ to, locale, eventName, deleteAt: DELETE_AT, pageUrl: PAGE })

describe('purgeNoticeMail', () => {
  it('says in French which album goes, when, and where to download it, and that no photo is attached', () => {
    const message = mail('fr')

    expect(message.subject).toBe(
      'Votre album « Camille et Sacha » sera supprimé le 12 décembre 2026',
    )
    expect(message.text).toContain(
      'Votre album « Camille et Sacha » sera supprimé le 12 décembre 2026, comme annoncé à vos invités.',
    )
    expect(message.text).toContain('Ce message ne contient aucune photo.')
  })

  it('puts the address of the event page on a line of its own', () => {
    expect(mail('fr').text.split('\n')).toContain(PAGE)
  })

  it('is plain text: no HTML part, nothing to click but the page', () => {
    expect(mail('en').html).toBeUndefined()
  })

  it.each(CLIENT_LOCALES)('is written in %s, with the date and the name in it', (locale) => {
    const message = mail(locale)

    expect(message.subject).toContain('Camille et Sacha')
    expect(message.subject).toContain('2026')
    expect(message.text).toContain(PAGE)
  })

  it('gives each language its own words', () => {
    const subjects = new Set(CLIENT_LOCALES.map((locale) => mail(locale).subject))

    expect(subjects.size).toBe(CLIENT_LOCALES.length)
  })

  it('names the day in UTC, because the retention counts in UTC days', () => {
    // 23:30 UTC is already the 13th in Paris; the retention's day is the 12th.
    expect(mail('en').subject).toContain('December 12, 2026')
  })

  it('folds the album name to one line, so a name cannot lay out the message or the header', () => {
    const message = mail('fr', 'Camille\net\tSacha')

    expect(message.subject).not.toMatch(/[\n\r\t]/)
    expect(message.subject).toContain('Camille et Sacha')
  })

  it('passes the rules every mailer applies, in every language, even for a long name', () => {
    for (const locale of CLIENT_LOCALES) {
      expect(checkOutgoingMail(mail(locale)).ok).toBe(true)
      expect(checkOutgoingMail(mail(locale, 'x'.repeat(60))).ok).toBe(true)
    }
  })

  it('carries nothing of the album: no caption, no guest, only the name the host typed', () => {
    const message = mail('de')

    expect(message.text).not.toMatch(/\.jpg|\.mp4|guest|invité/i)
  })
})

describe('purgeNoticePageUrl', () => {
  it('points at the event page in the host console, under the public origin', () => {
    expect(purgeNoticePageUrl('https://photos.example.com', 'camille-et-sacha')).toBe(PAGE)
  })

  it('encodes the slug rather than trusting it', () => {
    expect(purgeNoticePageUrl('https://photos.example.com', 'a b')).toBe(
      'https://photos.example.com/admin/events/a%20b',
    )
  })
})
