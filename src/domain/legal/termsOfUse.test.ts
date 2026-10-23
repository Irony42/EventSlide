import { describe, expect, it } from 'vitest'
import { TERMS_VERSION_MAX_LENGTH, isTermsVersion } from './termsOfUse'

describe('isTermsVersion', () => {
  it.each(['2027-01', '3', 'v2.1', '2027_01_15', 'CGU-2027.1'])('accepts %s', (version) => {
    expect(isTermsVersion(version)).toBe(true)
  })

  it('accepts one of exactly the longest length, and refuses one character more', () => {
    expect(isTermsVersion('a'.repeat(TERMS_VERSION_MAX_LENGTH))).toBe(true)
    expect(isTermsVersion('a'.repeat(TERMS_VERSION_MAX_LENGTH + 1))).toBe(false)
  })

  it.each([
    ['nothing', ''],
    ['a space', '2027 01'],
    ['a sentence', 'the new terms'],
    ['an address', 'camille@example.org'],
    ['a path', '2027/01'],
    ['a line break', '2027-01\n'],
    ['a leading hyphen', '-2027'],
    ['a leading dot', '.2027'],
    ['a letter with an accent', 'édition-1'],
    ['a token as long as a real one', 'Z7q-Mx0Ld3Tn9VbRk2YcHs8WfAe5GuJi4PoXz1NvB6E'],
  ])('refuses %s, which is not a version and could be anything else', (_what, value) => {
    expect(isTermsVersion(value)).toBe(false)
  })

  it.each([undefined, null, 3, {}, ['2027-01']])('refuses %j, which is not text', (value) => {
    expect(isTermsVersion(value)).toBe(false)
  })
})
