import { afterEach, describe, expect, it } from 'vitest'
import { wellFormed } from './wellFormed'

const LONE_HIGH = String.fromCharCode(0xd83c)
const LONE_LOW = String.fromCharCode(0xdf89)

describe('wellFormed', () => {
  it('leaves a text with whole pairs and no surrogate alone', () => {
    expect(wellFormed('Léa 🎉 fête 👨‍👩‍👧‍👦')).toBe('Léa 🎉 fête 👨‍👩‍👧‍👦')
  })

  it('replaces a lone high surrogate and a lone low one by U+FFFD', () => {
    expect(wellFormed(`a${LONE_HIGH}b`)).toBe('a\ufffdb')
    expect(wellFormed(`a${LONE_LOW}b`)).toBe('a\ufffdb')
    expect(wellFormed(`🎉${LONE_HIGH}`)).toBe('🎉\ufffd')
  })

  it('makes a text encodeURIComponent accepts', () => {
    expect(() => encodeURIComponent(`a${LONE_HIGH}`)).toThrow(URIError)
    expect(() => encodeURIComponent(wellFormed(`a${LONE_HIGH}`))).not.toThrow()
  })

  describe('in a browser with no toWellFormed', () => {
    const native = Object.getOwnPropertyDescriptor(String.prototype, 'toWellFormed')
    afterEach(() => {
      if (native !== undefined) Object.defineProperty(String.prototype, 'toWellFormed', native)
    })

    it('does the same by hand', () => {
      Reflect.deleteProperty(String.prototype, 'toWellFormed')

      expect(wellFormed(`a${LONE_HIGH}b${LONE_LOW}🎉`)).toBe('a\ufffdb\ufffd🎉')
    })
  })
})
