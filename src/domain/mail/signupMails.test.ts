import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail, type OutgoingMail } from './outgoingMail'
import {
  signupConfirmLink,
  signupConfirmationMail,
  signupConsoleLink,
  signupOperatorNoticeMail,
  signupRefusedMail,
  welcomeMail,
} from './signupMails'

const addr = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error('invalid fixture')
  return parsed.value
}

const TO = addr('camille@example.test')
const CONTACT = addr('contact@eventslide.test')
const LINK = 'https://app.example.test/signup/confirm/AbC-123_xyz'

const urlsIn = (text: string): string[] => text.match(/https?:\/\/\S+/g) ?? []

const everyMail = (locale: (typeof CLIENT_LOCALES)[number]): readonly OutgoingMail[] => [
  signupConfirmationMail({ to: TO, locale, link: LINK, lifetimeHours: 24 }),
  signupRefusedMail({ to: TO, locale, selfHostLink: LINK, replyTo: CONTACT }),
  signupOperatorNoticeMail({ to: TO, locale, kind: 'opened', count: 2, link: LINK }),
  signupOperatorNoticeMail({ to: TO, locale, kind: 'waiting', count: 1, link: LINK }),
  welcomeMail({ to: TO, locale, guidesLink: LINK, contact: CONTACT }),
]

describe('signup mails', () => {
  describe.each(CLIENT_LOCALES)('in %s', (locale) => {
    it('are all messages the mailer accepts', () => {
      for (const mail of everyMail(locale)) expect(checkOutgoingMail(mail).ok).toBe(true)
    })

    it('carry exactly one link, on a line of its own, and no markup', () => {
      for (const mail of everyMail(locale)) {
        expect(urlsIn(mail.text)).toEqual([LINK])
        expect(mail.text.split('\n')).toContain(LINK)
        expect(mail.html).toBeUndefined()
      }
    })

    it('have a distinct one-line subject each, apart from the two notices', () => {
      const subjects = everyMail(locale).map((mail) => mail.subject)
      expect(new Set(subjects).size).toBe(subjects.length)
    })
  })

  describe('signupConfirmationMail', () => {
    it('states how long the link works', () => {
      const mail = signupConfirmationMail({ to: TO, locale: 'en', link: LINK, lifetimeHours: 24 })
      expect(mail.text).toContain('24 hours')
    })

    it('says nothing is created if the reader asked for nothing', () => {
      const mail = signupConfirmationMail({ to: TO, locale: 'fr', link: LINK, lifetimeHours: 24 })
      expect(mail.text).toContain('rien ne sera créé')
    })

    it('does not say whether the address has an account, nor names anyone', () => {
      for (const locale of CLIENT_LOCALES) {
        const { text } = signupConfirmationMail({ to: TO, locale, link: LINK, lifetimeHours: 24 })
        expect(text).not.toContain(TO.value)
      }
    })

    it('has no reply address', () => {
      expect(
        signupConfirmationMail({ to: TO, locale: 'fr', link: LINK, lifetimeHours: 24 }).replyTo,
      ).toBeUndefined()
    })
  })

  describe('signupRefusedMail', () => {
    it('is answered at the contact address and gives no reason', () => {
      const mail = signupRefusedMail({ to: TO, locale: 'en', selfHostLink: LINK, replyTo: CONTACT })
      expect(mail.replyTo).toBe(CONTACT)
      expect(mail.text).toContain('cannot open an account')
    })
  })

  describe('signupOperatorNoticeMail', () => {
    it('counts, singular and plural, and carries no address', () => {
      const one = signupOperatorNoticeMail({
        to: CONTACT,
        locale: 'en',
        kind: 'waiting',
        count: 1,
        link: LINK,
      })
      const many = signupOperatorNoticeMail({
        to: CONTACT,
        locale: 'en',
        kind: 'waiting',
        count: 3,
        link: LINK,
      })
      expect(one.subject).toBe('1 signup to review')
      expect(many.subject).toBe('3 signups to review')
      expect(one.text).not.toContain('@')
    })

    it.each(CLIENT_LOCALES)('names the count in the subject, in %s', (locale) => {
      for (const kind of ['opened', 'waiting'] as const) {
        const one = signupOperatorNoticeMail({ to: TO, locale, kind, count: 1, link: LINK })
        const five = signupOperatorNoticeMail({ to: TO, locale, kind, count: 5, link: LINK })
        expect(one.subject).toContain('1')
        expect(five.subject).toContain('5')
      }
    })

    it('tells accounts opened from requests waiting', () => {
      const opened = signupOperatorNoticeMail({
        to: TO,
        locale: 'fr',
        kind: 'opened',
        count: 2,
        link: LINK,
      })
      const waiting = signupOperatorNoticeMail({
        to: TO,
        locale: 'fr',
        kind: 'waiting',
        count: 2,
        link: LINK,
      })
      expect(opened.subject).toBe('2 nouveaux comptes EventSlide')
      expect(waiting.subject).toBe('2 inscriptions à valider')
    })
  })

  describe('welcomeMail', () => {
    it('names the contact address and is answered there', () => {
      const mail = welcomeMail({ to: TO, locale: 'fr', guidesLink: LINK, contact: CONTACT })
      expect(mail.text).toContain(CONTACT.value)
      expect(mail.replyTo).toBe(CONTACT)
    })

    it('lists three first steps', () => {
      const { text } = welcomeMail({ to: TO, locale: 'en', guidesLink: LINK, contact: CONTACT })
      expect(text).toMatch(/1\. .*\n2\. .*\n3\. /)
    })
  })

  describe('links', () => {
    it('puts the confirmation token in the path, escaped', () => {
      expect(signupConfirmLink('https://app.example.test', 'a b/c')).toBe(
        'https://app.example.test/signup/confirm/a%20b%2Fc',
      )
    })

    it('points the console link at the signups page', () => {
      expect(signupConsoleLink('https://app.example.test')).toBe(
        'https://app.example.test/admin/site/signups',
      )
    })
  })
})
