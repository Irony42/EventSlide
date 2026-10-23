import { describe, expect, it } from 'vitest'
import { AUDIT_REASON_MAX_LENGTH, isCanonicalReason, parseAuditReason } from './auditReason'

/**
 * The one free-text field of the audit log (G2-14). What is held here is its bound and what it
 * refuses; that it reaches the log only through the one declaration that names it is
 * `auditAction.test.ts`'s, and that a client never reads it is the presenter's.
 *
 * The invisible characters are built with `String.fromCharCode`, never written as escapes or as
 * the characters themselves: a test whose input cannot be seen in a diff proves nothing to its
 * reader.
 */

const char = (code: number): string => String.fromCharCode(code)
const NUL = char(0x0000)
const TAB = char(0x0009)
const LINE_SEPARATOR = char(0x2028)
const PARAGRAPH_SEPARATOR = char(0x2029)
const ZERO_WIDTH_SPACE = char(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = char(0x202e)
const BIDI_ISOLATE_START = char(0x2066)
const BIDI_ISOLATE_END = char(0x2069)
const BYTE_ORDER_MARK = char(0xfeff)
const COMBINING_ACUTE = char(0x0301)
const HANGUL_FILLER = char(0x3164)
const BRAILLE_BLANK = char(0x2800)
const FULLWIDTH_AT = char(0xff20)
const SMALL_AT = char(0xfe6b)

const refusal = (raw: string): string | null => {
  const result = parseAuditReason(raw)
  return result.ok ? null : result.error.code
}

describe('parseAuditReason', () => {
  it('keeps an ordinary sentence exactly as it was written, accents included', () => {
    const result = parseAuditReason('Capacité du disque : le client dépasse son forfait')

    expect(result.ok && result.value).toBe('Capacité du disque : le client dépasse son forfait')
  })

  it('trims the blanks around it, so there is none to hide behind', () => {
    const result = parseAuditReason('   abus constaté   ')

    expect(result.ok && result.value).toBe('abus constaté')
  })

  it('normalises to NFC, so two spellings of one sentence are one string', () => {
    const decomposed = `cre${COMBINING_ACUTE}dit`
    const result = parseAuditReason(decomposed)

    expect(decomposed.length).toBe(7)
    expect(result.ok && result.value).toBe('crédit')
    expect(result.ok && result.value.length).toBe(6)
  })

  it('refuses what is not text at all, which only a caller the types cannot see can hand it', () => {
    for (const raw of [undefined, null, 3, {}, ['abus']]) {
      expect(parseAuditReason(raw).ok).toBe(false)
    }
  })

  it('refuses an empty reason and one made of blanks, which is no reason', () => {
    expect(refusal('')).toBe('audit.reasonInvalid')
    expect(refusal('    ')).toBe('audit.reasonInvalid')
  })

  it('accepts a reason of exactly the bound, and refuses one character more', () => {
    expect(refusal('a'.repeat(AUDIT_REASON_MAX_LENGTH))).toBeNull()
    expect(refusal('a'.repeat(AUDIT_REASON_MAX_LENGTH + 1))).toBe('audit.reasonInvalid')
  })

  it('measures the bound after trimming, not before', () => {
    expect(refusal(`  ${'a'.repeat(AUDIT_REASON_MAX_LENGTH)}  `)).toBeNull()
  })

  it.each([
    ['a line break', 'première ligne\nseconde ligne'],
    ['a carriage return', 'ligne\rautre'],
    ['a tab', `colonne${TAB}colonne`],
    ['a NUL', `abus${NUL}constaté`],
    ['a line separator', `ligne${LINE_SEPARATOR}autre`],
    ['a paragraph separator', `ligne${PARAGRAPH_SEPARATOR}autre`],
    ['a zero-width space', `abus${ZERO_WIDTH_SPACE}constaté`],
    [
      'a right-to-left override, which reorders what a reader sees',
      `abus${RIGHT_TO_LEFT_OVERRIDE}constaté`,
    ],
    ['a bidirectional isolate', `abus${BIDI_ISOLATE_START}constaté${BIDI_ISOLATE_END}`],
    ['a byte-order mark', `abus${BYTE_ORDER_MARK}constaté`],
    [
      'a Hangul filler, which is a letter to Unicode and draws nothing',
      `abus${HANGUL_FILLER}constaté`,
    ],
    ['a Braille blank', `abus${BRAILLE_BLANK}constaté`],
  ])('refuses %s, because it hides what was typed', (_label, raw) => {
    expect(refusal(raw)).toBe('audit.reasonInvalid')
  })

  it('refuses an @, so an address pasted into the box does not reach a log that has no word for one', () => {
    expect(refusal('demande de marie@example.test')).toBe('audit.reasonInvalid')
  })

  it.each([
    ['a fullwidth @', `marie${FULLWIDTH_AT}example.test`],
    ['a small @', `marie${SMALL_AT}example.test`],
  ])(
    'refuses %s as it does the ASCII one, because a reader sees the same character',
    (_label, raw) => {
      expect(refusal(raw)).toBe('audit.reasonInvalid')
    },
  )

  it('counts characters and not UTF-16 units: a hundred and one emoji are a hundred and one, and fit', () => {
    const emoji = String.fromCodePoint(0x1f4f7)

    expect(refusal(emoji.repeat(101))).toBeNull()
    expect(refusal(emoji.repeat(AUDIT_REASON_MAX_LENGTH))).toBeNull()
    expect(refusal(emoji.repeat(AUDIT_REASON_MAX_LENGTH + 1))).toBe('audit.reasonInvalid')
  })

  it('never puts what was typed in the error, only the bound', () => {
    const result = parseAuditReason('mon_adresse@example.test')

    expect(!result.ok && result.error.details).toEqual({ max: AUDIT_REASON_MAX_LENGTH })
    expect(!result.ok && result.error.message).not.toContain('example.test')
  })
})

describe('isCanonicalReason', () => {
  it('accepts what parseAuditReason would have kept of itself', () => {
    expect(isCanonicalReason('abus constaté')).toBe(true)
  })

  it('refuses text that would have been reshaped, so a stored reason is never one the parser would change', () => {
    expect(isCanonicalReason(' abus constaté')).toBe(false)
    expect(isCanonicalReason('abus constaté ')).toBe(false)
    expect(isCanonicalReason(`cre${COMBINING_ACUTE}dit`)).toBe(false)
  })

  it('refuses what parseAuditReason refuses', () => {
    expect(isCanonicalReason('')).toBe(false)
    expect(isCanonicalReason('a@b')).toBe(false)
  })
})
