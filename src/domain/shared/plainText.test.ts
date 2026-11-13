import { describe, expect, it } from 'vitest'
import { characterCount, toMultiLine, toParagraphs, toSingleLine } from './plainText'
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

describe('toMultiLine', () => {
  const CARRIAGE_RETURN = String.fromCodePoint(0x0d)
  const LINE_SEPARATOR = String.fromCodePoint(0x2028)

  it('keeps a line feed, which toSingleLine would fold to a space', () => {
    expect(toMultiLine(`un${NEWLINE}deux`)).toBe(`un${NEWLINE}deux`)
  })

  it('folds every other kind of line break to a line feed rather than deleting it', () => {
    expect(toMultiLine(`a${CARRIAGE_RETURN}${NEWLINE}b${CARRIAGE_RETURN}c${LINE_SEPARATOR}d`)).toBe(
      `a${NEWLINE}b${NEWLINE}c${NEWLINE}d`,
    )
  })

  it('removes invisible characters and a bidirectional override', () => {
    expect(toMultiLine(`a${ZERO_WIDTH_SPACE}b${RIGHT_TO_LEFT_OVERRIDE}c${BEL}`)).toBe('abc')
  })

  it('folds tabs and runs of spaces, and drops spaces around a line break', () => {
    expect(toMultiLine(`un${TAB}  ${NO_BREAK_SPACE}deux ${NEWLINE} trois`)).toBe(
      `un deux${NEWLINE}trois`,
    )
  })

  it('keeps at most one blank line in a row', () => {
    expect(toMultiLine(`a${NEWLINE}${NEWLINE}${NEWLINE}${NEWLINE}b`)).toBe(`a${NEWLINE}${NEWLINE}b`)
  })

  it('trims both ends and may come out empty', () => {
    expect(toMultiLine(`${NEWLINE} a ${NEWLINE}`)).toBe('a')
    expect(toMultiLine(`${NEWLINE}${ZERO_WIDTH_SPACE} `)).toBe('')
  })
})

describe('toParagraphs', () => {
  const LS = String.fromCodePoint(0x2028)
  const PS = String.fromCodePoint(0x2029)
  const NEL = String.fromCodePoint(0x85)

  it('keeps line breaks, trims each line and folds its spaces', () => {
    expect(toParagraphs('  un   mot \n deux  mots  ')).toBe('un mot\ndeux mots')
  })

  it('drops blank lines', () => {
    expect(toParagraphs('a\n\n \n b')).toBe('a\nb')
  })

  it('reads CRLF, CR, U+2028, U+2029 and U+0085 as a line break, never gluing two words', () => {
    expect(toParagraphs(`a\r\nb\rc${LS}d${PS}e${NEL}f`)).toBe('a\nb\nc\nd\ne\nf')
  })

  it('removes invisible characters and bidi overrides', () => {
    expect(toParagraphs(`a${ZERO_WIDTH_SPACE}b${RIGHT_TO_LEFT_OVERRIDE}c${BYTE_ORDER_MARK}`)).toBe(
      'abc',
    )
  })

  it('returns an empty string for nothing visible', () => {
    expect(toParagraphs(` ${BEL}${NO_BREAK_SPACE}\n${TAB}`)).toBe('')
  })
})

const ZWJ = String.fromCodePoint(0x200d)
const ZWNJ = String.fromCodePoint(0x200c)
const WOMAN = String.fromCodePoint(0x1f469)
const LAPTOP = String.fromCodePoint(0x1f4bb)
const TECHNOLOGIST = `${WOMAN}${ZWJ}${LAPTOP}`

describe('joiners between two characters (BUG-29)', () => {
  it.each([
    ['toSingleLine', toSingleLine],
    ['toMultiLine', toMultiLine],
    ['toParagraphs', toParagraphs],
  ])('%s keeps a compound emoji whole', (_name, clean) => {
    expect(clean(`Merci ${TECHNOLOGIST}`)).toBe(`Merci ${TECHNOLOGIST}`)
  })

  it('keeps the non-joiner inside a Persian word', () => {
    const word = `می${ZWNJ}خواهم`

    expect(toSingleLine(word)).toBe(word)
  })

  it.each([
    ['leading', `${ZWJ}Léa`, 'Léa'],
    ['trailing', `Léa${ZWNJ}`, 'Léa'],
    ['doubled', `a${ZWJ}${ZWJ}b`, 'ab'],
    ['mixed in a run', `a${ZWJ}${ZWNJ}b`, 'ab'],
    ['before a space', `Léa${ZWJ} Dupont`, 'Léa Dupont'],
    ['after a space', `Léa ${ZWJ}Dupont`, 'Léa Dupont'],
    ['against a space on its left only', `a ${ZWJ}b`, 'a b'],
    ['against a space on its right only', `a${ZWJ} b`, 'a b'],
    ['alone', ZWJ, ''],
  ])('strips a joiner that is %s', (_label, raw, expected) => {
    expect(toSingleLine(raw)).toBe(expected)
  })

  it('strips a joiner that sits against a line break in a paragraph', () => {
    expect(toMultiLine(`a${ZWJ}${NEWLINE}b`)).toBe(`a${NEWLINE}b`)
  })

  it('keeps stripping every other invisible character around a kept joiner', () => {
    expect(toSingleLine(`${WOMAN}${ZERO_WIDTH_SPACE}${ZWJ}${BYTE_ORDER_MARK}${LAPTOP}`)).toBe(
      TECHNOLOGIST,
    )
  })

  it('does not refuse text made of blank-looking characters: that rule was not retained', () => {
    const hangulFiller = String.fromCodePoint(0x3164)

    expect(toSingleLine(hangulFiller)).toBe(hangulFiller)
  })
})

describe('characterCount', () => {
  it('counts code points, so an emoji is one character and not two UTF-16 units', () => {
    expect(characterCount(WOMAN)).toBe(1)
    expect(characterCount(TECHNOLOGIST)).toBe(3)
    expect(characterCount('abc')).toBe(3)
  })
})
