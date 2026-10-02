import { describe, expect, it } from 'vitest'
import { ClientName } from './clientName'

/**
 * Built from code points rather than typed into the file: an invisible character pasted
 * into a source line is invisible to the reviewer too, and survives exactly one careless
 * editor save.
 */
const BIDI_OVERRIDE = String.fromCodePoint(0x202e)
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0)
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d)

describe('ClientName', () => {
  it('keeps the name an operator actually typed', () => {
    const result = ClientName.create('Atelier Photo Camille')

    expect(result.ok && result.value.value).toBe('Atelier Photo Camille')
  })

  it('trims surrounding whitespace so one name cannot be created twice', () => {
    const result = ClientName.create('   Atelier Photo Camille  ')

    expect(result.ok && result.value.value).toBe('Atelier Photo Camille')
  })

  it('collapses runs of whitespace', () => {
    const result = ClientName.create('Atelier   Photo    Camille')

    expect(result.ok && result.value.value).toBe('Atelier Photo Camille')
  })

  it('treats the no-break space a pasted name sends as whitespace', () => {
    const result = ClientName.create(`Atelier${NO_BREAK_SPACE}${NO_BREAK_SPACE}Camille`)

    expect(result.ok && result.value.value).toBe('Atelier Camille')
  })

  it('folds a pasted line break into a single space', () => {
    const result = ClientName.create('Atelier\nPhoto\tCamille')

    expect(result.ok && result.value.value).toBe('Atelier Photo Camille')
  })

  it('strips the bidirectional override that would reverse the name in the console', () => {
    const result = ClientName.create(`Atelier${BIDI_OVERRIDE} Camille`)

    expect(result.ok && result.value.value).toBe('Atelier Camille')
  })

  it('keeps the accents a French name needs', () => {
    const result = ClientName.create('Étude Zoé & Associés')

    expect(result.ok && result.value.value).toBe('Étude Zoé & Associés')
  })

  it('refuses an empty name', () => {
    const result = ClientName.create('')

    expect(!result.ok && result.error.code).toBe('clientName.empty')
  })

  it('refuses a name that is only whitespace', () => {
    const result = ClientName.create('    ')

    expect(!result.ok && result.error.code).toBe('clientName.empty')
  })

  it('refuses a name made only of invisible characters', () => {
    const result = ClientName.create(BIDI_OVERRIDE)

    expect(!result.ok && result.error.code).toBe('clientName.empty')
  })

  it('accepts a single character, matching the table CHECK of BETWEEN 1 AND 200', () => {
    const result = ClientName.create('x'.repeat(1))

    expect(result.ok).toBe(true)
  })

  it('accepts a name of exactly 200 characters, the table CHECK’s upper bound', () => {
    const result = ClientName.create('x'.repeat(200))

    expect(result.ok).toBe(true)
  })

  it('refuses a name of 201 characters, one past the table CHECK’s upper bound', () => {
    const result = ClientName.create('x'.repeat(201))

    expect(!result.ok && result.error.code).toBe('clientName.tooLong')
  })

  it('reports the limit it enforced', () => {
    const result = ClientName.create('x'.repeat(201))

    expect(!result.ok && result.error.details).toEqual({ max: 200 })
  })

  it('refuses a non-string, which is what a stored row or a JSON body can hand over', () => {
    const result = ClientName.create(42)

    expect(!result.ok && result.error.code).toBe('clientName.invalid')
  })

  it('measures the name after stripping, so padding cannot buy extra characters', () => {
    const padded = `${'x'.repeat(200)}${ZERO_WIDTH_JOINER.repeat(20)}`

    const result = ClientName.create(padded)

    expect(result.ok && result.value.value.length).toBe(200)
  })

  it('reports a bad name as a parse failure, not a conflict', () => {
    const result = ClientName.create('')

    expect(!result.ok && result.error.kind).toBe('invalid')
  })

  it('considers two names with the same cleaned text equal', () => {
    const one = ClientName.create('Atelier Photo Camille')
    const other = ClientName.create('  Atelier   Photo   Camille ')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
  })

  it('considers two different names unequal', () => {
    const one = ClientName.create('Atelier Photo Camille')
    const other = ClientName.create('Studio Jean')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(false)
  })

  it('renders as its text when interpolated into a log line', () => {
    const result = ClientName.create('Atelier Photo Camille')

    expect(result.ok && `${result.value}`).toBe('Atelier Photo Camille')
  })
})
