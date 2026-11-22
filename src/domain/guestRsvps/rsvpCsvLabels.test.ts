import { describe, expect, it } from 'vitest'
import { EVENT_LANGUAGES } from '../events/eventLanguage'
import { RSVP_CSV_LABELS } from './rsvpCsvLabels'

describe('RSVP_CSV_LABELS', () => {
  it('has a complete set of words for every language of the invitation', () => {
    for (const language of EVENT_LANGUAGES) {
      const labels = RSVP_CSV_LABELS[language]
      const words = [
        labels.name,
        labels.answer,
        labels.adults,
        labels.kids,
        labels.diet,
        labels.message,
        labels.source,
        labels.updatedAt,
        ...Object.values(labels.answers),
        ...Object.values(labels.sources),
      ]

      expect(words.every((word) => word.trim().length > 0)).toBe(true)
      expect(Object.keys(labels.answers).sort()).toEqual(['maybe', 'no', 'waitlist', 'yes'])
      expect(Object.keys(labels.sources).sort()).toEqual(['host', 'household', 'open'])
      expect(new Set(Object.values(labels.answers)).size).toBe(4)
    }
  })

  it('never opens a header with a character a spreadsheet reads as a formula', () => {
    for (const language of EVENT_LANGUAGES) {
      const { name, answer, adults, kids, diet, message, source, updatedAt } =
        RSVP_CSV_LABELS[language]

      for (const header of [name, answer, adults, kids, diet, message, source, updatedAt]) {
        expect(header).not.toMatch(/^[=+\-@\t\r]/)
      }
    }
  })
})
