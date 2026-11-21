import { describe, expect, it } from 'vitest'
import {
  dayLabel,
  hourLabel,
  icsOf,
  itineraryHref,
  sha256Hex,
  whenLabel,
  whenParts,
  type IcsInvite,
  type InviteWhen,
} from './inviteTexts'

const PARIS: InviteWhen = {
  startsAt: '2026-12-12T18:00:00.000Z',
  endsAt: '2026-12-13T01:00:00.000Z',
  timeZone: 'Europe/Paris',
}

describe('the hour as a person says it', () => {
  it('writes French hours the French way, and leaves a round hour without minutes', () => {
    expect(hourLabel(new Date('2026-12-12T18:00:00Z'), 'fr', 'Europe/Paris')).toBe('19 h')
    expect(hourLabel(new Date('2026-12-12T18:05:00Z'), 'fr', 'Europe/Paris')).toBe('19 h 05')
    expect(hourLabel(new Date('2026-12-12T18:30:00Z'), 'fr', 'Europe/Paris')).toBe('19 h 30')
  })

  it('reads midnight as 0 h, not 24 h', () => {
    expect(hourLabel(new Date('2026-12-12T23:00:00Z'), 'fr', 'Europe/Paris')).toBe('0 h')
  })

  it('leaves the other languages to the platform', () => {
    expect(hourLabel(new Date('2026-12-12T18:00:00Z'), 'en', 'Europe/Paris')).toMatch(/^7\s?PM$/)
    expect(hourLabel(new Date('2026-12-12T18:30:00Z'), 'de', 'Europe/Paris')).toBe('19:30')
    expect(hourLabel(new Date('2026-12-12T18:00:00Z'), 'de', 'Europe/Paris')).toBe('19 Uhr')
  })

  it('is read in the zone it is given, not the reader’s', () => {
    expect(hourLabel(new Date('2026-12-12T18:00:00Z'), 'fr', 'America/Montreal')).toBe('13 h')
    expect(hourLabel(new Date('2026-07-12T18:00:00Z'), 'fr', 'Europe/Paris')).toBe('20 h')
  })

  it('names the day with its weekday, in the language and the zone of the invitation', () => {
    expect(dayLabel(new Date('2026-12-12T18:00:00Z'), 'fr', 'Europe/Paris')).toBe(
      'samedi 12 décembre 2026',
    )
    expect(dayLabel(new Date('2026-12-12T18:00:00Z'), 'en', 'Europe/Paris')).toBe(
      'Saturday, December 12, 2026',
    )
    // 23:30 UTC is already the next day in Paris.
    expect(dayLabel(new Date('2026-12-12T23:30:00Z'), 'fr', 'Europe/Paris')).toBe(
      'dimanche 13 décembre 2026',
    )
  })
})

describe('whenParts', () => {
  it('gives the day and the hours of the invitation, an end after midnight included', () => {
    const parts = whenParts(PARIS, 'fr', 'Europe/Paris')

    expect(parts.day).toBe('samedi 12 décembre 2026')
    expect(parts.hours).toBe('19 h – 2 h')
    expect(parts.viewer).toBeNull()
  })

  it('gives the start alone when there is no end', () => {
    expect(whenParts({ ...PARIS, endsAt: null }, 'fr', 'Europe/Paris').hours).toBe('19 h')
  })

  it('names the day of an end that is more than a day later', () => {
    const parts = whenParts({ ...PARIS, endsAt: '2026-12-14T09:00:00.000Z' }, 'fr', 'Europe/Paris')

    expect(parts.hours).toBe('19 h – lundi 10 h')
  })

  it('says what the moment is for a reader somewhere else, with the place of their zone', () => {
    const parts = whenParts(PARIS, 'fr', 'America/Montreal')

    expect(parts.viewer).toEqual({ when: 'samedi 13 h', place: 'Montreal' })
    expect(parts.day).toBe('samedi 12 décembre 2026')
  })

  it('says nothing more to a reader in another zone that reads the same day and hour', () => {
    expect(whenParts(PARIS, 'fr', 'Europe/Berlin').viewer).toBeNull()
  })

  it('writes a place of several words with spaces', () => {
    const parts = whenParts(PARIS, 'fr', 'America/Port_of_Spain')

    expect(parts.viewer?.place).toBe('Port of Spain')
  })

  it('catches a change of day: the same hour on another date is a different moment', () => {
    const lateEvening = { ...PARIS, startsAt: '2026-12-12T23:30:00.000Z', endsAt: null }

    expect(whenParts(lateEvening, 'fr', 'America/Montreal').viewer?.when).toBe('samedi 18 h 30')
  })
})

