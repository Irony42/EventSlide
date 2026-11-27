import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import {
  eventClosedMail,
  eventPageUrl,
  invitationAcceptedMail,
  isUrlLike,
  jobDoneMail,
  windowEndingMail,
  type JobKind,
} from './eventNoticeMails'
import { checkOutgoingMail } from './outgoingMail'

const to = (() => {
  const made = EmailAddress.create('hote@example.test')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const PAGE = 'https://photos.example.com/admin/events/camille-et-sacha/book'
const NBSP = String.fromCharCode(160)
const JOBS: readonly JobKind[] = ['archive', 'book', 'reel']

const base = (locale: (typeof CLIENT_LOCALES)[number], eventName = 'Camille et Sacha') => ({
  to,
  locale,
  eventName,
  pageUrl: PAGE,
})

const links = (text: string): string[] => text.match(/https?:\/\/\S+/g) ?? []

describe('jobDoneMail (A2)', () => {
  it('says the book is ready, in French, with the page of the book', () => {
    const mail = jobDoneMail({ ...base('fr'), job: 'book', outcome: 'done' })

    expect(mail.subject).toBe(`Le livre photo de «${NBSP}Camille et Sacha${NBSP}» est prêt.`)
    expect(mail.text).toContain(`Le livre photo de «${NBSP}Camille et Sacha${NBSP}» est prêt.`)
    expect(mail.text.split('\n')).toContain(PAGE)
  })

  it('says a failure and what to do, for each of the three jobs', () => {
    for (const job of JOBS) {
      const mail = jobDoneMail({ ...base('fr'), job, outcome: 'failed' })
      expect(mail.text).toMatch(
        new RegExp(`n’a pas pu être faite?${NBSP}; réessayez depuis la page.`),
      )
    }
    expect(jobDoneMail({ ...base('en'), job: 'archive', outcome: 'failed' }).subject).toBe(
      'The archive of "Camille et Sacha" could not be made; try again from the page.',
    )
  })

  it('names each job in its own words', () => {
    const subjects = JOBS.map((job) => jobDoneMail({ ...base('en'), job, outcome: 'done' }).subject)
    expect(subjects).toEqual([
      'The archive of "Camille et Sacha" is ready.',
      'The photo book of "Camille et Sacha" is ready.',
      'The highlight film of "Camille et Sacha" is ready.',
    ])
  })
})

describe('eventClosedMail (A3)', () => {
  const figures = { photos: 412, videos: 9, messages: 38 }

  it('says the figures and when the album goes, the day read in UTC', () => {
    const mail = eventClosedMail({
      ...base('fr'),
      ...figures,
      deleteAt: new Date('2027-03-01T23:30:00.000Z'),
    })

    expect(mail.subject).toBe(`«${NBSP}Camille et Sacha${NBSP}» est terminé`)
    expect(mail.text).toContain(
      `«${NBSP}Camille et Sacha${NBSP}» est terminé${NBSP}: 412 photos, 9 vidéos, 38 messages au livre d’or.`,
    )
    expect(mail.text).toContain('L’album, le livre photo et le film sont dans la console.')
    expect(mail.text).toContain('L’album sera supprimé le 1 mars 2027.')
  })

  it('says nothing of a deletion when none is planned, and leaves out a figure that is zero, singular when one', () => {
    const mail = eventClosedMail({
      ...base('en'),
      photos: 1,
      videos: 0,
      messages: 1,
      deleteAt: null,
    })

    expect(mail.text).toContain('"Camille et Sacha" is over: 1 photo, 1 message in the guestbook.')
    expect(mail.text).not.toContain('video')
    expect(mail.text).not.toContain('deleted')
  })
})

describe('windowEndingMail (A5)', () => {
  it('says the day the wall closes, read in the invitation’s zone, without an hour', () => {
    const endsAt = new Date('2026-11-28T23:30:00.000Z')

    const paris = windowEndingMail({ ...base('fr'), endsAt, timeZone: 'Europe/Paris' })
    const utc = windowEndingMail({ ...base('fr'), endsAt, timeZone: 'UTC' })

    expect(paris.text).toContain('se fermera le 29 novembre 2026')
    expect(utc.text).toContain('se fermera le 28 novembre 2026')
    expect(paris.text).toContain(
      `Les invités ne pourront plus envoyer de photos${NBSP}; l’album reste.`,
    )
    expect(paris.subject).toBe(`Le mur de «${NBSP}Camille et Sacha${NBSP}» se ferme bientôt`)
  })
})

describe('invitationAcceptedMail (A6)', () => {
  it('names who accepted to moderate the event', () => {
    const mail = invitationAcceptedMail({
      ...base('fr'),
      who: 'Marie Dupont',
      role: 'moderator',
    })

    expect(mail.text).toContain(
      `Marie Dupont a accepté de modérer «${NBSP}Camille et Sacha${NBSP}».`,
    )
    expect(mail.subject).toBe(`Une invitation a été acceptée pour «${NBSP}Camille et Sacha${NBSP}»`)
  })
})

describe('every event mail', () => {
  const all = (locale: (typeof CLIENT_LOCALES)[number], name: string) => [
    ...JOBS.flatMap((job) => [
      jobDoneMail({ ...base(locale, name), job, outcome: 'done' }),
      jobDoneMail({ ...base(locale, name), job, outcome: 'failed' }),
    ]),
    eventClosedMail({
      ...base(locale, name),
      photos: 5,
      videos: 2,
      messages: 3,
      deleteAt: new Date('2027-03-01T10:00:00.000Z'),
    }),
    windowEndingMail({
      ...base(locale, name),
      endsAt: new Date('2026-11-28T10:00:00.000Z'),
      timeZone: 'Europe/Paris',
    }),
    invitationAcceptedMail({ ...base(locale, name), who: 'Marie', role: 'moderator' }),
  ]

  it('is a valid one-line-subject mail with one link and the way to switch it off, in the five languages', () => {
    for (const locale of CLIENT_LOCALES) {
      for (const mail of all(locale, 'Camille et Sacha')) {
        expect(checkOutgoingMail(mail).ok).toBe(true)
        expect(mail.subject).not.toMatch(/[\r\n]/)
        expect(mail.subject).not.toContain('!')
        expect(links(mail.text)).toEqual([PAGE])
        const lines = mail.text.trimEnd().split('\n')
        expect(lines.at(-3)).toMatch(/\S/)
        expect(lines.at(-1)).toBe('EventSlide')
      }
    }
  })

  it('folds an event name written on several lines to one, in the subject and the text', () => {
    for (const locale of CLIENT_LOCALES) {
      for (const mail of all(locale, 'Camille\r\nBcc: x@y.test\net Sacha')) {
        expect(mail.subject).not.toMatch(/[\r\n]/)
        expect(mail.text).not.toContain('Bcc: x@y.test\n')
        expect(mail.text).toContain('Camille Bcc: x@y.test et Sacha')
      }
    }
  })

  it('is not the same mail in two languages', () => {
    const subjects = CLIENT_LOCALES.map(
      (locale) => jobDoneMail({ ...base(locale), job: 'book', outcome: 'done' }).subject,
    )
    expect(new Set(subjects).size).toBe(CLIENT_LOCALES.length)
  })
})

describe('isUrlLike', () => {
  it('sees a scheme, www and a domain name, and lets a plain name through', () => {
    for (const name of [
      'https://x.test',
      'http://x',
      'www.x.test',
      'evil.example',
      'evil.example/a',
      'Marie.Dupont@x.fr',
    ]) {
      expect(isUrlLike(name), name).toBe(true)
    }
    for (const name of ['Marie Dupont', 'Jean-Pierre', 'Léa', 'M. Dupont', 'Anne-Sophie B.']) {
      expect(isUrlLike(name), name).toBe(false)
    }
  })
})

describe('eventPageUrl', () => {
  it('points at the event in the console, the slug escaped, with an optional page', () => {
    expect(eventPageUrl('https://photos.example.com', 'camille-et-sacha')).toBe(
      'https://photos.example.com/admin/events/camille-et-sacha',
    )
    expect(eventPageUrl('https://photos.example.com', 'a b', 'settings')).toBe(
      'https://photos.example.com/admin/events/a%20b/settings',
    )
  })
})
