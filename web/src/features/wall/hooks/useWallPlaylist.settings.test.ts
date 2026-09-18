import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_THEME } from '../../../design-system/eventTheme'
import { aWallResponse } from '../../../testing/renderWithProviders'
import { SETTINGS_EXEMPT, sameSettings } from './useWallPlaylist'
import type { EventThemeDto } from '../../../lib/api/dto'

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
  it.each(Object.keys(aWallResponse()).filter((key) => !SETTINGS_EXEMPT.includes(key)))(
    'notices a change to %s',
    (key) => {
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
    },
  )

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
  it.each(Object.keys(DEFAULT_EVENT_THEME))('notices a change to theme.%s', (key) => {
    const kept = aWallResponse()
    const theme: Record<string, unknown> = { ...DEFAULT_EVENT_THEME }
    const current: unknown = theme[key]
    theme[key] = typeof current === 'number' ? current + 1 : `${String(current)}-moved`

    const changed = { ...aWallResponse(), theme: theme as unknown as EventThemeDto }

    expect(sameSettings(kept, changed)).toBe(false)
  })

  it('says nothing changed when nothing did', () => {
    expect(sameSettings(aWallResponse(), aWallResponse())).toBe(true)
  })
})
