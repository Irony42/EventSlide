import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from './locale'
import { TRANSLATIONS } from './translations'

/**
 * The ready-made texts a host may take for an announcement (spec 21). Once sent they are an
 * announcement's own text, which the server holds to one line of eighty characters.
 */
describe('announcement ideas', () => {
  it.each(SUPPORTED_LOCALES)(
    '%s offers five card ideas and three discreet ones, each short enough to send as it is',
    (locale) => {
      const { ideas, ideasDiscreet } = TRANSLATIONS[locale].announcement

      expect(ideas).toHaveLength(5)
      expect(ideasDiscreet).toHaveLength(3)
      for (const idea of [...ideas, ...ideasDiscreet]) {
        expect(idea.length).toBeGreaterThan(0)
        expect([...idea].length).toBeLessThanOrEqual(80)
        expect(idea).not.toMatch(/[\r\n]/)
      }
    },
  )

  it.each(SUPPORTED_LOCALES)('%s gives no two ideas the same words', (locale) => {
    const { ideas, ideasDiscreet } = TRANSLATIONS[locale].announcement
    const all = [...ideas, ...ideasDiscreet]

    expect(new Set(all).size).toBe(all.length)
  })
})
