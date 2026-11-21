import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { MAILTO_MAX, emailDraftOf, mailtoHref, type EmailDraftParts } from './emailDraft'

const URL_OF_INVITE = 'https://app.eventslide.fr/i/7QX0M4TZ2KD9WB3H'

const PARTS: EmailDraftParts = {
  title: 'Léa fête ses 40 ans',
  day: 'samedi 12 décembre 2026',
  hours: '19 h – 2 h',
  dayMonth: 'samedi 12 décembre',
  venue: 'La Guinguette du Port',
  address: '12 quai de la Loire\n44000 Nantes',
  message: 'Apéro à 19 h, dîner à 20 h 30, puis on danse.',
  url: URL_OF_INVITE,
}

const decode = (href: string) => {
  const query = href.slice('mailto:?'.length)
  const [subject = '', body = ''] = query.split('&body=')
  return {
    subject: decodeURIComponent(subject.replace('subject=', '')),
    body: decodeURIComponent(body),
  }
}

describe('emailDraftOf', () => {
  it('writes the subject, the moment, the place with its address, the whole word and the link, in French', () => {
    const draft = emailDraftOf(PARTS, 'fr')

    expect(draft.subject).toBe('Invitation : Léa fête ses 40 ans, samedi 12 décembre')
    expect(draft.body).toBe(
      [
        'Bonjour,',
        '',
        'Léa fête ses 40 ans, et vous êtes invité·e.',
        '',
        'Quand : Samedi 12 décembre 2026, 19 h – 2 h',
        'Où : La Guinguette du Port, 12 quai de la Loire, 44000 Nantes',
        '',
        'Apéro à 19 h, dîner à 20 h 30, puis on danse.',
        '',
        'Tous les détails, et le soir même le mur photo de la fête :',
        URL_OF_INVITE,
      ].join('\n'),
    )
  })

  it('has no place line and no word line when the host gave neither', () => {
    const draft = emailDraftOf({ ...PARTS, venue: null, address: null, message: null }, 'fr')

    expect(draft.body).not.toContain('Où')
    expect(draft.body).not.toContain('Apéro')
    expect(draft.body.split('\n\n')).toHaveLength(4)
  })

  it('writes the address alone when there is no venue, and the venue alone when there is no address', () => {
    expect(emailDraftOf({ ...PARTS, venue: null }, 'fr').body).toContain(
      'Où : 12 quai de la Loire, 44000 Nantes',
    )
    expect(emailDraftOf({ ...PARTS, address: null }, 'fr').body).toContain(
      'Où : La Guinguette du Port\n',
    )
  })

  it('writes the labels of the invitation’s language, with a plain colon outside French', () => {
    const body = emailDraftOf(PARTS, 'en').body

    expect(body).toContain('Hello,')
    expect(body).toContain('When: Samedi 12 décembre 2026')
    expect(body).toContain('Where: La Guinguette du Port')
    expect(emailDraftOf(PARTS, 'en').subject).toBe(
      'Invitation: Léa fête ses 40 ans, samedi 12 décembre',
    )
  })

  it.each(SUPPORTED_LOCALES)('names the host’s title and ends on the link in %s', (lang) => {
    const { subject, body } = emailDraftOf(PARTS, lang)

    expect(subject).toContain('Léa fête ses 40 ans')
    expect(body).toContain('Léa fête ses 40 ans')
    expect(body.endsWith(URL_OF_INVITE)).toBe(true)
    expect(`${subject}${body}`).not.toContain('!')
  })

  it('trims the host’s word and takes the whole of it, not the card’s short one', () => {
    const long = `${'mot '.repeat(80)}fin`

    expect(emailDraftOf({ ...PARTS, message: `  ${long}  ` }, 'fr').body).toContain(long)
  })
})

