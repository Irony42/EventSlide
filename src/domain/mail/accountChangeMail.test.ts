import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import { EmailAddress } from '../users/emailAddress'
import {
  ACCOUNT_CHANGE_KINDS,
  accountChangeMail,
  accountForgotUrl,
  carriesResetLink,
  type AccountChangeKind,
} from './accountChangeMail'
import { checkOutgoingMail } from './outgoingMail'

const address = (value: string): EmailAddress => {
  const made = EmailAddress.create(value)
  if (!made.ok) throw new Error('fixture')
  return made.value
}

const AT = new Date('2026-11-27T14:32:00.000Z')
const FORGOT = 'https://photos.example.com/password/forgot'
const NBSP = String.fromCharCode(160)

const mail = (
  kind: AccountChangeKind,
  locale: (typeof CLIENT_LOCALES)[number] = 'fr',
  replyTo: EmailAddress | null = null,
) =>
  accountChangeMail({
    to: address('hote@example.test'),
    locale,
    kind,
    at: AT,
    forgotUrl: FORGOT,
    replyTo,
  })

describe('accountChangeMail', () => {
  it('says in French that the password was changed, when, in UTC, and where to reset it at once', () => {
    const message = mail('passwordChanged')

    expect(message.subject).toBe('Votre mot de passe EventSlide a été changé')
    expect(message.text).toContain(
      'Le mot de passe de votre compte EventSlide a été changé le 27 novembre 2026 à 14:32 (UTC).',
    )
    expect(message.text).toContain(
      `Si ce n’est pas vous, réinitialisez votre mot de passe tout de suite${NBSP}:`,
    )
    expect(message.text.split('\n')).toContain(FORGOT)
  })

  it.each(ACCOUNT_CHANGE_KINDS)(
    'is plain text with one subject line and a greeting for %s',
    (kind) => {
      const message = mail(kind)

      expect(message.html).toBeUndefined()
      expect(message.subject).not.toMatch(/[\r\n]/)
      expect(message.text.startsWith('Bonjour,')).toBe(true)
      expect(checkOutgoingMail(message).ok).toBe(true)
    },
  )

  it('has the reset link for the five security acts and no link for the operator acts and the deletion', () => {
    for (const kind of ACCOUNT_CHANGE_KINDS) {
      const links = mail(kind).text.match(/https?:\/\//g) ?? []
      expect(links.length, kind).toBe(carriesResetLink(kind) ? 1 : 0)
    }
    expect(carriesResetLink('accountDisabled')).toBe(false)
    expect(carriesResetLink('accountDeleted')).toBe(false)
    expect(carriesResetLink('recoveryCodesRegenerated')).toBe(true)
  })

  it.each(CLIENT_LOCALES)('is written in %s, with the day and the hour in UTC', (locale) => {
    const message = mail('totpDisabled', locale)

    expect(message.text).toContain('14:32 (UTC)')
    expect(message.text).toContain('2026')
  })

  it('gives each language its own words for every act', () => {
    for (const kind of ACCOUNT_CHANGE_KINDS) {
      expect(new Set(CLIENT_LOCALES.map((locale) => mail(kind, locale).subject)).size, kind).toBe(5)
    }
  })

  it('answers at the operator contact for a disabling and an enabling, and says so, only when there is one', () => {
    const contact = address('contact@example.test')

    const asked = mail('accountDisabled', 'fr', contact)
    expect(asked.replyTo).toBe(contact)
    expect(asked.text).toContain(`Une question${NBSP}: répondez à ce message.`)

    const enabled = mail('accountEnabled', 'fr', contact)
    expect(enabled.replyTo).toBe(contact)
    expect(enabled.text).toContain(`Une question${NBSP}: répondez à ce message.`)

    const silent = mail('accountDisabled', 'fr', null)
    expect(silent.replyTo).toBeUndefined()
    expect(silent.text).not.toContain('Une question')
  })

  it('does not put a reply address on the mails of the other acts, whatever the contact', () => {
    const contact = address('contact@example.test')

    for (const kind of ACCOUNT_CHANGE_KINDS.filter(
      (k) => k !== 'accountDisabled' && k !== 'accountEnabled',
    )) {
      expect(mail(kind, 'fr', contact).replyTo, kind).toBeUndefined()
    }
  })

  it('spells the hour so it reads right at any hour: no article in Spanish and Italian', () => {
    for (const locale of ['es', 'it'] as const) {
      const text = accountChangeMail({
        to: address('hote@example.test'),
        locale,
        kind: 'passwordChanged',
        at: new Date('2026-11-27T01:05:00.000Z'),
        forgotUrl: FORGOT,
        replyTo: null,
      }).text
      expect(text, locale).toContain(', 01:05 (UTC)')
      expect(text, locale).not.toContain(locale === 'es' ? 'a las 01' : 'alle 01')
    }
  })

  it('keeps no address, no IP and no device in the text', () => {
    const text = mail('passwordChanged').text

    expect(text).not.toContain('hote@example.test')
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
  })
})

describe('accountForgotUrl', () => {
  it('is the forgot-password page under the public origin', () => {
    expect(accountForgotUrl('https://photos.example.com')).toBe(FORGOT)
  })
})
