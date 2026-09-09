import { describe, expect, it } from 'vitest'
import { EventName } from './eventName'

/**
 * Built from code points rather than typed into the file: an invisible character
 * pasted into a source line is invisible to the reviewer too, and survives exactly one
 * careless editor save.
 */
const BIDI_OVERRIDE = String.fromCodePoint(0x202e)
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0)
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d)

describe('EventName', () => {
  it('keeps the title a host actually typed', () => {
    const result = EventName.create('Camille & Sacha')

    expect(result.ok && result.value.value).toBe('Camille & Sacha')
  })

  it('trims surrounding whitespace so one title cannot be created twice', () => {
    const result = EventName.create('   Camille & Sacha  ')

    expect(result.ok && result.value.value).toBe('Camille & Sacha')
  })

  it('collapses runs of whitespace', () => {
    const result = EventName.create('Camille  et    Sacha')

    expect(result.ok && result.value.value).toBe('Camille et Sacha')
  })

  it('treats the no-break space a phone keyboard sends as whitespace', () => {
    const result = EventName.create(`Camille${NO_BREAK_SPACE}${NO_BREAK_SPACE}et Sacha`)

    expect(result.ok && result.value.value).toBe('Camille et Sacha')
  })

  it('folds a pasted line break into a single space, because the header is one line', () => {
    const result = EventName.create('Camille\net\tSacha')

    expect(result.ok && result.value.value).toBe('Camille et Sacha')
  })

  it('strips the bidirectional override that would reverse the projected title', () => {
    const result = EventName.create(`Camille${BIDI_OVERRIDE} & Sacha`)

    expect(result.ok && result.value.value).toBe('Camille & Sacha')
  })

  it('keeps the accents a French title needs', () => {
    const result = EventName.create('Anniversaire de Zoé')

    expect(result.ok && result.value.value).toBe('Anniversaire de Zoé')
  })

  it('refuses an empty title', () => {
    const result = EventName.create('')

    expect(!result.ok && result.error.code).toBe('eventName.empty')
  })

  it('refuses a title that is only whitespace', () => {
    const result = EventName.create('    ')

    expect(!result.ok && result.error.code).toBe('eventName.empty')
  })

  it('refuses a title made only of invisible characters', () => {
    const result = EventName.create(BIDI_OVERRIDE)

    expect(!result.ok && result.error.code).toBe('eventName.empty')
  })

  it('refuses a single character, which no host can tell apart in their dashboard', () => {
    const result = EventName.create('C')

    expect(!result.ok && result.error.code).toBe('eventName.tooShort')
  })

  it('accepts the shortest allowed title', () => {
    const result = EventName.create('x'.repeat(EventName.minLength))

    expect(result.ok).toBe(true)
  })

  it('accepts the longest allowed title', () => {
    const result = EventName.create('x'.repeat(EventName.maxLength))

    expect(result.ok).toBe(true)
  })

  it('refuses a title one character past the wall header limit', () => {
    const result = EventName.create('x'.repeat(EventName.maxLength + 1))

    expect(!result.ok && result.error.code).toBe('eventName.tooLong')
  })

  it('reports the limit it enforced, so the form can phrase it in French', () => {
    const result = EventName.create('x'.repeat(EventName.maxLength + 1))

    expect(!result.ok && result.error.details).toEqual({ max: EventName.maxLength })
  })

  it('refuses a title with no letter or digit, whose derived slug would be empty', () => {
    const result = EventName.create('***')

    expect(!result.ok && result.error.code).toBe('eventName.malformed')
  })

  it('refuses a non-string, which is what a stored row or a JSON body can hand over', () => {
    // `create` takes `unknown` precisely so this case is reachable without a cast:
    // the guard exists for values whose type is only a promise made upstream.
    const result = EventName.create(42)

    expect(!result.ok && result.error.code).toBe('eventName.invalid')
  })

  it('measures the title after stripping, so padding cannot buy extra characters', () => {
    const padded = `${'x'.repeat(EventName.maxLength)}${ZERO_WIDTH_JOINER.repeat(20)}`

    const result = EventName.create(padded)

    expect(result.ok && result.value.value.length).toBe(EventName.maxLength)
  })

  it('reports a bad title as a parse failure, not a conflict', () => {
    const result = EventName.create('')

    expect(!result.ok && result.error.kind).toBe('invalid')
  })

  it('considers two titles with the same cleaned text equal', () => {
    const one = EventName.create('Camille & Sacha')
    const other = EventName.create('  Camille   &   Sacha ')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
  })

  it('considers two different titles unequal', () => {
    const one = EventName.create('Camille & Sacha')
    const other = EventName.create('Anniversaire de Jean')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(false)
  })

  it('renders as its text when interpolated into a log line', () => {
    const result = EventName.create('Camille & Sacha')

    expect(result.ok && `${result.value}`).toBe('Camille & Sacha')
  })
})
