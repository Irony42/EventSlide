import { describe, expect, it } from 'vitest'
import type { WallItemDto } from '../../lib/api/dto'
import { fr } from '../../lib/i18n/fr'
import { photoAlt } from './photoAlt'

const anItem = (overrides: Partial<WallItemDto> = {}): WallItemDto => ({
  id: 'photo-1',
  displayUrl: '/api/events/camille-et-sacha/photos/photo-1/display',
  thumbUrl: '/api/events/camille-et-sacha/photos/photo-1/thumb',
  width: 2560,
  height: 1707,
  caption: 'Les confettis',
  authorName: 'Léa',
  createdAt: '2026-06-20T21:04:11.031Z',
  kind: 'photo',
  videoUrl: null,
  durationMs: null,
  ...overrides,
})

describe('photoAlt', () => {
  it('names the author even when the caption already carries the meaning', () => {
    expect(photoAlt(anItem())).toBe(`Les confettis — ${fr.wall.photoBy('Léa')}`)
  })

  it('describes a photo with no caption by its author alone', () => {
    // Most guests send no caption, so this is the common case rather than the edge one.
    expect(photoAlt(anItem({ caption: null }))).toBe(fr.wall.photoBy('Léa'))
  })

  it('treats a caption the guest left blank as no caption', () => {
    // A phone keyboard sends an empty string where the server stores nothing, and an
    // alt text starting with " — " reads aloud as a pause with no word in front of it.
    expect(photoAlt(anItem({ caption: '' }))).toBe(fr.wall.photoBy('Léa'))
  })

  it('credits an anonymous guest rather than leaving the photo unattributed', () => {
    // "Who sent this" is the part a listener cannot get from the picture, so it is said
    // even when there is no name to say.
    expect(photoAlt(anItem({ authorName: null }))).toBe(
      `Les confettis — ${fr.wall.photoByAnonymous}`,
    )
  })

  it('treats a blank display name as anonymous', () => {
    expect(photoAlt(anItem({ authorName: '' }))).toBe(`Les confettis — ${fr.wall.photoByAnonymous}`)
  })
})

/**
 * `joinUrlFor` used to live here and is gone.
 *
 * It built the QR's link in the browser from `window.location.origin` — the address the
 * projector was opened on, not the one a guest's phone can reach. The wall now renders
 * the `joinUrl` the server put on the response, and the two rules this file used to
 * assert are asserted where the URL is now built: "a path, never a query string" and
 * "a reserved character stays inside its own segment" are both in
 * `src/interface/http/presenters/presenters.test.ts`, on `joinUrl`.
 */
