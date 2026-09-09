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
