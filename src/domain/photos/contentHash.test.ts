import { describe, expect, it } from 'vitest'
import { ContentHash } from './contentHash'

/** SHA-256 of an empty input: a real digest, so the fixture cannot be accidentally valid. */
const DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('ContentHash.create', () => {
  it('accepts a lowercase hexadecimal digest', () => {
    const result = ContentHash.create(DIGEST)

    expect(result.ok && result.value.value).toBe(DIGEST)
  })

  it('normalises an uppercase digest, so the unique index still catches a retry', () => {
    const result = ContentHash.create(DIGEST.toUpperCase())

    expect(result.ok && result.value.value).toBe(DIGEST)
  })

  it('trims surrounding whitespace', () => {
    const result = ContentHash.create(`  ${DIGEST}  `)

    expect(result.ok && result.value.value).toBe(DIGEST)
  })

  it('refuses a digest one character short', () => {
    const result = ContentHash.create(DIGEST.slice(0, ContentHash.hexLength - 1))

    expect(!result.ok && result.error.code).toBe('contentHash.malformed')
  })

  it('refuses a digest one character long', () => {
    const result = ContentHash.create(`${DIGEST}a`)

    expect(!result.ok && result.error.code).toBe('contentHash.malformed')
  })

  it('refuses a digest containing a character that is not hexadecimal', () => {
    const result = ContentHash.create(`${DIGEST.slice(0, ContentHash.hexLength - 1)}z`)

    expect(!result.ok && result.error.code).toBe('contentHash.malformed')
  })

  it('refuses an empty digest, which is what an absent column reads as', () => {
    const result = ContentHash.create('')

    expect(!result.ok && result.error.code).toBe('contentHash.malformed')
  })

  it('refuses a non-string, which is what a corrupt row or a JSON body can hand it', () => {
    // The guard exists for values whose declared type is only a promise made
    // upstream — a database row, a request body. Reaching it means lying to the
    // compiler on purpose, so the lie is written out rather than laundered through
    // an `any` from `JSON.parse`.
    const notAString = 42 as unknown as string

    const result = ContentHash.create(notAString)

    expect(!result.ok && result.error.code).toBe('contentHash.invalid')
  })
})

describe('ContentHash', () => {
  it('shortens to twelve characters for a log line and an export filename', () => {
    const result = ContentHash.create(DIGEST)

    expect(result.ok && result.value.short).toBe('e3b0c44298fc')
  })

  it('considers two hashes of the same bytes equal, however they were cased', () => {
    const one = ContentHash.create(DIGEST)
    const other = ContentHash.create(DIGEST.toUpperCase())

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
  })

  it('considers hashes of different bytes different', () => {
    const one = ContentHash.create(DIGEST)
    const other = ContentHash.create('a'.repeat(ContentHash.hexLength))

    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(false)
  })

  it('stringifies to the full digest, because it is also the storage key', () => {
    const result = ContentHash.create(DIGEST)

    expect(result.ok && `${result.value}`).toBe(DIGEST)
  })
})
