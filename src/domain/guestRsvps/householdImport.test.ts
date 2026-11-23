import { describe, expect, it } from 'vitest'
import { HOUSEHOLD_IMPORT_MAX_LINES, householdNameKey, parseHouseholdList } from './householdImport'

const parse = (text: unknown, existing: readonly string[] = []) => {
  const parsed = parseHouseholdList(text, existing)
  if (!parsed.ok) throw new Error(parsed.error.code)
  return parsed.value
}

describe('parseHouseholdList', () => {
  it('reads one household per line, Nom ; places, and a tab as the same separator', () => {
    const { households, skipped } = parse('Famille Martin ; 4\nLéa Durand\t2\r\nHugo;1')

    expect(households).toEqual([
      { name: 'Famille Martin', places: 4 },
      { name: 'Léa Durand', places: 2 },
      { name: 'Hugo', places: 1 },
    ])
    expect(skipped).toEqual([])
  })

  it('ignores blank lines but counts them in the line numbers it reports', () => {
    const { households, skipped } = parse('A ; 2\n\n   \nB ; 99')

    expect(households).toEqual([{ name: 'A', places: 2 }])
    expect(skipped).toEqual([{ line: 4, reason: 'places' }])
  })

  it('gives one place to a line with no number, and skips a number that is not 1 to 10', () => {
    const { households, skipped } = parse(
      ['Seul', 'Vide ;', 'A ; 0', 'B ; 11', 'C ; deux', 'D ; 2,5', 'E ; -1', 'F ; 10'].join('\n'),
    )

    expect(households).toEqual([
      { name: 'Seul', places: 1 },
      { name: 'Vide', places: 1 },
      { name: 'F', places: 10 },
    ])
    expect(skipped.map((line) => [line.line, line.reason])).toEqual([
      [3, 'places'],
      [4, 'places'],
      [5, 'places'],
      [6, 'places'],
      [7, 'places'],
    ])
  })

  it('splits at the last separator, so a name may hold a semicolon', () => {
    expect(parse('Martin; Léa ; 3').households).toEqual([{ name: 'Martin; Léa', places: 3 }])
  })

  it('skips an empty name and a name over 80 characters', () => {
    const { households, skipped } = parse(` ; 3\n${'x'.repeat(81)} ; 2\n${'y'.repeat(80)} ; 2`)

    expect(households).toHaveLength(1)
    expect(skipped).toEqual([
      { line: 1, reason: 'name' },
      { line: 2, reason: 'name' },
    ])
  })

  it('skips a duplicate without regard to case and accents, in the paste and in the list', () => {
    const { households, skipped } = parse('Élodie ; 2\nelodie ; 3\nMartin ; 4\nMARTIN ; 1', [
      'Dupont',
      'martin',
    ])

    expect(households).toEqual([{ name: 'Élodie', places: 2 }])
    expect(skipped).toEqual([
      { line: 2, reason: 'duplicate' },
      { line: 3, reason: 'duplicate' },
      { line: 4, reason: 'duplicate' },
    ])
  })

  it('refuses more than 300 lines whole, blank ones not counted, and what is not text', () => {
    const many = Array.from({ length: HOUSEHOLD_IMPORT_MAX_LINES }, (_, i) => `F${i} ; 1`)
    expect(parseHouseholdList(many.join('\n') + '\n\n\n', []).ok).toBe(true)

    const tooMany = parseHouseholdList([...many, 'One more ; 1'].join('\n'), [])
    expect(!tooMany.ok && tooMany.error.code).toBe('household.importTooLong')
    expect(!tooMany.ok && tooMany.error.details).toEqual({ max: 300 })
    const invalid = parseHouseholdList(42, [])
    expect(!invalid.ok && invalid.error.code).toBe('household.importInvalid')
  })
})

describe('householdNameKey', () => {
  it('folds case and accents', () => {
    expect(householdNameKey('ÉLODIE Müller')).toBe('elodie muller')
  })
})
