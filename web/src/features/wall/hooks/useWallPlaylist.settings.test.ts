import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_THEME } from '../../../design-system/eventTheme'
import {
  aWallGuestbookMessage,
  aWallMission,
  aWallResponse,
} from '../../../testing/renderWithProviders'
import { SETTINGS_EXEMPT, sameSettings } from './useWallPlaylist'
import type {
  EventThemeDto,
  WallGuestbookMessageDto,
  WallMissionDto,
  WallResponse,
} from '../../../lib/api/dto'

/**
 * The guard on the guard.
 *
 * `sameSettings` decides whether a refetch reaches a running projector, and it is a list
 * of hand-written comparisons. It is complete today; the day somebody adds a tenth field
 * to the wall response it silently is not, and the symptom is the one roadmap 2.2 was
 * written to fix — the room never learns, and on an empty wall never learns at all,
 * because `revision` fingerprints `items` and nothing else.
 *
 * So rather than trusting the list, this walks the response a real server sends and
 * requires every key to be either compared or deliberately exempted. A new field fails
 * here, by name, before it can fail at a wedding.
 */
describe('every field of the wall response is accounted for', () => {
  it.each(
    Object.keys(aWallResponse()).filter(
      // `joinCard` is an object the generic walk cannot move; its three fields are walked below.
      (key) => !SETTINGS_EXEMPT.includes(key) && key !== 'joinCard',
    ),
  )('notices a change to %s', (key) => {
    const kept = aWallResponse()
    const fresh = aWallResponse()

    // A value of the right shape but a different content, whatever the field holds.
    const changed: Record<string, unknown> = { ...fresh }
    const current: unknown = changed[key]
    changed[key] =
      typeof current === 'number'
        ? current + 1
        : typeof current === 'string'
          ? `${current}-moved`
          : typeof current === 'boolean'
            ? !current
            : { ...(current as object), name: 'Une autre soirée', accentHue: 250 }

    expect(sameSettings(kept, changed as unknown as typeof fresh)).toBe(false)
  })

  /**
   * And one level down, because the theme is an object and the walk above is not recursive.
   *
   * This is the hole roadmap 11.5 fell into and the reason it is worth writing out: the
   * enumeration only ever saw the response's top level, `theme` arrives there as one value,
   * and `material` was added to the wire and compared nowhere while this file stayed green.
   * A change to it would then have reached a running projector only when the next
   * photograph moved `revision` — which on the empty wall a host is looking at while they
   * choose is never.
   */
  it('notices the host writing, changing or clearing the welcome message', () => {
    // `brand` is not in `aWallResponse`'s shape, so the sweep above cannot see it, and a message
    // changed on the empty wall the host is looking at moves no photograph and so no `revision`.
    const withMessage = (welcomeMessage: string | null) => ({
      ...aWallResponse(),
      brand: { welcomeMessage, logoUrl: null },
    })

    expect(sameSettings(withMessage(null), withMessage('Bienvenue'))).toBe(false)
    expect(sameSettings(withMessage('Bienvenue'), withMessage('Autre'))).toBe(false)
    expect(sameSettings(withMessage('Bienvenue'), withMessage(null))).toBe(false)
    expect(sameSettings(withMessage('Bienvenue'), withMessage('Bienvenue'))).toBe(true)
  })

  it('notices the host uploading, replacing or removing the logo', () => {
    const withLogo = (logoUrl: string | null) => ({
      ...aWallResponse(),
      brand: { welcomeMessage: null, logoUrl },
    })
    const one = `/api/events/soiree/logo/${'a'.repeat(64)}`
    const two = `/api/events/soiree/logo/${'b'.repeat(64)}`

    expect(sameSettings(withLogo(null), withLogo(one))).toBe(false)
    expect(sameSettings(withLogo(one), withLogo(two))).toBe(false)
    expect(sameSettings(withLogo(one), withLogo(null))).toBe(false)
    expect(sameSettings(withLogo(one), withLogo(one))).toBe(true)
  })

  it('notices the host replacing or removing the venue photo', () => {
    // `groundUrl` is not a key of DEFAULT_EVENT_THEME, so the sweep below cannot see it.
    const kept = aWallResponse()
    const withPhoto = {
      ...aWallResponse(),
      theme: {
        ...DEFAULT_EVENT_THEME,
        groundUrl: '/api/events/e/venue-photo/abc',
      } as unknown as EventThemeDto,
    }
    expect(sameSettings(kept, withPhoto)).toBe(false)
    expect(sameSettings(withPhoto, kept)).toBe(false)
  })

  it.each([
    ['ground', { ground: 'light', groundHue: 40, faces: 'noces' }],
    ['groundHue', { ground: 'dark', groundHue: 41, faces: 'noces' }],
    ['faces', { ground: 'dark', groundHue: 40, faces: 'cabaret' }],
  ] as const)('notices a change to theme.custom.%s', (_key, moved) => {
    // `custom` is not a key of DEFAULT_EVENT_THEME, so the sweep below cannot see it.
    const base = { ground: 'dark', groundHue: 40, faces: 'noces' } as const
    const themed = (custom: typeof base | typeof moved): EventThemeDto => ({
      ...DEFAULT_EVENT_THEME,
      ambiance: 'custom',
      custom,
    })
    const kept = { ...aWallResponse(), theme: themed(base) }
    const changed = { ...aWallResponse(), theme: themed(moved) }

    expect(sameSettings(kept, changed)).toBe(false)
    expect(sameSettings(kept, { ...aWallResponse(), theme: themed(base) })).toBe(true)
  })

  it.each([
    ['visible', { visible: false, scale: 1, placement: 'bottom-end' }],
    ['scale', { visible: true, scale: 1.05, placement: 'bottom-end' }],
    ['placement', { visible: true, scale: 1, placement: 'top-start' }],
  ] as const)('notices a change to joinCard.%s (spec 14)', (_key, moved) => {
    const kept = aWallResponse()

    expect(sameSettings(kept, { ...aWallResponse(), joinCard: moved })).toBe(false)
    expect(sameSettings(kept, aWallResponse())).toBe(true)
  })

  it.each(Object.keys(DEFAULT_EVENT_THEME))('notices a change to theme.%s', (key) => {
    const kept = aWallResponse()
    const theme: Record<string, unknown> = { ...DEFAULT_EVENT_THEME }
    const current: unknown = theme[key]
    theme[key] = typeof current === 'number' ? current + 1 : `${String(current)}-moved`

    const changed = { ...aWallResponse(), theme: theme as unknown as EventThemeDto }

    expect(sameSettings(kept, changed)).toBe(false)
  })

  /**
   * And one level down again, for the same reason and one shape further.
   *
   * `missions` is an **array** of objects, so the top-level walk above changes it by
   * replacing it wholesale — which trips the length comparison and would pass whatever
   * the per-field comparisons said. Each field a row actually draws is pinned here.
   *
   * The one that matters most is `prompt`, and it is the least obvious: a host correcting
   * a typo mid-evening moves no photograph, so `revision` does not change, and a wall that
   * did not compare it would keep showing the typo for the rest of a quiet stretch.
   */
  it.each(Object.keys(aWallMission()))('notices a change to missions[].%s', (key) => {
    const kept = { ...aWallResponse(), missions: [aWallMission()] }
    const row: Record<string, unknown> = { ...aWallMission() }
    const current: unknown = row[key]
    row[key] =
      typeof current === 'number'
        ? current + 1
        : typeof current === 'boolean'
          ? !current
          : `${String(current)}-moved`

    const changed = { ...aWallResponse(), missions: [row as unknown as WallMissionDto] }

    expect(sameSettings(kept, changed)).toBe(false)
  })

  it('notices a prompt the host has added or removed', () => {
    const none = { ...aWallResponse(), missions: [] }
    const one = { ...aWallResponse(), missions: [aWallMission()] }

    expect(sameSettings(none, one)).toBe(false)
    expect(sameSettings(one, none)).toBe(false)
  })

  it.each(Object.keys(aWallGuestbookMessage()))(
    'notices a change to guestbook.messages[].%s',
    (key) => {
      const book = { everyNth: 6, messages: [aWallGuestbookMessage()] }
      const row: Record<string, unknown> = { ...aWallGuestbookMessage() }
      const current: unknown = row[key]
      row[key] = typeof current === 'number' ? current + 1 : `${String(current)}-moved`

      const changed = {
        everyNth: 6,
        messages: [row as unknown as WallGuestbookMessageDto],
      }

      expect(
        sameSettings(
          { ...aWallResponse(), guestbook: book },
          { ...aWallResponse(), guestbook: changed },
        ),
      ).toBe(false)
    },
  )

  it('notices a message published or taken off, and a change of rhythm', () => {
    const none = aWallResponse()
    const one = {
      ...aWallResponse(),
      guestbook: { everyNth: 6, messages: [aWallGuestbookMessage()] },
    }
    const slower = { ...one, guestbook: { everyNth: 9, messages: one.guestbook.messages } }

    expect(sameSettings(none, one)).toBe(false)
    expect(sameSettings(one, none)).toBe(false)
    expect(sameSettings(one, slower)).toBe(false)
    expect(sameSettings(one, { ...one })).toBe(true)
  })

  it('says nothing changed when nothing did', () => {
    expect(sameSettings(aWallResponse(), aWallResponse())).toBe(true)
  })
})

