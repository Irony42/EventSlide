import { describe, expect, it } from 'vitest'
import { aWallResponse } from '../../../testing/renderWithProviders'
import { SETTINGS_EXEMPT, sameSettings } from './useWallPlaylist'

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
              : current === null || current === undefined
                ? { accentHue: 250, fonts: 'serif', frame: 'round' }
                : { ...(current as object), name: 'Une autre soirée', accentHue: 250 }

      expect(sameSettings(kept, changed as unknown as typeof fresh)).toBe(false)
    },
  )

  it('says nothing changed when nothing did', () => {
    expect(sameSettings(aWallResponse(), aWallResponse())).toBe(true)
  })
})
