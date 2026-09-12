import { describe, expect, it } from 'vitest'
import { Caption } from './caption'

/**
 * Every awkward code point is built here rather than typed, so this file stays plain
 * ASCII text that survives a copy, a diff and a Windows editor unchanged.
 */
const BEL = String.fromCodePoint(0x07)
const TAB = String.fromCodePoint(0x09)
const NEWLINE = String.fromCodePoint(0x0a)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff)
const PARTY_POPPER = String.fromCodePoint(0x1f389)

describe('Caption.create', () => {
  it('trims surrounding whitespace', () => {
    const result = Caption.create('  Santé !  ')

    expect(result.ok && result.value.value).toBe('Santé !')
  })

  it('collapses an internal run of whitespace to a single space', () => {
    const result = Caption.create('Vive    les    mariés')

    expect(result.ok && result.value.value).toBe('Vive les mariés')
  })

  it('keeps accented French intact', () => {
    const result = Caption.create('Félicitations à Chloé et Rémi')

    expect(result.ok && result.value.value).toBe('Félicitations à Chloé et Rémi')
  })

  it('keeps an emoji, which is most of what guests actually send', () => {
    const result = Caption.create(`Bravo ${PARTY_POPPER}`)

    expect(result.ok && result.value.value).toBe(`Bravo ${PARTY_POPPER}`)
  })

  it('accepts a caption of exactly the maximum length', () => {
    const result = Caption.create('x'.repeat(Caption.maxLength))

    expect(result.ok && result.value.value.length).toBe(Caption.maxLength)
  })

  it('refuses a caption one character over the maximum length', () => {
    const result = Caption.create('x'.repeat(Caption.maxLength + 1))

    expect(!result.ok && result.error.code).toBe('caption.tooLong')
  })

  it('refuses an empty caption', () => {
    const result = Caption.create('')

    expect(!result.ok && result.error.code).toBe('caption.empty')
  })

  it('refuses a caption that is only whitespace', () => {
    const result = Caption.create('   ')

    expect(!result.ok && result.error.code).toBe('caption.empty')
  })

  it('refuses a non-string, which is what a JSON body can hand the domain', () => {
    // The guard exists for values whose declared type is only a promise made
    // upstream — a request body, a database row. Reaching it means lying to the
    // compiler on purpose, so the lie is written out rather than laundered through
    // an `any` from `JSON.parse`.
    const notAString = 42 as unknown as string

    const result = Caption.create(notAString)

    expect(!result.ok && result.error.code).toBe('caption.invalid')
  })
})

describe('Caption sanitising', () => {
  it('strips a control character sitting inside a word', () => {
    const result = Caption.create(`Bra${BEL}vo`)

    expect(result.ok && result.value.value).toBe('Bravo')
  })

  it('folds newlines and tabs into a single space, keeping the caption to one line', () => {
    const result = Caption.create(`Vive${NEWLINE}${TAB}${NEWLINE}les mariés`)

    expect(result.ok && result.value.value).toBe('Vive les mariés')
  })

  it('strips zero-width spaces used to pad a caption past its visible length', () => {
    const result = Caption.create(`Merci${ZERO_WIDTH_SPACE.repeat(3)}`)

    expect(result.ok && result.value.value).toBe('Merci')
  })

  it('refuses a caption made only of zero-width padding', () => {
    const result = Caption.create(ZERO_WIDTH_SPACE.repeat(3))

    expect(!result.ok && result.error.code).toBe('caption.empty')
  })

  it('measures the caption after stripping, so padding cannot buy extra characters', () => {
    const padded = `${'x'.repeat(Caption.maxLength)}${ZERO_WIDTH_SPACE.repeat(20)}`

    const result = Caption.create(padded)

    expect(result.ok && result.value.value.length).toBe(Caption.maxLength)
  })

  it('strips a right-to-left override, which would reverse the rest of the wall', () => {
    const result = Caption.create(`${RIGHT_TO_LEFT_OVERRIDE}Bravo`)

    expect(result.ok && result.value.value).toBe('Bravo')
  })

  it('strips a byte-order mark pasted in from a text file', () => {
    const result = Caption.create(`${BYTE_ORDER_MARK}Santé`)

    expect(result.ok && result.value.value).toBe('Santé')
  })
})

describe('Caption.createOptional', () => {
  it('treats null as no caption', () => {
    const result = Caption.createOptional(null)

    expect(result.ok && result.value).toBeNull()
  })

  it('treats undefined as no caption', () => {
    const result = Caption.createOptional(undefined)

    expect(result.ok && result.value).toBeNull()
  })

  it('treats an empty string as no caption, which is what an untouched field sends', () => {
    const result = Caption.createOptional('')

    expect(result.ok && result.value).toBeNull()
  })

  it('treats a whitespace-only string as no caption', () => {
    const result = Caption.createOptional('   ')

    expect(result.ok && result.value).toBeNull()
  })

  it('parses a caption that is actually present', () => {
    const result = Caption.createOptional('  Quelle soirée  ')

    expect(result.ok && result.value?.value).toBe('Quelle soirée')
  })
})

describe('Caption identity', () => {
  it('considers two captions with the same text equal', () => {
    const one = Caption.create('Bravo')
    const other = Caption.create('Bravo')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
  })

  it('considers two captions with different text different', () => {
    const one = Caption.create('Bravo')
    const other = Caption.create('Merci')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(false)
  })

  it('stringifies to its cleaned text', () => {
    const result = Caption.create('  Bravo  ')

    expect(result.ok && `${result.value}`).toBe('Bravo')
  })

  it('publishes the length limit the UI counts down from', () => {
    expect(Caption.maxLength).toBe(140)
  })
})