describe('whenLabel', () => {
  it('is one line in the invitation’s zone', () => {
    expect(whenLabel(PARIS, 'fr', 'Europe/Paris')).toBe('samedi 12 décembre 2026, 19 h – 2 h')
  })

  it('adds the invitation’s zone when the reader’s hour differs', () => {
    expect(whenLabel(PARIS, 'fr', 'America/Montreal')).toMatch(
      /^samedi 12 décembre 2026, 19 h – 2 h \(.+\)$/,
    )
  })
})

describe('itineraryHref', () => {
  it('is a search on OpenStreetMap with the place and the address encoded', () => {
    expect(itineraryHref('La Guinguette du Port', '12 quai de la Loire\n44000 Nantes')).toBe(
      'https://www.openstreetmap.org/search?query=La%20Guinguette%20du%20Port%2C%2012%20quai%20de%20la%20Loire%2C%2044000%20Nantes',
    )
  })

  it('encodes what could end the query or start another: nothing the host typed is a URL part', () => {
    const href = itineraryHref(null, 'rue X&query=evil#frag?a=1')

    expect(href).toBe(
      'https://www.openstreetmap.org/search?query=rue%20X%26query%3Devil%23frag%3Fa%3D1',
    )
  })

  it('is absent when there is neither a place nor an address', () => {
    expect(itineraryHref(null, null)).toBeNull()
    expect(itineraryHref('', '')).toBeNull()
  })

  it('works from the place alone, and from the address alone', () => {
    expect(itineraryHref('Salle', null)).toContain('query=Salle')
    expect(itineraryHref(null, '1 rue X')).toContain('query=1%20rue%20X')
  })
})

