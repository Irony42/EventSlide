import { describe, expect, it } from 'vitest'
import { REACTION_KINDS, isReactionKind, reactionWeight } from './reactionKind'

describe('REACTION_KINDS', () => {
  it('offers exactly the five kinds the phone renders as buttons', () => {
    expect(REACTION_KINDS).toEqual(['love', 'laugh', 'wow', 'cheers', 'clap'])
  })
})

describe('isReactionKind', () => {
  it.each(REACTION_KINDS)('accepts %s', (kind) => {
    expect(isReactionKind(kind)).toBe(true)
  })

  it('refuses a kind outside the closed set, so nothing arbitrary reaches the wall', () => {
    expect(isReactionKind('fire')).toBe(false)
  })

  it('refuses a value that is not a string at all', () => {
    expect(isReactionKind(3)).toBe(false)
  })
})

describe('reactionWeight', () => {
  it.each([
    { kind: 'love', expected: 2 },
    { kind: 'laugh', expected: 1 },
    { kind: 'wow', expected: 1 },
    { kind: 'cheers', expected: 1 },
    { kind: 'clap', expected: 1 },
  ] as const)('sizes $kind at $expected', ({ kind, expected }) => {
    expect(reactionWeight(kind)).toBe(expected)
  })

  it.each(REACTION_KINDS.filter((kind) => kind !== 'love'))(
    'gives the heart more area than %s',
    (kind) => {
      expect(reactionWeight('love')).toBeGreaterThan(reactionWeight(kind))
    },
  )
})
