import { describe, expect, it } from 'vitest'

import type { DomainError } from './errors'
import { JoinCode, normaliseJoinCode } from './joinCode'
import { map, type Result, unwrapOr } from './result'

/**
 * `JoinCode.create` is typed to take a string, but its `typeof` guard is there for the
 * callers that have lost the type: a legacy database row, or a join request that
 * reached the domain without passing through zod. A method-shaped view of the class
 * reaches that guard without an `as` cast anywhere in the test.
 */
interface UntypedJoinCodeFactory {
  create(raw: unknown): Result<JoinCode, DomainError>
}

const untyped: UntypedJoinCodeFactory = JoinCode

const bytesOf = (byte: number): Uint8Array => new Uint8Array(JoinCode.minLength).fill(byte)

/**
 * A byte source that reports the right length but yields a value no real `Uint8Array`
 * can hold. Nothing in the application does this — the `IdGenerator` port returns real
 * bytes — but it is the only way to exercise the index fallback in `fromBytes`, and
 * that fallback is load-bearing: without it a missed index would append the literal
 * text `undefined` and the host would print `undefin` on the guests' cards.
 */
class LyingByteSource extends Uint8Array {
  override *[Symbol.iterator](): Generator<number> {
    for (let index = 0; index < this.length; index += 1) yield Number.NaN
  }
}

/*
 * Every case in this file is written in terms of `JoinCode.minLength`,
 * `JoinCode.maxLength` and `JoinCode.alphabet`, so these pin the format itself. Without
 * them a silent change to any of the three would keep the whole file green while the
 * printed cards stopped matching the codes the server accepts.
 */
describe('the join code format', () => {
  it('defaults to six characters, which is what every pre-existing printed card is', () => {
    expect(JoinCode.minLength).toBe(6)
  })

  it('accepts a configured code of up to ten characters (JOIN_CODE_LENGTH)', () => {
    expect(JoinCode.maxLength).toBe(10)
  })

  it('offers 32 characters, so one byte maps onto one character without bias', () => {
    expect(JoinCode.alphabet).toHaveLength(32)
  })

  // I/l/1 and O/0 are indistinguishable in most print faces, and dropping U removes
  // most of the six-character codes a host would be embarrassed to hand out.
  it.each([...'ILOU'])('leaves %s out of the alphabet', (character) => {
    expect(JoinCode.alphabet.includes(character)).toBe(false)
  })
})

describe('normaliseJoinCode', () => {
  it('uppercases what the guest typed', () => {
    expect(normaliseJoinCode('h7k2qm')).toBe('H7K2QM')
  })

  // A guest reading a printed card adds whatever separator the layout suggested.
  it('strips spaces, dashes, underscores and dots', () => {
    expect(normaliseJoinCode(' h7-k2_q.m ')).toBe('H7K2QM')
  })

  it('reads I and L as the digit 1', () => {
    expect(normaliseJoinCode('ILil')).toBe('1111')
  })

  it('reads O as the digit 0', () => {
    expect(normaliseJoinCode('Oo')).toBe('00')
  })

  it('leaves a character that is already in the alphabet alone', () => {
    expect(normaliseJoinCode('H7K2QM')).toBe('H7K2QM')
  })

  it('yields an empty string for a code made only of separators', () => {
    expect(normaliseJoinCode(' -- ')).toBe('')
  })
})

describe('JoinCode.create', () => {
  it('accepts a canonical code', () => {
    const result = JoinCode.create('H7K2QM')

    expect(result.ok && result.value.value).toBe('H7K2QM')
  })

  it('accepts the same code typed in lowercase', () => {
    const result = JoinCode.create('h7k2qm')

    expect(result.ok && result.value.value).toBe('H7K2QM')
  })

  it('accepts the same code typed with a dash', () => {
    const result = JoinCode.create('H7K-2QM')

    expect(result.ok && result.value.value).toBe('H7K2QM')
  })

  // The whole point of Crockford's normalisation: a guest who reads 0 as O still gets
  // into the event instead of seeing "code introuvable".
  it('accepts a code where the guest typed O instead of zero', () => {
    const result = JoinCode.create('H7K2QO')

    expect(result.ok && result.value.value).toBe('H7K2Q0')
  })

  it('refuses a code one character below the minimum', () => {
    const result = JoinCode.create('H7K2Q')

    expect(!result.ok && result.error.code).toBe('joinCode.wrongLength')
  })

  it('refuses a code one character above the maximum', () => {
    const result = JoinCode.create('H7K2QMN8DVX')

    expect(!result.ok && result.error.code).toBe('joinCode.wrongLength')
  })

  it('refuses an empty code, which is what an untouched join field sends', () => {
    const result = JoinCode.create('')

    expect(!result.ok && result.error.code).toBe('joinCode.wrongLength')
  })

  it('reports the accepted range so the UI can size its input', () => {
    const result = JoinCode.create('H7K2Q')

    expect(!result.ok && result.error.details).toEqual({
      min: JoinCode.minLength,
      max: JoinCode.maxLength,
    })
  })

  // JOIN_CODE_LENGTH accepts 6 to 10 (P4-09 / D-14): a host's own code may be any
  // length in that range, and a renewed or rotated code may land anywhere in it too —
  // the exact length 6 this class used to require is gone, and every length the range
  // admits must parse exactly as the others do.
  it.each([6, 7, 8, 9, 10])('accepts a configured code %i characters long', (length) => {
    const candidate = JoinCode.alphabet.repeat(2).slice(0, length)

    const result = JoinCode.create(candidate)

    expect(result.ok && result.value.value).toBe(candidate)
  })

  // U is excluded from the alphabet on purpose, so it can never be a valid character
  // however the guest capitalises it.
  it.each(['H7K2QU', 'h7k2qu'])('refuses %s, because U is not in the alphabet', (raw) => {
    const result = JoinCode.create(raw)

    expect(!result.ok && result.error.code).toBe('joinCode.malformed')
  })

  it('refuses a value that is not a string at all', () => {
    const result = untyped.create(772_255)

    expect(!result.ok && result.error.code).toBe('joinCode.invalid')
  })
})

