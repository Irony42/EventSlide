import { describe, expect, it } from 'vitest'

import type { DomainError } from './errors'
import type { Result } from './result'
import { Slug, slugify } from './slug'

/**
 * `Slug.create` is typed to take a string, but its `typeof` guard is there for the
 * callers that have lost the type: a legacy database row, or a JSON body that reached
 * the domain without passing through zod. A method-shaped view of the class reaches
 * that guard without an `as` cast anywhere in the test.
 */
interface UntypedSlugFactory {
  create(raw: unknown): Result<Slug, DomainError>
}

const untyped: UntypedSlugFactory = Slug

/*
 * Every boundary case in this file is written in terms of `Slug.minLength` and
 * `Slug.maxLength`, so these two pin the numbers themselves — otherwise widening a
 * bound would leave the whole file green while the host-facing form, which validates
 * against the same published constants, silently changed shape.
 */
describe('the published slug bounds', () => {
  it('needs at least two characters', () => {
    expect(Slug.minLength).toBe(2)
  })

  it('allows at most sixty-four, which is what stays readable in a QR code', () => {
    expect(Slug.maxLength).toBe(64)
  })
})

describe('slugify', () => {
  // The slug ends up in every QR code and every projector URL, so it must survive
  // copy-paste through clients that mangle non-ASCII.
  it('folds accents to their base letters', () => {
    expect(slugify('Camille & Sacha à Lyon')).toBe('camille-sacha-a-lyon')
  })

  it('collapses a run of separators into a single dash', () => {
    expect(slugify('Anne   ///   Bob')).toBe('anne-bob')
  })

  it('trims the dashes it would otherwise leave at both ends', () => {
    expect(slugify('  -- Fête du village -- ')).toBe('fete-du-village')
  })

  it('truncates a very long name to the maximum length', () => {
    expect(slugify('a'.repeat(Slug.maxLength + 20))).toHaveLength(Slug.maxLength)
  })

  // Truncating mid-separator used to produce `...-`, which then failed `Slug.create`
  // and left the host staring at a preview they could not save.
  it('never leaves a trailing dash after truncating', () => {
    const name = `${'a'.repeat(Slug.maxLength - 1)} bravo`

    expect(slugify(name)).toBe('a'.repeat(Slug.maxLength - 1))
  })

  it('yields an empty string for a name made only of punctuation', () => {
    expect(slugify('!!! ??? ...')).toBe('')
  })
})

describe('Slug.create', () => {
  it('accepts a well-formed slug', () => {
    const result = Slug.create('camille-et-sacha')

    expect(result.ok && result.value.value).toBe('camille-et-sacha')
  })

  it('accepts a slug pasted with surrounding whitespace', () => {
    const result = Slug.create('  camille-et-sacha  ')

    expect(result.ok && result.value.value).toBe('camille-et-sacha')
  })

  it('accepts a slug of exactly the minimum length', () => {
    const result = Slug.create('a'.repeat(Slug.minLength))

    expect(result.ok && result.value.value.length).toBe(Slug.minLength)
  })

  it('accepts a slug of exactly the maximum length', () => {
    const result = Slug.create('a'.repeat(Slug.maxLength))

    expect(result.ok && result.value.value.length).toBe(Slug.maxLength)
  })

  it('refuses a slug one character below the minimum', () => {
    const result = Slug.create('a'.repeat(Slug.minLength - 1))

    expect(!result.ok && result.error.code).toBe('slug.tooShort')
  })

  it('refuses an empty slug', () => {
    const result = Slug.create('')

    expect(!result.ok && result.error.code).toBe('slug.tooShort')
  })

  it('reports the minimum alongside a too-short slug, so the UI can say it', () => {
    const result = Slug.create('a')

    expect(!result.ok && result.error.details).toEqual({ min: Slug.minLength })
  })

  it('refuses a slug one character above the maximum', () => {
    const result = Slug.create('a'.repeat(Slug.maxLength + 1))

    expect(!result.ok && result.error.code).toBe('slug.tooLong')
  })

  it('reports the maximum alongside a too-long slug', () => {
    const result = Slug.create('a'.repeat(Slug.maxLength + 1))

    expect(!result.ok && result.error.details).toEqual({ max: Slug.maxLength })
  })

  // Storing the slug already-normalised is what keeps the unique index usable without
  // COLLATE NOCASE, so anything create would have had to change is refused outright.
  it.each([
    ['an uppercase letter', 'Mariage'],
    ['a leading dash', '-mariage'],
    ['a trailing dash', 'mariage-'],
    ['a double dash', 'mariage--2024'],
    ['an underscore', 'mariage_2024'],
    ['an accent', 'mariée-2024'],
    ['a space', 'mariage 2024'],
  ])('refuses a slug containing %s', (_label, candidate) => {
    const result = Slug.create(candidate)

    expect(!result.ok && result.error.code).toBe('slug.malformed')
  })

  it.each([
    'admin',
    'api',
    'display',
    'events',
    'join',
    'media',
    'new',
    'settings',
    'undefined',
    'upload',
  ])('refuses the reserved word %s', (candidate) => {
    const result = Slug.create(candidate)

    expect(!result.ok && result.error.code).toBe('slug.reserved')
  })

  it('reports which word was reserved', () => {
    const result = Slug.create('admin')

    expect(!result.ok && result.error.details).toEqual({ slug: 'admin' })
  })

  it('refuses a value that is not a string at all', () => {
    const result = untyped.create(404)

    expect(!result.ok && result.error.code).toBe('slug.invalid')
  })
})

