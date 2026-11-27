import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_LINK_MAX,
  ANNOUNCEMENT_SUBJECT_MAX,
  ANNOUNCEMENT_TEXT_MAX,
  parseHostAnnouncement,
} from './hostAnnouncement'

const ok = { subject: 'Nouvelles conditions d’utilisation', text: 'Elles changent le 1er janvier.' }
const code = (input: Parameters<typeof parseHostAnnouncement>[0]): string | null => {
  const parsed = parseHostAnnouncement(input)
  return parsed.ok ? null : parsed.error.code
}

describe('parseHostAnnouncement (A8)', () => {
  it('keeps the operator’s words as they are, in any language, with no link by default', () => {
    expect(
      parseHostAnnouncement({ subject: 'Wichtige Änderung', text: 'Zeile eins\n\nZeile zwei' }),
    ).toEqual({
      ok: true,
      value: { subject: 'Wichtige Änderung', text: 'Zeile eins\n\nZeile zwei', link: null },
    })
  })

  it('folds the subject to one line, so it cannot inject a header, and the text to at most one blank line in a row', () => {
    const parsed = parseHostAnnouncement({
      subject: 'Sujet\r\nBcc: x@y.test',
      text: '  un\r\n\r\n\r\n\r\ndeux  ',
    })

    expect(parsed).toEqual({
      ok: true,
      value: { subject: 'Sujet Bcc: x@y.test', text: 'un\n\ndeux', link: null },
    })
  })

  it('bounds the subject and the text, counted in characters, and refuses them empty', () => {
    expect(code({ ...ok, subject: 'a'.repeat(ANNOUNCEMENT_SUBJECT_MAX) })).toBeNull()
    expect(code({ ...ok, subject: 'a'.repeat(ANNOUNCEMENT_SUBJECT_MAX + 1) })).toBe(
      'hostAnnouncement.subjectInvalid',
    )
    expect(code({ ...ok, subject: ' \n ' })).toBe('hostAnnouncement.subjectInvalid')
    expect(code({ ...ok, text: 'é'.repeat(ANNOUNCEMENT_TEXT_MAX) })).toBeNull()
    expect(code({ ...ok, text: 'a'.repeat(ANNOUNCEMENT_TEXT_MAX + 1) })).toBe(
      'hostAnnouncement.textInvalid',
    )
    expect(code({ ...ok, text: '\n\n' })).toBe('hostAnnouncement.textInvalid')
  })

  it('takes one https link, trimmed, and nothing else as a link', () => {
    expect(
      parseHostAnnouncement({ ...ok, link: '  https://eventslide.fr/legal/cgu  ' }),
    ).toMatchObject({
      ok: true,
      value: { link: 'https://eventslide.fr/legal/cgu' },
    })
    expect(parseHostAnnouncement({ ...ok, link: '   ' })).toMatchObject({
      ok: true,
      value: { link: null },
    })
    for (const link of [
      'http://eventslide.fr',
      'ftp://eventslide.fr',
      'javascript:alert(1)',
      'eventslide.fr/cgu',
      'https://user:pass@eventslide.fr',
      'https://eventslide.fr/a b',
      'https://',
    ]) {
      expect(code({ ...ok, link }), link).toBe('hostAnnouncement.linkInvalid')
    }
  })

  it('bounds the link', () => {
    const exactly = `https://e.fr/${'a'.repeat(ANNOUNCEMENT_LINK_MAX - 13)}`
    expect(code({ ...ok, link: exactly })).toBeNull()
    expect(code({ ...ok, link: `${exactly}a` })).toBe('hostAnnouncement.linkInvalid')
  })

  it('drops the bidirectional overrides and isolates and the control characters from the subject and the text', () => {
    const bidi = [
      0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f,
      0x0007,
    ]
      .map((code) => String.fromCharCode(code))
      .join('')

    const result = parseHostAnnouncement({
      subject: `Nouvelles ${bidi}conditions`,
      text: `Elles ${bidi}changent.\nLe 1er ${bidi}janvier.`,
    })

    expect(result).toEqual({
      ok: true,
      value: {
        subject: 'Nouvelles conditions',
        text: 'Elles changent.\nLe 1er janvier.',
        link: null,
      },
    })
  })
})
