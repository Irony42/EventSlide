import { describe, expect, it } from 'vitest'
import { characterCount, clampCharacters } from './characters'

// Built from code points: the Write tool must not see literal emoji escapes.
const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]
  .map((code) => String.fromCodePoint(code))
  .join('')
const FLAG = String.fromCodePoint(0x1f1eb, 0x1f1f7)

describe('characterCount', () => {
  it('counts code points like the server, so an emoji is not two', () => {
    expect(characterCount(String.fromCodePoint(0x1f600))).toBe(1)
    expect(characterCount(FLAG)).toBe(2)
    expect(characterCount(FAMILY)).toBe(5)
    expect(characterCount('abc')).toBe(3)
  })
})

describe('clampCharacters', () => {
  it('leaves a text within the limit untouched, joiners included', () => {
    expect(clampCharacters(FAMILY, 5)).toBe(FAMILY)
    expect(clampCharacters(`${FLAG}${FLAG}`, 4)).toBe(`${FLAG}${FLAG}`)
  })

  it('keeps the first characters and never cuts an emoji in half', () => {
    const smile = String.fromCodePoint(0x1f600)
    expect(clampCharacters(`ab${smile}${smile}`, 3)).toBe(`ab${smile}`)
    expect(clampCharacters('abcdef', 3)).toBe('abc')
  })
})