describe('Slug.fromName', () => {
  it('folds a free-text event name into a slug', () => {
    const result = Slug.fromName('Camille & Sacha à Lyon')

    expect(result.ok && result.value.value).toBe('camille-sacha-a-lyon')
  })

  it('refuses a name that folds away to nothing', () => {
    const result = Slug.fromName('??? !!!')

    expect(!result.ok && result.error.code).toBe('slug.tooShort')
  })

  it('refuses a name that folds onto a reserved word', () => {
    const result = Slug.fromName('Admin')

    expect(!result.ok && result.error.code).toBe('slug.reserved')
  })
})

describe('Slug.fromNameWithRandomSuffix', () => {
  const bytes = (...values: readonly number[]): Uint8Array => new Uint8Array(values)

  it('appends a lowercase Crockford suffix to the name folded into slug shape', () => {
    const result = Slug.fromNameWithRandomSuffix('Camille & Sacha', bytes(0, 1, 17, 31, 32, 255))

    expect(result.ok && result.value.value).toBe('camille-sacha-01hz0z')
  })

  it('needs six bytes of entropy, matching the alphabet it draws from', () => {
    expect(Slug.suffixEntropyBytes).toBe(6)
  })

  it('refuses the wrong amount of suffix entropy', () => {
    const result = Slug.fromNameWithRandomSuffix('Camille & Sacha', bytes(0, 0, 0, 0, 0))

    expect(!result.ok && result.error.code).toBe('slug.suffixWrongEntropyLength')
  })

  it('reserves room for the suffix, so a long name is truncated to make space for it rather than into it', () => {
    const longName = 'a'.repeat(100)

    const result = Slug.fromNameWithRandomSuffix(longName, bytes(0, 0, 0, 0, 0, 0))

    expect(result.ok && result.value.value).toBe(`${'a'.repeat(Slug.maxLength - 7)}-000000`)
    expect(result.ok && result.value.value).toHaveLength(Slug.maxLength)
  })

  it('never produces the bare slug a sequential suffix would have revealed existed', () => {
    // Draft 3's mistake: a fallback that only appended on collision proved the bare
    // slug existed the moment a second "Mariage" asked for it. This is the regression
    // test for always appending instead.
    const first = Slug.fromNameWithRandomSuffix('Mariage', bytes(0, 0, 0, 0, 0, 0))
    const second = Slug.fromNameWithRandomSuffix('Mariage', bytes(1, 1, 1, 1, 1, 1))

    expect(first.ok && first.value.value).not.toBe('mariage')
    expect(second.ok && second.value.value).not.toBe('mariage')
    expect(first.ok && second.ok && first.value.equals(second.value)).toBe(false)
  })

  it('still refuses a name that folds away to nothing, as a malformed slug rather than a bare suffix', () => {
    // `slugify('??? !!!')` is `''`, so the candidate is `-000000`: a leading dash,
    // which `Slug.create` rejects exactly as it would reject one typed by a host.
    const result = Slug.fromNameWithRandomSuffix('??? !!!', bytes(0, 0, 0, 0, 0, 0))

    expect(!result.ok && result.error.code).toBe('slug.malformed')
  })

  /**
   * A byte source that reports the right length but yields a value no real `Uint8Array`
   * can hold — the same device `joinCode.test.ts` uses for `JoinCode.fromBytes`'s own
   * fallback. Nothing in the application does this; it is the only way to exercise the
   * index fallback, and that fallback is load-bearing: without it a missed index would
   * append the literal text `undefined` into a URL every guest's phone has to resolve.
   */
  class LyingByteSource extends Uint8Array {
    override *[Symbol.iterator](): Generator<number> {
      for (let index = 0; index < this.length; index += 1) yield Number.NaN
    }
  }

  it('still lands inside the alphabet when an index cannot be resolved', () => {
    const result = Slug.fromNameWithRandomSuffix(
      'Camille & Sacha',
      new LyingByteSource(Slug.suffixEntropyBytes),
    )

    expect(result.ok && result.value.value).toBe('camille-sacha-000000')
  })
})

describe('Slug.isReserved', () => {
  it('is true for a word that would collide with a route', () => {
    expect(Slug.isReserved('moderation')).toBe(true)
  })

  it('is false for an ordinary event slug', () => {
    expect(Slug.isReserved('camille-et-sacha')).toBe(false)
  })
})

describe('a Slug instance', () => {
  it('equals another slug with the same value', () => {
    const one = Slug.create('mariage')
    const other = Slug.create('mariage')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
  })

  it('does not equal a slug with a different value', () => {
    const one = Slug.create('mariage')
    const other = Slug.create('bapteme')

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(false)
  })

  it('stringifies to its value, so it can be interpolated into a URL', () => {
    const result = Slug.create('mariage')

    expect(result.ok && `/e/${result.value.toString()}/display`).toBe('/e/mariage/display')
  })
})
