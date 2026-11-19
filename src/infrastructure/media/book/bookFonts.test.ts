import { existsSync } from 'node:fs'
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

  it('falls back to the family of the style when its designed face is not shipped', () => {
    const faces = facesOf(BOOK_STYLE_DEFS.classique)

    expect(faces.fallback.regular).toContain('NotoSerif-Regular')
    expect(facesOf(BOOK_STYLE_DEFS.magazine).fallback.regular).toContain('NotoSans-Regular')
    expect(faces.paths.title).toContain('NotoSerif-Bold')
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

  it('reads a file once', () => {
    expect(covers(sans, 'a')).toBe(true)
    expect(covers(sans, 'b')).toBe(true)
  })
})
