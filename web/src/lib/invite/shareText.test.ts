import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { SHARE_TEXT_MAX, shareTextOf, withoutAddress, type ShareTextParts } from './shareText'

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

  it('stays within 600 characters by cutting the place first, and always ends on the link', () => {
    const long: ShareTextParts = {
      ...PARTS,
      venue: 'V'.repeat(300),
      address: ['A'.repeat(100), 'B'.repeat(100)].join('\n'),
    }

    const text = shareTextOf(long, 'fr')

    expect([...text].length).toBeLessThanOrEqual(SHARE_TEXT_MAX)
    expect(text.endsWith(PARTS.url)).toBe(true)
    expect(text).toContain('V')
    expect(text).toContain('…')
    expect(text.split('\n')[0]).toContain('Léa fête ses 40 ans')
  })

  it('cuts the title only when even the moment and the link leave it no room', () => {
    const text = shareTextOf(
      {
        ...PARTS,
        title: 'T'.repeat(500),
        venue: null,
        address: null,
        url: `https://x.example/${'u'.repeat(60)}`,
      },
      'fr',
    )

    expect([...text].length).toBeLessThanOrEqual(SHARE_TEXT_MAX)
    expect(text.endsWith('u'.repeat(60))).toBe(true)
    expect(text).toContain('Samedi 12 décembre 2026, 19 h – 2 h')
  })

  it('does not touch a text that fits', () => {
    expect(shareTextOf(PARTS, 'fr')).toBe(shareTextOf(PARTS, 'fr'))
    expect([...shareTextOf(PARTS, 'fr')].length).toBeLessThan(SHARE_TEXT_MAX)
  })
})

describe('withoutAddress', () => {
  const ADDRESS = '12 quai de la Loire\n44000 Nantes'

  it('removes the address as the text writes it, with its separator', () => {
    const text = shareTextOf(PARTS, 'fr')

    expect(withoutAddress(text, ADDRESS)).toBe(shareTextOf({ ...PARTS, address: null }, 'fr'))
  })

  it('removes the address as it was typed, on two lines', () => {
    expect(withoutAddress('Chez Léa\n12 quai de la Loire\n44000 Nantes\nÀ bientôt', ADDRESS)).toBe(
      'Chez Léa\n\nÀ bientôt',
    )
  })

  it('gives up, rather than leave a part of it, when the host retyped it', () => {
    expect(withoutAddress('Chez nous, 12 quai de la Loire, ça roule', ADDRESS)).toBeNull()
  })

  it('leaves a text with no address as it is', () => {
    expect(withoutAddress('Venez nombreux', ADDRESS)).toBe('Venez nombreux')
  })
})
