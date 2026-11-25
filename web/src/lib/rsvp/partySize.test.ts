import { describe, expect, it } from 'vitest'
import { PARTY_SIZE_MAX, PARTY_SIZE_MIN, usablePartySize } from './partySize'

describe('usablePartySize', () => {
  it('accepts every whole number from the minimum to the maximum', () => {
    for (let size = PARTY_SIZE_MIN; size <= PARTY_SIZE_MAX; size += 1) {
      expect(usablePartySize(String(size))).toBe(size)
    }
  })

  it('accepts a leading zero', () => {
    expect(usablePartySize('07')).toBe(7)
  })

  it.each(['', '0', '11', '100', '-3', '2.5', '1e1', 'abc', ' 4', '0000004'])(
    'refuses %j',
    (value) => {
      expect(usablePartySize(value)).toBeNull()
    },
  )
})
