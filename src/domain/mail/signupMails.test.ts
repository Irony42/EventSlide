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

/** The confirmation, unwrapped: these cases all pass a whole number of hours. */
const confirmation = (input: Parameters<typeof signupConfirmationMail>[0]): OutgoingMail => {
  const made = signupConfirmationMail(input)
  if (!made.ok) throw new Error('invalid fixture')
  return made.value
}

/** The notice, unwrapped: these cases all pass a count of at least one. */
const notice = (input: Parameters<typeof signupOperatorNoticeMail>[0]): OutgoingMail => {
  const made = signupOperatorNoticeMail(input)
  if (!made.ok) throw new Error('invalid fixture')
  return made.value
}

const NBSP = String.fromCodePoint(0xa0)
const ADDRESS_SHAPED = /[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+\.?/g
const TRAILING_STOP = /\.$/

const urlPattern = /https?:\/\/\S+/g
const urlsIn = (text: string): string[] => text.match(urlPattern) ?? []

const everyMail = (locale: (typeof CLIENT_LOCALES)[number]): readonly OutgoingMail[] => [
  confirmation({ to: TO, locale, link: LINK, lifetimeHours: 24 }),
  signupRefusedMail({ to: TO, locale, selfHostLink: LINK, replyTo: CONTACT }),
  notice({ to: TO, locale, kind: 'opened', count: 2, link: LINK }),
  notice({ to: TO, locale, kind: 'waiting', count: 1, link: LINK }),
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
      const mail = confirmation({ to: TO, locale: 'en', link: LINK, lifetimeHours: 24 })
      expect(mail.text).toContain('24 hours')
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses %s hours: no mail says "within the next 1.5 hours"',
      (lifetimeHours) => {
        const made = signupConfirmationMail({ to: TO, locale: 'fr', link: LINK, lifetimeHours })
        expect(!made.ok && made.error.code).toBe('signup.confirmation.lifetimeInvalid')
      },
    )

    it('says nothing is created if the reader asked for nothing', () => {
      const mail = confirmation({ to: TO, locale: 'fr', link: LINK, lifetimeHours: 24 })
      expect(mail.text).toContain('rien ne sera créé')
    })

    it('does not say whether the address has an account, nor names anyone', () => {
      for (const locale of CLIENT_LOCALES) {
        const { text } = confirmation({ to: TO, locale, link: LINK, lifetimeHours: 24 })
        expect(text).not.toContain(TO.value)
      }
    })

    it('has no reply address', () => {
      expect(
        confirmation({ to: TO, locale: 'fr', link: LINK, lifetimeHours: 24 }).replyTo,
      ).toBeUndefined()
    })
  })

  describe('signupRefusedMail', () => {
    it('carries no Reply-To when none is given, and the given one when there is', () => {
      const without = signupRefusedMail({ to: TO, locale: 'fr', selfHostLink: LINK })
      const withContact = signupRefusedMail({
        to: TO,
        locale: 'fr',
        selfHostLink: LINK,
        replyTo: CONTACT,
      })

      expect('replyTo' in without).toBe(false)
      expect(withContact.replyTo).toBe(CONTACT)
    })

    it('is answered at the contact address and gives no reason', () => {
      const mail = signupRefusedMail({ to: TO, locale: 'en', selfHostLink: LINK, replyTo: CONTACT })
      expect(mail.replyTo).toBe(CONTACT)
      expect(mail.text).toContain('cannot open an account')
    })
  })

  describe('signupOperatorNoticeMail', () => {
    it.each([0, -1, 1.5, Number.NaN])(
      'refuses a count of %s: there is nothing to tell',
      (count) => {
        const made = signupOperatorNoticeMail({
          to: TO,
          locale: 'en',
          kind: 'waiting',
          count,
          link: LINK,
        })
        expect(!made.ok && made.error.code).toBe('signup.notice.countInvalid')
      },
    )

    it('counts, singular and plural, and carries no address', () => {
      const one = notice({
        to: CONTACT,
        locale: 'en',
        kind: 'waiting',
        count: 1,
        link: LINK,
      })
      const many = notice({
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
        const one = notice({ to: TO, locale, kind, count: 1, link: LINK })
        const five = notice({ to: TO, locale, kind, count: 5, link: LINK })
        expect(one.subject).toContain('1')
        expect(five.subject).toContain('5')
      }
    })

    it('tells accounts opened from requests waiting', () => {
      const opened = notice({
        to: TO,
        locale: 'fr',
        kind: 'opened',
        count: 2,
        link: LINK,
      })
      const waiting = notice({
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
    it('carries the contact address and no other: the one address in the body, outside the link', () => {
      for (const locale of CLIENT_LOCALES) {
        const { text } = welcomeMail({ to: TO, locale, guidesLink: LINK, contact: CONTACT })
        // Every address-shaped word, a trailing full stop left out: only the contact's.
        const found = (text.match(ADDRESS_SHAPED) ?? []).map((word) =>
          word.replace(TRAILING_STOP, ''),
        )
        expect(found).toEqual([CONTACT.value])
      }
    })

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

  describe('French typography', () => {
    // The one-hour confirmation is a different sentence from the 24-hour one.
    const french = [
      ...everyMail('fr'),
      confirmation({ to: TO, locale: 'fr', link: LINK, lifetimeHours: 1 }),
    ].flatMap((mail) => [mail.subject, mail.text])

    it('puts a no-break space before : ; ! ? and » and inside « », in every French string', () => {
      for (const text of french) {
        expect(text).not.toMatch(/ [:?!;»]/)
        expect(text).not.toMatch(/« /)
      }
    })
    it('does use the no-break space where the French punctuation needs one', () => {
      const text = french.join(String.fromCodePoint(0x0a))
      expect(text).toContain(`${NBSP}:`)
      expect(text).toContain(`${NBSP}?`)
    })

    it('has U+00A0, by code point, before every : ; ! ? outside the links', () => {
      let checked = 0
      for (const text of french) {
        const prose = text.replace(urlPattern, '')
        for (let index = 0; index < prose.length; index += 1) {
          if (!':;!?'.includes(prose.charAt(index))) continue
          checked += 1
          expect(prose.charCodeAt(index - 1), `before "${prose.charAt(index)}" in: ${prose}`).toBe(
            0xa0,
          )
        }
      }
      expect(checked).toBeGreaterThan(5)
    })
  })

  describe('the hours in a confirmation', () => {
    const open = (locale: (typeof CLIENT_LOCALES)[number], lifetimeHours: number): string =>
      confirmation({ to: TO, locale, link: LINK, lifetimeHours }).text

    it.each([
      ['fr', 'l’heure qui vient', 'les 2 heures'],
      ['en', 'next hour:', 'next 2 hours:'],
      ['de', 'nächsten Stunde:', 'nächsten 2 Stunden:'],
      ['es', 'en la próxima hora:', 'en las próximas 2 horas:'],
      ['it', 'entro la prossima ora:', 'entro le prossime 2 ore:'],
    ] as const)(
      'says one hour in the singular and two in the plural, in %s',
      (locale, one, two) => {
        expect(open(locale, 1)).toContain(one)
        expect(open(locale, 2)).toContain(two)
      },
    )

    it('does not write "1 hours" or "1 heures" anywhere', () => {
      for (const locale of CLIENT_LOCALES)
        expect(open(locale, 1)).not.toMatch(/(^| )1 (hours|heures|Stunden|horas|ore)/)
    })
  })

  describe('links', () => {
    it('puts the confirmation token in the path, escaped, and the language in the query', () => {
      expect(signupConfirmLink('https://app.example.test', 'a b/c', 'de')).toBe(
        'https://app.example.test/signup/confirm/a%20b%2Fc?lang=de',
      )
    })

    it('points the console link at the signups page', () => {
      expect(signupConsoleLink('https://app.example.test')).toBe(
        'https://app.example.test/admin/site/signups',
      )
    })
  })
})