describe('JoinCode.fromBytes', () => {
  it('maps a known byte array to one known code, every time', () => {
    const result = JoinCode.fromBytes(new Uint8Array([0, 31, 32, 255, 10, 17]))

    expect(result.ok && result.value.value).toBe('0Z0ZAH')
  })

  // Deriving a code from too little entropy is the one mistake here that would not
  // look like a bug: the code would still be six characters, just guessable.
  it.each([0, JoinCode.minLength - 1, JoinCode.minLength + 1])(
    'refuses %i bytes of entropy when no length is given (the default, six)',
    (count) => {
      const result = JoinCode.fromBytes(new Uint8Array(count))

      expect(!result.ok && result.error.code).toBe('joinCode.wrongEntropyLength')
    },
  )

  it('reports how many bytes of entropy it wanted', () => {
    const result = JoinCode.fromBytes(new Uint8Array(1))

    expect(!result.ok && result.error.details).toEqual({ length: JoinCode.minLength })
  })

  it('still lands inside the alphabet when an index cannot be resolved', () => {
    const result = JoinCode.fromBytes(new LyingByteSource(JoinCode.minLength))

    expect(result.ok && result.value.value).toBe('0'.repeat(JoinCode.minLength))
  })

  it.each([
    [0, '0'],
    [1, '1'],
    [17, 'H'],
    [31, 'Z'],
    [32, '0'],
    [33, '1'],
    [63, 'Z'],
    [64, '0'],
    [224, '0'],
    [255, 'Z'],
  ])('maps byte %i to %s', (byte, character) => {
    const result = JoinCode.fromBytes(bytesOf(byte))

    expect(result.ok && result.value.value).toBe(character.repeat(JoinCode.minLength))
  })

  /**
   * `JOIN_CODE_LENGTH` (P4-09 / D-14): a configured deployment asks for more entropy,
   * and `fromBytes` has to produce a code of exactly that length rather than silently
   * keeping the default.
   */
  describe('a configured length', () => {
    it('derives a code of the requested length from exactly that many bytes', () => {
      const eight = new Uint8Array([0, 1, 17, 31, 32, 255, 10, 9])

      const result = JoinCode.fromBytes(eight, 8)

      expect(result.ok && result.value.value).toBe('01HZ0ZA9')
    })

    it('refuses entropy that does not match the requested length', () => {
      const result = JoinCode.fromBytes(new Uint8Array(6), 8)

      expect(!result.ok && result.error.code).toBe('joinCode.wrongEntropyLength')
    })

    it('reports the requested length it wanted, not the default', () => {
      const result = JoinCode.fromBytes(new Uint8Array(6), 8)

      expect(!result.ok && result.error.details).toEqual({ length: 8 })
    })

    it('refuses a requested length outside the configurable range, through JoinCode.create', () => {
      const result = JoinCode.fromBytes(new Uint8Array(11), 11)

      expect(!result.ok && result.error.code).toBe('joinCode.wrongLength')
    })
  })

  /*
   * 256 is an exact multiple of 32, so every alphabet character must be selected by
   * exactly eight of the 256 possible byte values. Anything else is modulo bias, which
   * would make part of the code space measurably easier to guess.
   */
  it('selects each alphabet character from exactly one eighth-share of the byte range', () => {
    const selected = Array.from({ length: 256 }, (_unused, byte) =>
      unwrapOr(
        map(JoinCode.fromBytes(bytesOf(byte)), (code) => code.value.charAt(0)),
        'no code at all',
      ),
    )

    const occurrences = [...JoinCode.alphabet].map(
      (character) => selected.filter((seen) => seen === character).length,
    )

    expect(occurrences).toEqual(Array.from({ length: 32 }, () => 8))
  })
})

describe('a JoinCode instance', () => {
  it('equals another code with the same value', () => {
    const one = JoinCode.create('H7K2QM')
    const other = JoinCode.create('h7k2-qm')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
  })

  it('does not equal a code with a different value', () => {
    const one = JoinCode.create('H7K2QM')
    const other = JoinCode.create('Z9W4RT')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(false)
  })

  it('stringifies to its value, so it can be printed on a card', () => {
    const result = JoinCode.create('H7K2QM')

    expect(result.ok && `/join/${result.value.toString()}`).toBe('/join/H7K2QM')
  })
})
