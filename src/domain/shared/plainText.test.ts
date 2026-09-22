import { describe, expect, it } from 'vitest'
import { toSingleLine } from './plainText'

/**
 * Every awkward code point is built rather than typed, so this file stays plain ASCII
 * text that survives a copy, a diff and a Windows editor unchanged — the same
 * convention `photos/caption.test.ts` uses.
 */
const BEL = String.fromCodePoint(0x07)
const TAB = String.fromCodePoint(0x09)
const NEWLINE = String.fromCodePoint(0x0a)
const NO_BREAK_SPACE = String.fromCodePoint(0xa0)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff)

describe('toSingleLine', () => {
  it('trims surrounding whitespace', () => {
    expect(toSingleLine('  Santé !  ')).toBe('Santé !')
  })

  it('collapses an internal run of whitespace to a single space', () => {
    expect(toSingleLine('un    selfie')).toBe('un selfie')
  })

  it('folds a newline to a space rather than joining the words either side of it', () => {
    expect(toSingleLine(`un selfie${NEWLINE}avec les mariés`)).toBe('un selfie avec les mariés')
  })

  it('folds a run of newlines and tabs to one space', () => {
    expect(toSingleLine(`Vive${NEWLINE}${TAB}${NEWLINE}les mariés`)).toBe('Vive les mariés')
  })

  it('strips a control character sitting inside a word', () => {
    expect(toSingleLine(`Bra${BEL}vo`)).toBe('Bravo')
  })

  it('strips a right-to-left override, which would reverse the rest of the line', () => {
    expect(toSingleLine(`${RIGHT_TO_LEFT_OVERRIDE}Bravo`)).toBe('Bravo')
  })

  it('strips zero-width padding used to buy length a reader cannot see', () => {
    expect(toSingleLine(`Merci${ZERO_WIDTH_SPACE.repeat(3)}`)).toBe('Merci')
  })

  it('strips a byte-order mark pasted in from a text file', () => {
    expect(toSingleLine(`${BYTE_ORDER_MARK}Santé`)).toBe('Santé')
  })

  it('leaves one space where an invisible character sat between two of them', () => {
    expect(toSingleLine(`un ${ZERO_WIDTH_SPACE} selfie`)).toBe('un selfie')
  })

  it('keeps a non-breaking space, which is ordinary French typography rather than noise', () => {
    expect(toSingleLine(`Santé${NO_BREAK_SPACE}!`)).toBe(`Santé${NO_BREAK_SPACE}!`)
  })

  it('returns an empty string when nothing visible survives', () => {
    expect(toSingleLine(ZERO_WIDTH_SPACE.repeat(3))).toBe('')
  })
})
