import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { shareTextOf, type ShareTextParts } from './shareText'

const PARTS: ShareTextParts = {
  title: 'Léa fête ses 40 ans',
  day: 'samedi 12 décembre 2026',
  hours: '19 h – 2 h',
  venue: 'La Guinguette du Port',
  address: '12 quai de la Loire\n44000 Nantes',
  url: 'https://app.eventslide.fr/i/7QX0M4TZ2KD9WB3H',
}

describe('shareTextOf', () => {
  it('says who invites, the moment and the place, then the link, in French', () => {
    const text = shareTextOf({ ...PARTS, address: null }, 'fr')

    expect(text).toBe(
      [
        'Léa fête ses 40 ans : vous êtes invité·e.',
        'Samedi 12 décembre 2026, 19 h – 2 h · La Guinguette du Port',
        '',
        'Infos et mur photo : https://app.eventslide.fr/i/7QX0M4TZ2KD9WB3H',
      ].join('\n'),
    )
  })

  it('leaves the address out unless it is given, and joins its lines when it is', () => {
    expect(shareTextOf({ ...PARTS, address: null }, 'fr')).not.toContain('quai')

    expect(shareTextOf(PARTS, 'fr')).toContain(
      'La Guinguette du Port · 12 quai de la Loire, 44000 Nantes',
    )
  })

  it('has no place line to add when the host gave neither a venue nor an address', () => {
    const text = shareTextOf({ ...PARTS, venue: null, address: null }, 'fr')

    expect(text.split('\n')[1]).toBe('Samedi 12 décembre 2026, 19 h – 2 h')
  })

  it('writes the address alone when there is no venue', () => {
    const text = shareTextOf({ ...PARTS, venue: null }, 'fr')

    expect(text.split('\n')[1]).toBe(
      'Samedi 12 décembre 2026, 19 h – 2 h · 12 quai de la Loire, 44000 Nantes',
    )
  })

  it.each(SUPPORTED_LOCALES)(
    'never ends on an exclamation mark, and ends on the link, in %s',
    (lang) => {
      const text = shareTextOf(PARTS, lang)

      expect(text).not.toMatch(/!\s*$/)
      expect(text.split('\n')[0]).not.toContain('!')
      expect(text.endsWith(PARTS.url)).toBe(true)
      expect(text.split('\n')[0]).toContain('Léa fête ses 40 ans')
    },
  )

  it('carries the host’s title as written, whatever the language of the card', () => {
    expect(shareTextOf({ ...PARTS, title: 'Hochzeit & Fest' }, 'en')).toContain('Hochzeit & Fest')
  })
})
