import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOK_STYLES } from '../../../domain/book/bookOptionsV2'
import { BOOK_STYLE_DEFS } from '../../../domain/book/bookStyles'
import { covers, facesOf } from './bookFonts'

describe('facesOf', () => {
  it.each(BOOK_STYLES)('gives %s a file for each role, all of which exist', (style) => {
    const faces = facesOf(BOOK_STYLE_DEFS[style])

    for (const path of [...Object.values(faces.paths), faces.fallback.regular, faces.fallback.bold]) {
      expect(existsSync(path), path).toBe(true)
    }
  })

  it('uses the designed faces of the spec, and keeps the Noto family of the style as the fallback', () => {
    const names = (style: 'classique' | 'magazine' | 'souvenir'): string[] =>
      Object.values(facesOf(BOOK_STYLE_DEFS[style]).paths).map((path) => basename(path))

    expect(names('classique')).toEqual([
      'CormorantGaramond-SemiBold.ttf',
      'CormorantGaramond-Italic.ttf',
      'Inter-SemiBold.ttf',
    ])
    expect(names('magazine')).toEqual(['Fraunces-Black.ttf', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf'])
    expect(names('souvenir')).toEqual(['Caveat-Bold.ttf', 'Caveat-Regular.ttf', 'Caveat-Bold.ttf'])
    for (const style of BOOK_STYLES) {
      const faces = facesOf(BOOK_STYLE_DEFS[style])
      expect(Object.values(faces.designed)).toEqual([true, true, true])
    }
    expect(facesOf(BOOK_STYLE_DEFS.classique).fallback.regular).toContain('NotoSerif-Regular')
    expect(facesOf(BOOK_STYLE_DEFS.magazine).fallback.bold).toContain('NotoSans-Bold')
  })
})

describe('covers', () => {
  const sans = facesOf(BOOK_STYLE_DEFS.magazine).fallback.regular

  it('knows Latin, Polish, Turkish, Greek and Cyrillic, spaces and controls aside', () => {
    for (const text of ['Zoë', 'Łukasz Żółć', 'Çağrı Şeker', 'Ελληνικά', 'Привет, мир', 'a b\tc\u0085']) {
      expect(covers(sans, text), text).toBe(true)
    }
  })

  it('refuses a string with one glyph the face lacks, whole', () => {
    expect(covers(sans, 'Zoë 漢字')).toBe(false)
    expect(covers(sans, 'שלום')).toBe(false)
  })

  it('knows that Fraunces has no Cyrillic, so a Russian caption goes whole to the fallback', () => {
    const fraunces = facesOf(BOOK_STYLE_DEFS.magazine).paths.title

    expect(covers(fraunces, 'Léa et Zoë')).toBe(true)
    expect(covers(fraunces, 'Привет')).toBe(false)
  })

  it('knows Inter, which covers Latin, Greek and Cyrillic', () => {
    const inter = facesOf(BOOK_STYLE_DEFS.magazine).paths.body

    expect(covers(inter, 'Привет, Ελληνικά, Łukasz')).toBe(true)
  })

  it('reads a file once', () => {
    expect(covers(sans, 'a')).toBe(true)
    expect(covers(sans, 'b')).toBe(true)
  })
})
