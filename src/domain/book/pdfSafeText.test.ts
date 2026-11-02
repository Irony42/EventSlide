import { describe, expect, it } from 'vitest'
import { pdfSafeText } from './pdfSafeText'

describe('pdfSafeText', () => {
  it('keeps accented Latin, Cyrillic and Greek as written', () => {
    expect(pdfSafeText('Zoë, Łukasz, Çağla — Дмитрий, Ελένη', 80)).toBe(
      'Zoë, Łukasz, Çağla — Дмитрий, Ελένη',
    )
  })
  it('omits emoji, including keycaps and flags, without leaving a box or a double space', () => {
    expect(pdfSafeText('Super 🎉 soirée 👨‍👩‍👧 !', 80)).toBe('Super soirée !')
    expect(pdfSafeText('1️⃣ 🇫🇷 ok', 80)).toBe('1 ok')
  })
  it('omits control characters and glyphs outside the font', () => {
    expect(pdfSafeText('a\u0007b‮c', 80)).toBe('abc')
    expect(pdfSafeText('日本語 Anna', 80)).toBe('Anna')
    expect(pdfSafeText('שלום', 80)).toBe('')
  })
  it('is empty when nothing drawable remains', () => {
    expect(pdfSafeText('🎉🎉', 80)).toBe('')
    expect(pdfSafeText('', 80)).toBe('')
  })
  it('cuts to the length of the cell by characters, not code units', () => {
    expect(pdfSafeText('abcdef', 3)).toBe('abc')
    expect(pdfSafeText('ab  cd', 3)).toBe('ab')
    expect(pdfSafeText('𝐀𝐁𝐂', 2)).toBe('')
  })
})
