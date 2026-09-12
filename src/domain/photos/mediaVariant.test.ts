import { describe, expect, it } from 'vitest'
import { MEDIA_KINDS } from './mediaKind'
import {
  ALL_MEDIA_VARIANTS,
  CLIP_VARIANTS,
  MEDIA_VARIANTS,
  SERVED_VARIANTS,
  STAGED_SOURCE,
  VARIANTS_BY_KIND,
  hasVariant,
  isServedVariant,
} from './mediaVariant'

describe('media variants', () => {
  it('keeps the photo renditions exactly as they were', () => {
    // Widening this tuple is what would force a poster quality onto a photograph.
    expect([...MEDIA_VARIANTS]).toEqual(['original', 'display', 'thumb'])
  })

  it('gives a clip its own two renditions and no original', () => {
    // The upload is never kept: keeping it would keep the GPS atom with it.
    expect([...CLIP_VARIANTS]).toEqual(['video', 'poster'])
  })

  it('never serves the staged source', () => {
    // The one property that keeps a guest's un-stripped upload private. If this ever
    // passes, a route can parse `source` and hand out location metadata.
    expect(isServedVariant(STAGED_SOURCE)).toBe(false)
    expect([...SERVED_VARIANTS]).not.toContain(STAGED_SOURCE)
    expect([...ALL_MEDIA_VARIANTS]).toContain(STAGED_SOURCE)
  })

  it.each([...SERVED_VARIANTS])('accepts %s as servable', (variant) => {
    expect(isServedVariant(variant)).toBe(true)
  })

  it('refuses something that is not a variant at all', () => {
    expect(isServedVariant('audio')).toBe(false)
    expect(isServedVariant(3)).toBe(false)
  })
})

describe('VARIANTS_BY_KIND', () => {
  it.each([...MEDIA_KINDS])('covers %s', (kind) => {
    expect(VARIANTS_BY_KIND[kind].length).toBeGreaterThan(0)
  })

  it('does not offer a photo a clip rendition', () => {
    expect(hasVariant('photo', 'video')).toBe(false)
    expect(hasVariant('photo', 'thumb')).toBe(true)
  })

  it('does not offer a clip a photo rendition', () => {
    // A clip asked for `display` is a request for something that was never written; it
    // must miss on the row rather than on the disk.
    expect(hasVariant('clip', 'display')).toBe(false)
    expect(hasVariant('clip', 'poster')).toBe(true)
  })
})