describe('the mixed wall in the wall response (spec 09)', () => {
  const schedule = {
    wallMs: 180_000,
    slideshowMs: 60_000,
    layout: 'mosaic',
    anchorMs: 1_000,
  } as const
  const withMixed = (mixed: NonNullable<WallResponse['mixed']> | null) => ({
    ...aWallResponse(),
    mixed,
  })

  it('ignores the server time, which changes on every read', () => {
    expect(
      sameSettings({ ...aWallResponse(), serverNowMs: 1 }, { ...aWallResponse(), serverNowMs: 2 }),
    ).toBe(true)
  })

  it('notices the mode turned on or off mid-evening', () => {
    expect(sameSettings(withMixed(null), withMixed(schedule))).toBe(false)
    expect(sameSettings(withMixed(schedule), withMixed(null))).toBe(false)
    expect(sameSettings(withMixed(null), withMixed(null))).toBe(true)
    expect(sameSettings(aWallResponse(), withMixed(null))).toBe(true)
  })

  it.each([
    ['the wall duration', { wallMs: 90_000 }],
    ['the slideshow duration', { slideshowMs: 30_000 }],
    ['the layout of the wall phase', { layout: 'collage' }],
    ['the anchor', { anchorMs: 2_000 }],
  ] as const)('notices a change to %s', (_name, change) => {
    expect(sameSettings(withMixed(schedule), withMixed({ ...schedule, ...change }))).toBe(false)
  })

  it('keeps the same schedule as the same', () => {
    expect(sameSettings(withMixed(schedule), withMixed({ ...schedule }))).toBe(true)
  })
})