describe('sha256Hex', () => {
  it('is SHA-256: the published digests of the empty string, "abc" and a two-block message', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('reads text as UTF-8', () => {
    expect(sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
  })
})

describe('icsOf', () => {
  const NOW = new Date('2026-11-21T10:00:00.000Z')
  const URL_OF = 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H'
  const invite: IcsInvite = {
    token: '7QX0M4TZ2KD9WB3H',
    title: 'Léa fête ses 40 ans',
    when: PARIS,
    venueName: 'La Guinguette du Port',
    address: '12 quai de la Loire\n44000 Nantes',
    message: 'Apéro à 19 h, dîner à 20 h 30.',
  }

  const unfold = (ics: string): string => ics.replace(/\r\n /g, '')

  it('is one VEVENT with its times in UTC, its place and its word and link', () => {
    const lines = unfold(icsOf(invite, URL_OF, NOW)).split('\r\n')

    expect(lines).toContain('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('DTSTART:20261212T180000Z')
    expect(lines).toContain('DTEND:20261213T010000Z')
    expect(lines).toContain('DTSTAMP:20261121T100000Z')
    expect(lines).toContain('SUMMARY:Léa fête ses 40 ans')
    expect(lines).toContain('LOCATION:La Guinguette du Port\\, 12 quai de la Loire\\, 44000 Nantes')
    expect(lines).toContain(`DESCRIPTION:Apéro à 19 h\\, dîner à 20 h 30.\\n\\n${URL_OF}`)
    expect(lines.at(-2)).toBe('END:VCALENDAR')
    expect(icsOf(invite, URL_OF, NOW).endsWith('\r\n')).toBe(true)
  })

  it('lasts four hours when there is no end', () => {
    const lines = icsOf({ ...invite, when: { ...PARIS, endsAt: null } }, URL_OF, NOW).split('\r\n')

    expect(lines).toContain('DTEND:20261212T220000Z')
  })

  it('leaves out the place when there is none, and the word when there is none', () => {
    const ics = icsOf({ ...invite, venueName: null, address: null, message: null }, URL_OF, NOW)

    expect(ics).not.toContain('LOCATION')
    expect(unfold(ics)).toContain(`DESCRIPTION:${URL_OF}`)
  })

  it('escapes backslash, semicolon and comma, so the host’s text cannot end a value early', () => {
    const ics = unfold(icsOf({ ...invite, title: 'A\\B; C, D' }, URL_OF, NOW))

    expect(ics).toContain('SUMMARY:A\\\\B\\; C\\, D')
  })

  it('cannot be made to start another property: a line break in the word is only the two characters \\n', () => {
    const ics = icsOf(
      { ...invite, message: 'Venez\r\nATTENDEE:mailto:evil@example.test\nORGANIZER:x' },
      URL_OF,
      NOW,
    )

    const lines = unfold(ics).split('\r\n')
    expect(lines.some((line) => line.startsWith('ATTENDEE'))).toBe(false)
    expect(lines.some((line) => line.startsWith('ORGANIZER'))).toBe(false)
    expect(lines.find((line) => line.startsWith('DESCRIPTION'))).toContain(
      'Venez\\nATTENDEE:mailto:evil@example.test\\nORGANIZER:x',
    )
  })

  it('drops every control character but the line break: none of them can end a line', () => {
    const controls = String.fromCharCode(0, 7, 9, 11, 12, 13, 27, 127)
    const ics = unfold(
      icsOf({ ...invite, title: `A${controls}B`, message: `x${controls}\ny` }, URL_OF, NOW),
    )

    expect(ics).toContain('SUMMARY:AB')
    expect(ics).toContain('DESCRIPTION:x\\ny')
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ics)).toBe(false)
  })

  it('folds a long line at 75 octets without cutting a character in two', () => {
    const ics = icsOf({ ...invite, message: 'é'.repeat(200) }, URL_OF, NOW)

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75)
    }
    expect(unfold(ics)).toContain(`DESCRIPTION:${'é'.repeat(200)}`.replace(/,/g, '\\,'))
    expect(ics).not.toContain('�')
  })

  it('folds a long line of one-octet characters at exactly 75', () => {
    const ics = icsOf({ ...invite, title: 'x'.repeat(300) }, URL_OF, NOW)
    const lines = ics.split('\r\n')
    const summary = lines.findIndex((line) => line.startsWith('SUMMARY'))

    expect(lines[summary]).toHaveLength(75)
    expect(lines[summary + 1]?.startsWith(' ')).toBe(true)
    expect(lines[summary + 1]).toHaveLength(75)
  })

  it('names the same event for the same invitation, however its link was typed', () => {
    const uid = (token: string) =>
      icsOf({ ...invite, token }, URL_OF, NOW)
        .split('\r\n')
        .find((line) => line.startsWith('UID:'))

    expect(uid('7qx0m4tz2kd9wb3h')).toBe(uid('7QX0M4TZ2KD9WB3H'))
    expect(uid('7QXOM4TZ2KD9WB3H')).toBe(uid('7QX0M4TZ2KD9WB3H'))
    expect(uid('7QX0M4TZ2KD9WB3H')).not.toBe(uid('7QX0M4TZ2KD9WB3J'))
  })

  it('names the event by a digest of the token, never the token itself, and always the same one', () => {
    const ics = icsOf(invite, URL_OF, NOW)
    const uid = unfold(ics)
      .split('\r\n')
      .find((line) => line.startsWith('UID:'))

    expect(uid).toBe(`UID:${sha256Hex(invite.token).slice(0, 32)}@photos.example.test`)
    expect(uid).not.toContain(invite.token)
    expect(icsOf(invite, URL_OF, new Date('2027-01-01T00:00:00Z'))).toContain(uid ?? '#')
  })
})
