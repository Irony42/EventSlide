import { describe, expect, it } from 'vitest'
import { DisplayName } from './displayName'

describe('DisplayName.create', () => {
  it('keeps a first name exactly as the guest typed it', () => {
    const result = DisplayName.create('Léa')

    expect(result.ok && result.value.value).toBe('Léa')
  })

  it('accepts a name made only of emoji', () => {
    const result = DisplayName.create('🎉🎊')

    expect(result.ok && result.value.value).toBe('🎉🎊')
  })

  it('trims surrounding whitespace', () => {
    const result = DisplayName.create('   Léa   ')

    expect(result.ok && result.value.value).toBe('Léa')
  })

  it('collapses a run of spaces so the wall shows one name, not a gap', () => {
    const result = DisplayName.create('Léa     Martin')

    expect(result.ok && result.value.value).toBe('Léa Martin')
  })

  it('folds a pasted line break into a space', () => {
    const result = DisplayName.create('Léa\nMartin')

    expect(result.ok && result.value.value).toBe('Léa Martin')
  })

  it('strips a bidirectional override that would reverse the projected line', () => {
    const result = DisplayName.create('Léa\u202E')

    expect(result.ok && result.value.value).toBe('Léa')
  })

  it('accepts a name of exactly the minimum length', () => {
    const raw = 'L'.repeat(DisplayName.minLength)

    const result = DisplayName.create(raw)

    expect(result.ok && result.value.value).toBe(raw)
  })

  it('refuses an empty name', () => {
    const result = DisplayName.create('')

    expect(!result.ok && result.error.code).toBe('displayName.empty')
  })

  it('refuses a name that is only whitespace', () => {
    const result = DisplayName.create('   ')

    expect(!result.ok && result.error.code).toBe('displayName.empty')
  })

  it('refuses a name that is only zero-width characters', () => {
    const result = DisplayName.create('\u200B\u200B')

    expect(!result.ok && result.error.code).toBe('displayName.empty')
  })

  it('accepts a name of exactly the maximum length', () => {
    const raw = 'é'.repeat(DisplayName.maxLength)

    const result = DisplayName.create(raw)

    expect(result.ok && result.value.value).toBe(raw)
  })

  it('refuses a name one character past the maximum', () => {
    const result = DisplayName.create('é'.repeat(DisplayName.maxLength + 1))

    expect(!result.ok && result.error.code).toBe('displayName.tooLong')
  })

  it('tells the client which maximum was exceeded', () => {
    const result = DisplayName.create('é'.repeat(DisplayName.maxLength + 1))

    expect(!result.ok && result.error.details).toEqual({ max: DisplayName.maxLength })
  })

  it('rejects an invalid name as input the guest can fix, not as a server fault', () => {
    const result = DisplayName.create('')

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('DisplayName.createOptional', () => {
  it('treats an absent name as staying anonymous', () => {
    const result = DisplayName.createOptional(undefined)

    expect(result.ok && result.value).toBeNull()
  })

  it('treats a null name as staying anonymous', () => {
    const result = DisplayName.createOptional(null)

    expect(result.ok && result.value).toBeNull()
  })

  it('treats an untouched, blank field as staying anonymous', () => {
    const result = DisplayName.createOptional('   ')

    expect(result.ok && result.value).toBeNull()
  })

  it('treats a field holding only invisible characters as staying anonymous', () => {
    const result = DisplayName.createOptional('\u200B')

    expect(result.ok && result.value).toBeNull()
  })

  it('parses a name the guest did type', () => {
    const result = DisplayName.createOptional('  Léa  ')

    expect(result.ok && result.value?.value).toBe('Léa')
  })

  it('still refuses an over-long name when the field was optional', () => {
    const result = DisplayName.createOptional('é'.repeat(DisplayName.maxLength + 1))

    expect(!result.ok && result.error.code).toBe('displayName.tooLong')
  })
})

describe('DisplayName equality', () => {
  it('treats two names that normalise alike as the same name', () => {
    const typed = DisplayName.create('  Léa  ')
    const pasted = DisplayName.create('Léa\u200B')

    expect(typed.ok && pasted.ok && typed.value.equals(pasted.value)).toBe(true)
  })

  it('treats two different names as different', () => {
    const lea = DisplayName.create('Léa')
    const sacha = DisplayName.create('Sacha')

    expect(lea.ok && sacha.ok && lea.value.equals(sacha.value)).toBe(false)
  })

  it('renders as the name itself', () => {
    const result = DisplayName.create('Léa')

    expect(result.ok && `${result.value}`).toBe('Léa')
  })
})
