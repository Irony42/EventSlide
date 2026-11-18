import { describe, expect, it } from 'vitest'
import { GUEST_SAVE_EXTENSION, GUEST_SAVE_RENDITION } from './guestSave'
import { MEDIA_KINDS } from './mediaKind'

describe('what a guest may save from the feed', () => {
  it('saves the display rendition of a photograph, never the original', () => {
    expect(GUEST_SAVE_RENDITION.photo).toBe('display')
    expect(Object.values(GUEST_SAVE_RENDITION)).not.toContain('original')
  })

  it('saves no rendition of a clip', () => {
    expect(GUEST_SAVE_RENDITION.clip).toBeNull()
  })

  it('names a file for every kind it could one day save', () => {
    for (const kind of MEDIA_KINDS) expect(GUEST_SAVE_EXTENSION[kind]).toMatch(/^[a-z0-9]+$/)
    expect(GUEST_SAVE_EXTENSION.photo).toBe('jpg')
  })
})
