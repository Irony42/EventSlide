import { describe, expect, it } from 'vitest'
import { BOOK_SUBTITLE_MAX, BOOK_TITLE_MAX, parseBookSubtitle, parseBookTitle } from './bookTitle'

const errorCode = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('book title', () => {
  it('folds a title to one clean line', () => {
    expect(parseBookTitle('  Mariage\n de   Léa ')).toEqual({ ok: true, value: 'Mariage de Léa' })
  })
  it('refuses a non-string, an empty title and one past the bound', () => {
    expect(errorCode(parseBookTitle(4))).toBe('book.titleInvalid')
    expect(errorCode(parseBookTitle(' \n '))).toBe('book.titleEmpty')
    expect(errorCode(parseBookTitle('x'.repeat(BOOK_TITLE_MAX + 1)))).toBe('book.titleTooLong')
  })
  it('accepts a title of exactly the bound', () => {
    expect(parseBookTitle('x'.repeat(BOOK_TITLE_MAX)).ok).toBe(true)
  })
})

describe('book subtitle', () => {
  it('reads absent, null and blank as no subtitle', () => {
    expect(parseBookSubtitle(undefined)).toEqual({ ok: true, value: '' })
    expect(parseBookSubtitle(null)).toEqual({ ok: true, value: '' })
    expect(parseBookSubtitle('  ')).toEqual({ ok: true, value: '' })
  })
  it('refuses a non-string and one past the bound, accepts exactly the bound', () => {
    expect(errorCode(parseBookSubtitle(1))).toBe('book.subtitleInvalid')
    expect(errorCode(parseBookSubtitle('x'.repeat(BOOK_SUBTITLE_MAX + 1)))).toBe(
      'book.subtitleTooLong',
    )
    expect(parseBookSubtitle('x'.repeat(BOOK_SUBTITLE_MAX)).ok).toBe(true)
  })
})
