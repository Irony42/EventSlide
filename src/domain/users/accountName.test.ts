import { describe, expect, it } from 'vitest'
import { AccountName } from './accountName'

// Written with fromCharCode: an editor or a tool may rewrite an escape into the invisible
// character itself, and a test of invisible characters must not depend on staying visible.
const ZWSP = String.fromCharCode(0x200b)
const RLO = String.fromCharCode(0x202e)

const valueOf = (raw: string): string => {
  const parsed = AccountName.create(raw)
  if (!parsed.ok) throw new Error(`refused: ${parsed.error.code}`)
  return parsed.value.value
}

describe('AccountName', () => {
  it('keeps a name as it was written, accents included', () => {
    expect(valueOf('Léa Dupont-Martin')).toBe('Léa Dupont-Martin')
  })

  it('trims it and folds a run of spaces into one', () => {
    expect(valueOf('  Camille   Sacha  ')).toBe('Camille Sacha')
  })

  it('puts a name pasted over several lines back on one', () => {
    expect(valueOf('Camille\r\nSacha\tMartin')).toBe('Camille Sacha Martin')
  })

  it('drops the characters nobody can see, so two names that look alike are one name', () => {
    expect(valueOf(`Le${ZWSP}a`)).toBe('Lea')
    expect(valueOf(`${RLO}Alice`)).toBe('Alice')
  })

  it.each(['', '   ', '\n\t', `${ZWSP}${ZWSP}`])('refuses %j, which names nobody', (raw) => {
    const parsed = AccountName.create(raw)

    expect(!parsed.ok && parsed.error.code).toBe('accountName.empty')
  })

  it('accepts exactly the longest name and refuses one character more', () => {
    expect(AccountName.create('a'.repeat(AccountName.maxLength)).ok).toBe(true)

    const parsed = AccountName.create('a'.repeat(AccountName.maxLength + 1))
    expect(!parsed.ok && parsed.error.code).toBe('accountName.tooLong')
    expect(!parsed.ok && parsed.error.details).toEqual({ max: AccountName.maxLength })
  })

  it('counts the length after normalising, not before', () => {
    expect(AccountName.create(`${'a'.repeat(AccountName.maxLength)}${ZWSP}${ZWSP}`).ok).toBe(true)
  })

  it('compares by value', () => {
    const left = AccountName.create('Camille')
    const right = AccountName.create(' Camille ')
    const other = AccountName.create('Sacha')
    if (!left.ok || !right.ok || !other.ok) throw new Error('invalid fixture')

    expect(left.value.equals(right.value)).toBe(true)
    expect(left.value.equals(other.value)).toBe(false)
    expect(left.value.toString()).toBe('Camille')
  })
})
