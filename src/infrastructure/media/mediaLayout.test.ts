import { describe, expect, it } from 'vitest'
import { ALL_MEDIA_VARIANTS } from '../../application/ports/mediaStore'
import { CONTENT_TYPE, EXTENSION, mediaObjectPath } from './mediaLayout'

const EVENT = '11111111-1111-4111-8111-111111111111'
const HASH = 'ab'.repeat(32)

describe('mediaObjectPath', () => {
  // The literal paths, because the layout is what is already on every installed disk: a change
  // here orphans an album, and a test that built the expectation from the same function would
  // follow the change instead of refusing it.
  it.each([
    ['original', `${EVENT}/original/ab/${HASH}.jpg`],
    ['display', `${EVENT}/display/ab/${HASH}.jpg`],
    ['thumb', `${EVENT}/thumb/ab/${HASH}.jpg`],
    ['video', `${EVENT}/video/ab/${HASH}.mp4`],
    ['poster', `${EVENT}/poster/ab/${HASH}.jpg`],
    ['source', `${EVENT}/source/ab/${HASH}.bin`],
  ] as const)('lays a %s down at %s', (variant, path) => {
    expect(mediaObjectPath(EVENT, HASH, variant)).toBe(path)
  })

  it('keeps the event id exactly as it is given, case included', () => {
    // `SAFE_SEGMENT` allows upper case and dots, and the id is a directory name on a disk that may
    // be case-sensitive.
    expect(mediaObjectPath('Mixed-Case.Event_1', HASH, 'thumb')).toBe(
      `Mixed-Case.Event_1/thumb/ab/${HASH}.jpg`,
    )
  })

  it('declares each variant with the type it is served as', () => {
    expect(CONTENT_TYPE).toEqual({
      original: 'image/jpeg',
      display: 'image/jpeg',
      thumb: 'image/jpeg',
      video: 'video/mp4',
      poster: 'image/jpeg',
      source: 'application/octet-stream',
    })
  })

  it('shards by the first two characters of the hash', () => {
    const other = `cd${'ef'.repeat(31)}`

    expect(mediaObjectPath(EVENT, other, 'thumb')).toBe(`${EVENT}/thumb/cd/${other}.jpg`)
  })

  it('names every variant the store can hold, in both tables', () => {
    for (const variant of ALL_MEDIA_VARIANTS) {
      expect(EXTENSION[variant]).toMatch(/^[a-z0-9]+$/)
      expect(CONTENT_TYPE[variant]).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/)
    }
    expect(Object.keys(EXTENSION).sort()).toEqual([...ALL_MEDIA_VARIANTS].sort())
    expect(Object.keys(CONTENT_TYPE).sort()).toEqual([...ALL_MEDIA_VARIANTS].sort())
  })
})