describe('mailtoHref', () => {
  it('opens a message to nobody: no recipient between the colon and the question mark', () => {
    const { href } = mailtoHref(emailDraftOf(PARTS, 'fr'), URL_OF_INVITE, 'fr')

    expect(href.startsWith('mailto:?subject=')).toBe(true)
    expect(href).not.toMatch(/^mailto:[^?]/)
  })

  it('carries the subject and the body exactly, encoded', () => {
    const draft = emailDraftOf(PARTS, 'fr')

    const link = mailtoHref(draft, URL_OF_INVITE, 'fr')

    expect(decode(link.href)).toEqual(draft)
    expect(link.cut).toBe(false)
    expect(link.length).toBe(link.href.length)
  })

  it('keeps a subject on one line: a line break there would be another header', () => {
    const link = mailtoHref(
      { subject: 'Invitation\r\nBcc: someone@example.test', body: 'x' },
      URL_OF_INVITE,
      'fr',
    )

    const subjectPart = link.href.slice(0, link.href.indexOf('&body='))
    expect(subjectPart).not.toContain('%0A')
    expect(subjectPart).not.toContain('%0D')
    expect(decode(link.href).subject).toBe('Invitation Bcc: someone@example.test')
  })

  it('keeps a word that fits whole', () => {
    const draft = emailDraftOf({ ...PARTS, message: 'a'.repeat(800) }, 'fr')

    expect(mailtoHref(draft, URL_OF_INVITE, 'fr').cut).toBe(false)
  })

  it('cuts a long word so the encoded link is under 1 800 characters, ending on the page and the link', () => {
    // An accent costs six characters once encoded: 600 of them are 3 600.
    const draft = emailDraftOf({ ...PARTS, message: 'é'.repeat(600) }, 'fr')

    const link = mailtoHref(draft, URL_OF_INVITE, 'fr')

    expect(link.cut).toBe(true)
    expect(link.href.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(link.length).toBe(link.href.length)
    const { body } = decode(link.href)
    expect(body.endsWith(`… (suite sur la page de l’invitation)\n\n${URL_OF_INVITE}`)).toBe(true)
    // The moment and the place come before the word: they stay.
    expect(body).toContain('Quand : Samedi 12 décembre 2026')
    expect(body).toContain('12 quai de la Loire')
  })

  it('cuts as little as it must: one more accented letter, six characters encoded, would not fit', () => {
    const draft = emailDraftOf({ ...PARTS, message: 'é'.repeat(600) }, 'fr')

    const link = mailtoHref(draft, URL_OF_INVITE, 'fr')

    expect(link.length + 6).toBeGreaterThan(MAILTO_MAX)
    const kept = [...decode(link.href).body].filter((char) => char === 'é').length
    expect(kept).toBeGreaterThan(100)
    expect(kept).toBeLessThan(600)
  })

  it('never cuts an emoji in two: no URIError, and the pictures that stay are whole', () => {
    const draft = emailDraftOf({ ...PARTS, message: '🎉'.repeat(400) }, 'fr')

    const link = mailtoHref(draft, URL_OF_INVITE, 'fr')

    expect(() =>
      decodeURIComponent(link.href.slice('mailto:?'.length).split('&body=')[1] ?? ''),
    ).not.toThrow()
    expect(link.href.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(decode(link.href).body).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })

  it('never cuts a family emoji, a joined sequence, into its parts', () => {
    const family = '👨‍👩‍👧‍👦'
    const draft = emailDraftOf({ ...PARTS, message: family.repeat(150) }, 'fr')

    const { body } = decode(mailtoHref(draft, URL_OF_INVITE, 'fr').href)

    const inWord = body.slice(body.indexOf(family), body.lastIndexOf(family) + family.length)
    expect(inWord).toBe(family.repeat(inWord.length / family.length))
    expect(inWord.length % family.length).toBe(0)
  })

  it('keeps the link even when the host’s own text is huge and has no link of its own', () => {
    const draft = { subject: 'Invitation', body: 'x'.repeat(5_000) }

    const link = mailtoHref(draft, URL_OF_INVITE, 'fr')

    expect(link.cut).toBe(true)
    expect(link.href.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(decode(link.href).body.endsWith(URL_OF_INVITE)).toBe(true)
  })

  it('gives the link to a text the host emptied of it, cut or not', () => {
    const short = mailtoHref({ subject: 'Salut', body: 'Venez nombreux' }, URL_OF_INVITE, 'fr')

    expect(short.cut).toBe(false)
    expect(decode(short.href).body).toBe(`Venez nombreux\n\n${URL_OF_INVITE}`)
  })

  it('counts the subject too: a long subject leaves less room for the body', () => {
    const body = emailDraftOf({ ...PARTS, message: 'é'.repeat(200) }, 'fr').body
    const short = mailtoHref({ subject: 'Salut', body }, URL_OF_INVITE, 'fr')
    const long = mailtoHref({ subject: 'é'.repeat(200), body }, URL_OF_INVITE, 'fr')

    expect(long.href.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(long.length).toBeGreaterThan(short.length)
  })
})

describe('the day in the subject', () => {
  it('is in lower case where the language writes weekdays so, and as the language writes it elsewhere', () => {
    const parts = { ...PARTS, dayMonth: 'Saturday, December 11' }

    expect(emailDraftOf(parts, 'en').subject).toBe(
      'Invitation: Léa fête ses 40 ans, Saturday, December 11',
    )
    expect(emailDraftOf({ ...PARTS, dayMonth: 'Samstag, 11. Dezember' }, 'de').subject).toContain(
      'Samstag, 11. Dezember',
    )
    expect(emailDraftOf({ ...PARTS, dayMonth: 'Sabato 11 dicembre' }, 'it').subject).toContain(
      'sabato 11 dicembre',
    )
  })
})

describe('mailtoHref, hard cases', () => {
  it('never goes over 1 800 characters, whatever the length of the subject', () => {
    for (const letter of ['a', 'é', '🎉']) {
      const link = mailtoHref(
        { subject: letter.repeat(2_000), body: emailDraftOf(PARTS, 'fr').body },
        URL_OF_INVITE,
        'fr',
      )

      expect(link.href.length, letter).toBeLessThanOrEqual(MAILTO_MAX)
      expect(link.cut, letter).toBe(true)
      expect(decode(link.href).body.endsWith(URL_OF_INVITE), letter).toBe(true)
      expect(decode(link.href).subject.endsWith('…'), letter).toBe(true)
    }
  })

  it('does not cut a subject that fits with the page and the link, even when the body is cut', () => {
    const draft = {
      subject: 'Invitation : Léa fête ses 40 ans',
      body: emailDraftOf({ ...PARTS, message: 'é'.repeat(600) }, 'fr').body,
    }

    expect(decode(mailtoHref(draft, URL_OF_INVITE, 'fr').href).subject).toBe(draft.subject)
  })

  it('says the host’s text is left in a body that was cut, and says it no more when only the page and the link remain', () => {
    const body = emailDraftOf({ ...PARTS, message: 'é'.repeat(600) }, 'fr').body
    expect(mailtoHref({ subject: 'Salut', body }, URL_OF_INVITE, 'fr').wordLeft).toBe(true)

    const none = Array.from({ length: 120 }, (_, i) => 1_560 + i).some((length) => {
      const link = mailtoHref({ subject: 'a'.repeat(length), body }, URL_OF_INVITE, 'fr')
      return link.cut && !link.wordLeft
    })
    expect(none).toBe(true)
  })

  it('does not throw on half of an emoji in the subject, the body or the link: it becomes U+FFFD', () => {
    const half = String.fromCharCode(0xd83c)
    const draft = { subject: `Fête ${half}`, body: `Venez ${half} tous\n\n${URL_OF_INVITE}` }

    const link = mailtoHref(draft, `${URL_OF_INVITE}${half}`, 'fr')

    expect(link.cut).toBe(false)
    expect(decode(link.href).subject).toBe('Fête \ufffd')
    expect(decode(link.href).body).toContain('Venez \ufffd tous')
  })

  it('does not throw on half of an emoji in a body that is cut either', () => {
    const half = String.fromCharCode(0xdf89)
    const draft = emailDraftOf({ ...PARTS, message: `${half}${'é'.repeat(600)}${half}` }, 'fr')

    const link = mailtoHref(draft, URL_OF_INVITE, 'fr')

    expect(link.cut).toBe(true)
    expect(link.href.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(() => decode(link.href)).not.toThrow()
  })

  it('keeps a flag whole at the cut: two regional indicators are one letter', () => {
    const flag = '🇫🇷'
    const draft = emailDraftOf({ ...PARTS, message: flag.repeat(300) }, 'fr')

    const { body } = decode(mailtoHref(draft, URL_OF_INVITE, 'fr').href)

    const written = body.slice(0, body.lastIndexOf('… '))
    const indicators = written.match(/[\u{1F1E6}-\u{1F1FF}]/gu) ?? []
    expect(indicators.length).toBeGreaterThan(20)
    // Never an odd one out: half a flag would show as two letters in a box.
    expect(indicators.length % 2).toBe(0)
  })

  it('keeps a letter and its combining accent together at the cut', () => {
    const accented = 'e\u0301'
    const draft = emailDraftOf({ ...PARTS, message: accented.repeat(700) }, 'fr')

    const { body } = decode(mailtoHref(draft, URL_OF_INVITE, 'fr').href)

    // The word is the last thing written before the page and the link: it is only pairs.
    const written = body.slice(0, body.lastIndexOf('… '))
    const word = written.slice(written.indexOf(accented))
    expect(word.length).toBeGreaterThan(100)
    expect(word).toBe(accented.repeat(word.length / accented.length))
  })
})
