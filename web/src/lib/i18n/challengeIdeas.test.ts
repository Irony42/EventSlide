import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from './locale'
import { TRANSLATIONS } from './translations'

/**
 * The ready-made challenge texts a host may take (spec 18). Once launched they are a challenge's
 * own text, which the server holds to a mission's rule: one line, sixty characters.
 */
describe('challenge ideas', () => {
  it.each(SUPPORTED_LOCALES)(
    '%s offers six ideas, each short enough to launch as it is',
    (locale) => {
      const ideas = TRANSLATIONS[locale].challenge.ideas

      expect(ideas).toHaveLength(6)
      for (const idea of ideas) {
        expect(idea.length).toBeGreaterThan(0)
        expect(idea.length).toBeLessThanOrEqual(60)
        expect(idea).not.toMatch(/[\r\n]/)
      }
    },
  )
})
